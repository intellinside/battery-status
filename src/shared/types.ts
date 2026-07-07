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
  /** Battery level when the current discharge streak began; null when not discharging. */
  dischargeStartBattery: number | null
  /** Epoch ms when the current discharge streak began. */
  dischargeStartTime: number | null
  /** Battery level when the current charge streak began; null when not charging. */
  chargeStartBattery: number | null
  /** Epoch ms when the current charge streak began. */
  chargeStartTime: number | null
  /** Long-term average discharge rate (%/ms), updated (EMA) each time a streak's live rate is validated; survives streak resets. */
  avgDischargeRatePctPerMs: number | null
  /** Long-term average charge rate (%/ms), updated (EMA) each time a streak's live rate is validated; survives streak resets. */
  avgChargeRatePctPerMs: number | null
}

/** Device shape as it leaves the renderer-facing API (adds resolved display name). */
export interface DeviceView extends DeviceRecord {
  displayName: string
  /** Average discharge rate (%/ms) over the current streak; null until enough data is observed. */
  estimatedDischargeRatePctPerMs: number | null
  /** Average charge rate (%/ms) over the current streak; null until enough data is observed. */
  estimatedChargeRatePctPerMs: number | null
  /** True when the estimated rate above came from the persisted long-term average rather than the current live streak. */
  estimateFromHistory: boolean
}

export interface AppSettings {
  pollIntervalSec: number
  autoLaunch: boolean
  lowColorThreshold: number
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
  /** Upper boundary of the orange zone; above this shows green. Default 40. Used when dynamicColorMode is false. */
  warnColorThreshold: number
  /** When true, indicator color interpolates red→orange→green by percentage instead of fixed thresholds. */
  dynamicColorMode: boolean
  /** Device ID to show battery level in the tray icon; null = show plain outline. */
  trayDeviceId: string | null
  /** Show estimated time remaining/to-full on the panel. */
  showTimeEstimate: boolean
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

export type UpdateState = 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'error' | 'up-to-date'

export interface UpdateStatus {
  state: UpdateState
  version?: string
  progress?: number
  error?: string
}
