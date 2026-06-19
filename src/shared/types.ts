export type ChargingState = 'charging' | 'discharging' | 'idle' | 'unknown'

export type DeviceType = 'keyboard' | 'mouse' | 'headphones' | 'controller' | null

/** A device row as persisted in the registry / sent to the renderer. */
export interface DeviceRecord {
  id: string
  /** Name as reported by Windows. */
  name: string
  /** User-defined human-readable name; falls back to `name` when null. */
  alias: string | null
  address: string
  showOnPanel: boolean
  warnEnabled: boolean
  warnThreshold: number
  lastBattery: number | null
  prevBattery: number | null
  charging: ChargingState
  online: boolean
  lastSeen: number
  sortOrder?: number
  deviceType: DeviceType
}

/** Device shape as it leaves the renderer-facing API (adds resolved display name). */
export interface DeviceView extends DeviceRecord {
  displayName: string
}

export interface AppSettings {
  pollIntervalSec: number
  autoLaunch: boolean
  lowBatteryDefault: number
  /** Background opacity of the status panel, 0–100 (%). */
  panelOpacity: number
  /** Screen corner the panel snaps to. */
  panelCorner: PanelCorner
  /** Horizontal gap (px) from the left/right screen edge. */
  panelMarginX: number
  /** Vertical gap (px) from the taskbar/top edge. */
  panelMarginY: number
  /** Whether the floating panel is currently visible (persisted across restarts). */
  panelVisible: boolean
  /** Show devices as a compact horizontal ring strip instead of the default list. */
  compactPanel: boolean
  /** Diameter (px) of each ring in compact mode. Default 48. Range 12–96. */
  compactCircleSize: number
}

export type PanelCorner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'

export interface DeviceConfigPatch {
  alias?: string | null
  showOnPanel?: boolean
  warnEnabled?: boolean
  warnThreshold?: number
  deviceType?: DeviceType
}

export interface AppInfo {
  name: string
  version: string
  author: string
}

/** Raw row emitted by a probe (PnP/Bluetooth or vendor HID). */
export interface ProbeResult {
  id: string
  name: string
  address: string
  online: boolean
  battery: number | null
  /** Explicit charging state when the source reports one (vendor HID). */
  charging?: ChargingState
}

export type WindowAction = 'closePanel' | 'openSettings' | 'openAbout' | 'quit'
