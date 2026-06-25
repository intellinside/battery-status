import Store from 'electron-store'
import type { AppSettings, DeviceRecord, DeviceConfigPatch, DeviceView } from '../shared/types'

interface StoreSchema {
  settings: AppSettings
  devices: Record<string, DeviceRecord>
}

const defaultSettings: AppSettings = {
  pollIntervalSec: 60,
  autoLaunch: true,
  lowColorThreshold: 20,
  panelOpacity: 85,
  panelCorner: 'bottom-right',
  panelMarginX: 8,
  panelMarginY: 8,
  panelVisible: true,
  compactPanel: false,
  compactCircleSize: 48,
  warnColorThreshold: 40,
  dynamicColorMode: false,
  trayDeviceId: null
}

const store = new Store<StoreSchema>({
  defaults: {
    settings: defaultSettings,
    devices: {}
  }
})

export function getSettings(): AppSettings {
  return { ...defaultSettings, ...store.get('settings') }
}

export function setSettings(patch: Partial<AppSettings>): AppSettings {
  const next = { ...getSettings(), ...patch }
  next.panelOpacity = Math.min(100, Math.max(0, Math.round(next.panelOpacity)))
  next.panelMarginX = Math.min(1000, Math.max(0, Math.round(next.panelMarginX)))
  next.panelMarginY = Math.min(1000, Math.max(0, Math.round(next.panelMarginY)))
  next.compactCircleSize = Math.min(96, Math.max(24, Math.round(next.compactCircleSize)))
  next.warnColorThreshold = Math.min(100, Math.max(1, Math.round(next.warnColorThreshold)))
  store.set('settings', next)
  return next
}

function rawDevices(): Record<string, DeviceRecord> {
  return store.get('devices') ?? {}
}

export function resolveDisplayName(d: DeviceRecord): string {
  const alias = d.alias?.trim()
  return alias && alias.length > 0 ? alias : stripQuotes(d.name)
}

function stripQuotes(s: string): string {
  return s?.replace(/^"+|"+$/g, '').trim() ?? ''
}

function toView(d: DeviceRecord): DeviceView {
  return { ...d, name: stripQuotes(d.name), displayName: resolveDisplayName(d) }
}

/** All registry devices, sorted by user-defined sortOrder (then lastSeen as tie-breaker). */
export function getDeviceViews(): DeviceView[] {
  return Object.values(rawDevices())
    .map(toView)
    .sort((a, b) => {
      const oa = a.sortOrder ?? Infinity
      const ob = b.sortOrder ?? Infinity
      if (oa !== ob) return oa - ob
      return b.lastSeen - a.lastSeen
    })
}

/** Persist a new user-defined order by assigning sortOrder = position index. */
export function reorderDevices(orderedIds: string[]): DeviceView[] {
  const devices = rawDevices()
  orderedIds.forEach((id, index) => {
    if (devices[id]) devices[id] = { ...devices[id], sortOrder: index }
  })
  saveDevices(devices)
  return getDeviceViews()
}

export function updateDeviceConfig(id: string, patch: DeviceConfigPatch): void {
  const devices = rawDevices()
  const existing = devices[id]
  if (!existing) return
  devices[id] = {
    ...existing,
    ...(patch.alias !== undefined ? { alias: normalizeAlias(patch.alias) } : {}),
    ...(patch.showOnPanel !== undefined ? { showOnPanel: patch.showOnPanel } : {}),
    ...(patch.warnEnabled !== undefined ? { warnEnabled: patch.warnEnabled } : {}),
    ...(patch.warnThreshold !== undefined
      ? { warnThreshold: clampPercent(patch.warnThreshold) }
      : {}),
    ...(patch.deviceType !== undefined ? { deviceType: patch.deviceType } : {})
  }
  store.set('devices', devices)
}

export function saveDevices(devices: Record<string, DeviceRecord>): void {
  store.set('devices', devices)
}

export function deleteDevice(id: string): void {
  const devices = rawDevices()
  delete devices[id]
  store.set('devices', devices)
}

export function getDevicesMap(): Record<string, DeviceRecord> {
  return rawDevices()
}

function normalizeAlias(alias: string | null): string | null {
  if (alias === null) return null
  const trimmed = alias.trim()
  return trimmed.length === 0 ? null : trimmed
}

function clampPercent(n: number): number {
  if (Number.isNaN(n)) return 20
  return Math.min(100, Math.max(1, Math.round(n)))
}
