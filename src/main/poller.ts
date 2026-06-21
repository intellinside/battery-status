import { Notification } from 'electron'
import { startDeviceHelper, stopDeviceHelper, getLastDevices, requestRefresh } from './devicehelper'
import {
  getDevicesMap,
  getSettings,
  saveDevices,
  getDeviceViews,
  resolveDisplayName
} from './store'
import type { ChargingState, DeviceRecord, DeviceView, ProbeResult } from '../shared/types'

type UpdateListener = (devices: DeviceView[]) => void

/** Devices currently below their warning threshold that we've already notified about. */
const warned = new Set<string>()

let listener: UpdateListener | null = null

function deriveCharging(prev: number | null, next: number): ChargingState {
  if (prev === null) return 'unknown'
  if (next > prev) return 'charging'
  if (next < prev) return 'discharging'
  return 'idle'
}

/** Merge a fresh probe into the persisted registry, returning the updated views. */
function merge(results: ProbeResult[]): DeviceView[] {
  const settings = getSettings()
  const devices = getDevicesMap()
  const now = Date.now()
  const seen = new Set<string>()

  for (const r of results) {
    seen.add(r.id)
    const existing = devices[r.id]
    let lastBattery = existing?.lastBattery ?? null
    let prevBattery = existing?.prevBattery ?? null
    let charging: ChargingState = existing?.charging ?? 'unknown'

    if (r.battery !== null && !Number.isNaN(r.battery)) {
      const prevKnown = existing?.lastBattery ?? null
      if (prevKnown !== null && prevKnown !== r.battery) prevBattery = prevKnown
      if (r.charging) {
        charging = r.charging
      } else if (prevKnown !== null && prevKnown !== r.battery) {
        charging = deriveCharging(prevKnown, r.battery)
      } else if (prevKnown !== null && prevKnown === r.battery) {
        charging = 'idle'
      } else {
        charging = 'unknown'
      }
      lastBattery = r.battery
    } else {
      charging = r.charging ?? 'unknown'
    }

    const maxOrder = existing
      ? -1
      : Object.values(devices).reduce(
          (m, d) => (typeof d.sortOrder === 'number' ? Math.max(m, d.sortOrder) : m),
          -1
        )

    // Auto-promote visibility when battery becomes known for the first time.
    // If showOnPanel/warnEnabled defaulted to false because battery was initially null,
    // flip them to true as soon as battery arrives — device should appear automatically.
    // HID devices (id starts with "hid:") are physically connected — show by default even if
    // battery is unreadable (e.g. Synapse holds exclusive lock on the feature-report interface).
    // BT devices default to hidden when battery is null because they may just not be nearby.
    const defaultVisible = r.battery !== null || r.id.startsWith('hid:')
    const batteryFirstArrival = existing !== undefined && existing.lastBattery === null && r.battery !== null
    const showOnPanel = existing === undefined
      ? defaultVisible
      : batteryFirstArrival && !existing.showOnPanel ? true : existing.showOnPanel
    const warnEnabled = existing === undefined
      ? r.battery !== null
      : batteryFirstArrival && !existing.warnEnabled ? true : existing.warnEnabled

    const record: DeviceRecord = {
      id: r.id,
      name: r.name,
      address: r.address,
      alias: existing?.alias ?? null,
      showOnPanel,
      warnEnabled,
      warnThreshold: existing?.warnThreshold ?? settings.lowColorThreshold,
      lastBattery,
      prevBattery,
      charging,
      online: r.online,
      lastSeen: now,
      deviceType: existing?.deviceType ?? null,
      ...(existing ? { sortOrder: existing.sortOrder } : { sortOrder: maxOrder + 1 })
    }
    devices[r.id] = record

    evaluateWarning(record)
  }

  for (const id of Object.keys(devices)) {
    if (!seen.has(id) && devices[id].online) {
      devices[id] = { ...devices[id], online: false, charging: 'unknown' }
    }
  }

  saveDevices(devices)
  return getDeviceViews()
}

function evaluateWarning(d: DeviceRecord): void {
  if (!d.warnEnabled || !d.online || d.lastBattery === null) return
  if (d.lastBattery < d.warnThreshold) {
    if (!warned.has(d.id)) {
      warned.add(d.id)
      notifyLowBattery(d)
    }
  } else {
    warned.delete(d.id)
  }
}

function notifyLowBattery(d: DeviceRecord): void {
  if (!Notification.isSupported()) return
  new Notification({
    title: 'Low battery',
    body: `${resolveDisplayName(d)} is at ${d.lastBattery}% (below ${d.warnThreshold}%).`,
    silent: false
  }).show()
}

export function runOnce(): Promise<void> {
  const devices = getLastDevices()
  const views = merge(devices)
  listener?.(views)
  requestRefresh()
  return Promise.resolve()
}

export function startPolling(onUpdate: UpdateListener): void {
  listener = onUpdate
  startDeviceHelper((devices) => {
    const views = merge(devices)
    listener?.(views)
  })
}

/** Re-read settings and propagate to helper (interval changes). */
export function reschedulePolling(): void {
  requestRefresh()
}

export function stopPolling(): Promise<void> {
  listener = null
  return stopDeviceHelper()
}
