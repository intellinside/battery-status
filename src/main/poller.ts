import { Notification } from 'electron'
import { startDeviceHelper, stopDeviceHelper, getLastDevices, requestRefresh } from './devicehelper'
import {
  getDevicesMap,
  getSettings,
  saveDevices,
  getDeviceViews,
  resolveDisplayName
} from './store'
import { computeEstimateRates, updateAverageRate } from './estimate'
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

    // Track the start of the current discharge/charge streak so an average rate can be
    // computed over it. Reset on reconnecting after a real offline gap (which would otherwise
    // leave a stale anchor) or when there's no carried-forward anchor for this direction yet
    // (fresh device, or the opposite direction just cleared it); otherwise carry forward so
    // idle polls — a device reporting the same battery % between ticks, or brief blips like an
    // app restart's device-enumeration warm-up — don't reset the streak. Gating on the anchor
    // (not the literal previous `charging` value) matters because `charging` flips to 'idle'
    // on every no-change poll, which would otherwise make *every* real battery-% change look
    // like the start of a new streak and the average would never accumulate enough time/delta.
    const RECONNECT_RESET_GAP_MS = 10 * 60 * 1000
    const wasOffline = existing !== undefined && !existing.online
    const justReconnected = wasOffline && r.online && now - existing.lastSeen > RECONNECT_RESET_GAP_MS

    let dischargeStartBattery = existing?.dischargeStartBattery ?? null
    let dischargeStartTime = existing?.dischargeStartTime ?? null
    let chargeStartBattery = existing?.chargeStartBattery ?? null
    let chargeStartTime = existing?.chargeStartTime ?? null

    const enteringDischarge =
      lastBattery !== null && charging === 'discharging' && (justReconnected || dischargeStartTime === null)
    const enteringCharge =
      lastBattery !== null && charging === 'charging' && (justReconnected || chargeStartTime === null)

    if (enteringDischarge) {
      dischargeStartBattery = lastBattery
      dischargeStartTime = now
      chargeStartBattery = null
      chargeStartTime = null
    } else if (enteringCharge) {
      chargeStartBattery = lastBattery
      chargeStartTime = now
      dischargeStartBattery = null
      dischargeStartTime = null
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
      dischargeStartBattery,
      dischargeStartTime,
      chargeStartBattery,
      chargeStartTime,
      avgDischargeRatePctPerMs: existing?.avgDischargeRatePctPerMs ?? null,
      avgChargeRatePctPerMs: existing?.avgChargeRatePctPerMs ?? null,
      ...(existing ? { sortOrder: existing.sortOrder } : { sortOrder: maxOrder + 1 })
    }

    // Blend a newly-validated live rate into the persisted long-term average, so it's
    // available as a fallback estimate the next time this streak resets.
    const live = computeEstimateRates(record, now)
    if (live.estimatedDischargeRatePctPerMs !== null) {
      record.avgDischargeRatePctPerMs = updateAverageRate(
        record.avgDischargeRatePctPerMs,
        live.estimatedDischargeRatePctPerMs
      )
    }
    if (live.estimatedChargeRatePctPerMs !== null) {
      record.avgChargeRatePctPerMs = updateAverageRate(
        record.avgChargeRatePctPerMs,
        live.estimatedChargeRatePctPerMs
      )
    }

    devices[r.id] = record

    evaluateWarning(record)
  }

  for (const id of Object.keys(devices)) {
    if (!seen.has(id) && devices[id].online) {
      // Keep the last known charging direction — a device missing from one probe cycle
      // (e.g. still enumerating right after app restart) shouldn't look like a fresh
      // reconnect and discard its discharge/charge streak when it reappears moments later.
      devices[id] = { ...devices[id], online: false }
    }
  }

  saveDevices(devices)
  return getDeviceViews()
}

function evaluateWarning(d: DeviceRecord): void {
  if (!d.warnEnabled || !d.online || d.lastBattery === null) return
  if (d.lastBattery <= d.warnThreshold) {
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
    body: `${resolveDisplayName(d)} is at ${d.lastBattery}% (at or below ${d.warnThreshold}%).`,
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
