import * as HID from 'node-hid'
import type { ChargingState, ProbeResult } from '../shared/types'

/**
 * Reads battery for devices that only expose it over vendor-specific HID protocols
 * (Razer mice via dongle, Sony DualSense over USB/Bluetooth) — these never report a level
 * through Windows PnP, so the regular Bluetooth probe returns null for them.
 *
 * Protocols verified on real hardware:
 *  - Razer: openrazer feature-report (class 0x07, id 0x80 battery / 0x84 charging) on the
 *    MI_00 collection, transaction id 0x1f. battery = arg/255*100.
 *  - DualSense: HID input report (USB 0x01 @ byte 53, BT 0x31 @ byte 54); MAC via feature
 *    report 0x09 (bytes 1..6 reversed) so USB and Bluetooth collapse to one device record.
 */

const RAZER_VID = 0x1532
const SONY_VID = 0x054c
const DUALSENSE_PIDS = [0x0ce6, 0x0df2]

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

export async function probeVendorBattery(): Promise<ProbeResult[]> {
  const results: ProbeResult[] = []
  let devices: HID.Device[] = []
  try {
    devices = HID.devices()
  } catch {
    return results
  }

  const razer = await safe(() => readRazer(devices))
  if (razer) results.push(razer)

  const dualsense = await safe(() => readDualSense(devices))
  if (dualsense) results.push(dualsense)

  return results
}

async function safe<T>(fn: () => Promise<T | null>): Promise<T | null> {
  try {
    return await fn()
  } catch {
    return null
  }
}

/* -------------------------------------------------------------------------- */
/* Razer                                                                      */
/* -------------------------------------------------------------------------- */

// Remember the collection that responded so we don't reopen every Razer interface each poll.
let razerPath: string | null = null

function razerReport(transactionId: number, commandId: number): number[] {
  const b = new Array<number>(91).fill(0)
  b[0] = 0x00 // report id
  b[2] = transactionId
  b[6] = 0x02 // data_size
  b[7] = 0x07 // command_class
  b[8] = commandId // 0x80 battery, 0x84 charging
  let crc = 0
  for (let i = 3; i <= 88; i++) crc ^= b[i]
  b[89] = crc
  return b
}

async function queryRazer(path: string, commandId: number): Promise<number | null> {
  const dev = new HID.HID(path)
  try {
    dev.sendFeatureReport(razerReport(0x1f, commandId))
    await sleep(40)
    const resp = dev.getFeatureReport(0x00, 91)
    // resp[1]=status (0x02 ok), resp[7]=class, resp[8]=id, resp[10]=arg1
    if (resp[1] === 0x02 && resp[7] === 0x07 && resp[8] === commandId) {
      return resp[10]
    }
    return null
  } finally {
    try {
      dev.close()
    } catch {
      /* ignore */
    }
  }
}

async function readRazer(devices: HID.Device[]): Promise<ProbeResult | null> {
  const candidates = devices.filter((d) => d.vendorId === RAZER_VID && d.path)
  if (candidates.length === 0) return null

  // Try the cached path first, then the rest.
  candidates.sort((a) => (a.path === razerPath ? -1 : 0))

  for (const info of candidates) {
    const battRaw = await safe(() => queryRazer(info.path as string, 0x80))
    if (battRaw === null) continue

    razerPath = info.path as string
    const chargeRaw = await safe(() => queryRazer(info.path as string, 0x84))
    const charging: ChargingState =
      chargeRaw === null ? 'unknown' : chargeRaw ? 'charging' : 'discharging'

    const id = `hid:${RAZER_VID.toString(16)}:${info.productId.toString(16)}`
    return {
      id,
      name: info.product || 'Razer device',
      address: id,
      online: true,
      battery: Math.round((battRaw / 255) * 100),
      charging
    }
  }
  return null
}

/* -------------------------------------------------------------------------- */
/* Sony DualSense                                                             */
/* -------------------------------------------------------------------------- */

function dualSenseCharging(nibble: number): ChargingState {
  switch (nibble) {
    case 0x1:
      return 'charging'
    case 0x2:
      return 'idle' // fully charged / maintained
    case 0x0:
      return 'discharging'
    default:
      return 'unknown'
  }
}

/** Read the controller's Bluetooth MAC from feature report 0x09 (bytes 1..6, reversed). */
function dualSenseMac(dev: HID.HID): string | null {
  try {
    const r = dev.getFeatureReport(0x09, 64)
    if (r.length < 7) return null
    const mac = r
      .slice(1, 7)
      .reverse()
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase()
    return /^[0-9A-F]{12}$/.test(mac) ? mac : null
  } catch {
    return null
  }
}

function normalizeMac(serial: string | undefined): string | null {
  if (!serial) return null
  const mac = serial.replace(/[^0-9A-Fa-f]/g, '').toUpperCase()
  return /^[0-9A-F]{12}$/.test(mac) ? mac : null
}

async function readDualSense(devices: HID.Device[]): Promise<ProbeResult | null> {
  const info = devices.find(
    (d) =>
      d.vendorId === SONY_VID &&
      DUALSENSE_PIDS.includes(d.productId) &&
      d.path &&
      d.usagePage === 0x01 &&
      d.usage === 0x05
  )
  if (!info) return null

  const dev = new HID.HID(info.path as string)
  try {
    const mac = dualSenseMac(dev) ?? normalizeMac(info.serialNumber)

    let data = dev.readTimeout(500)
    // Bluetooth in minimal mode reports a short 0x01; request feature 0x05 to enable 0x31.
    if (data.length > 0 && data[0] === 0x01 && data.length < 64) {
      try {
        dev.getFeatureReport(0x05, 64)
      } catch {
        /* ignore */
      }
      // Drain stale short 0x01 reports; wait up to ~1s for a full 0x31 or full 0x01.
      for (let i = 0; i < 4; i++) {
        data = dev.readTimeout(250)
        if (!data || data.length === 0) break
        if (data[0] === 0x31 || (data[0] === 0x01 && data.length >= 64)) break
      }
    }
    if (!data || data.length === 0) return null

    let statusByte: number | null = null
    if (data[0] === 0x01 && data.length > 53) statusByte = data[53] // USB
    else if (data[0] === 0x31 && data.length > 54) statusByte = data[54] // Bluetooth
    if (statusByte === null) return null

    const level = statusByte & 0x0f
    const charging = dualSenseCharging((statusByte >> 4) & 0x0f)
    const battery = Math.min(level * 10 + 5, 100)

    const id = mac ?? `hid:${SONY_VID.toString(16)}:${info.productId.toString(16)}`
    return {
      id,
      name: info.product || 'DualSense Wireless Controller',
      address: mac ?? id,
      online: true,
      battery,
      charging
    }
  } finally {
    try {
      dev.close()
    } catch {
      /* ignore */
    }
  }
}
