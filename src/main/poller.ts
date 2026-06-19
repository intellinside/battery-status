import { Notification } from 'electron'
import { probeDevices } from './bluetooth'
import { probeVendorBattery } from './vendor'
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

let timer: NodeJS.Timeout | null = null
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
        // Source reports a real charging state (vendor HID) — trust it.
        charging = r.charging
      } else if (prevKnown !== null && prevKnown !== r.battery) {
        charging = deriveCharging(prevKnown, r.battery)
      } else if (prevKnown !== null && prevKnown === r.battery) {
        charging = 'idle'
      } else {
        charging = 'unknown' // first known reading; need a second to infer
      }
      lastBattery = r.battery
    } else {
      // Online but not reporting a level right now: keep last known %, drop trend.
      charging = r.charging ?? 'unknown'
    }

    const maxOrder = existing
      ? -1
      : Object.values(devices).reduce(
          (m, d) => (typeof d.sortOrder === 'number' ? Math.max(m, d.sortOrder) : m),
          -1
        )

    const record: DeviceRecord = {
      id: r.id,
      name: r.name,
      address: r.address,
      alias: existing?.alias ?? null,
      showOnPanel: existing?.showOnPanel ?? (r.battery !== null),
      warnEnabled: existing?.warnEnabled ?? (r.battery !== null),
      warnThreshold: existing?.warnThreshold ?? settings.lowBatteryDefault,
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

  // Devices not seen this poll are offline; keep their data for the Devices tab.
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
    warned.delete(d.id) // recovered — allow a future warning
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

export async function runOnce(): Promise<void> {
  const [bt, vendor] = await Promise.all([probeDevices(), probeVendorBattery()])
  const views = merge(combineSources(bt, vendor))
  listener?.(views)
}

/**
 * Merge the Bluetooth/PnP and vendor-HID probe results into one list keyed by id.
 * Vendor results override battery/charging for a matching device (e.g. DualSense over BT)
 * and otherwise add new entries (Razer dongle, USB DualSense).
 */
function combineSources(bt: ProbeResult[], vendor: ProbeResult[]): ProbeResult[] {
  const byId = new Map<string, ProbeResult>()
  for (const r of bt) byId.set(r.id, r)
  for (const v of vendor) {
    const existing = byId.get(v.id)
    if (existing) {
      byId.set(v.id, {
        ...existing,
        name: existing.name || v.name,
        online: true,
        battery: v.battery ?? existing.battery,
        charging: v.charging ?? existing.charging
      })
    } else {
      byId.set(v.id, v)
    }
  }
  return [...byId.values()]
}

export function startPolling(onUpdate: UpdateListener): void {
  listener = onUpdate
  void runOnce()
  scheduleNext()
}

function scheduleNext(): void {
  if (timer) clearInterval(timer)
  const intervalMs = Math.max(10, getSettings().pollIntervalSec) * 1000
  timer = setInterval(() => void runOnce(), intervalMs)
}

/** Re-read the interval from settings and restart the loop (call after settings change). */
export function reschedulePolling(): void {
  scheduleNext()
}

export function stopPolling(): void {
  if (timer) clearInterval(timer)
  timer = null
  listener = null
}
