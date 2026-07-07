import type { DeviceView } from '../../../shared/types'

export function levelColor(
  level: number,
  warn: boolean,
  lowThreshold = 20,
  warnThreshold = 40,
  dynamicMode = false
): string {
  if (dynamicMode) return dynamicLevelColor(level, lowThreshold, warnThreshold)
  if (warn || level <= lowThreshold) return '#e5484d'
  if (level <= warnThreshold) return '#f5a524'
  return '#46b450'
}

function dynamicLevelColor(pct: number, low: number, warn: number): string {
  const red    = { r: 229, g: 72,  b: 77 }
  const orange = { r: 245, g: 165, b: 36 }
  const green  = { r: 70,  g: 180, b: 80 }
  if (pct <= low) return '#e5484d'
  const [a, b, t] = pct <= warn
    ? [red, orange, (pct - low) / (warn - low)]
    : [orange, green, (pct - warn) / (100 - warn)]
  return `rgb(${lerp(a.r, b.r, t)},${lerp(a.g, b.g, t)},${lerp(a.b, b.b, t)})`
}

function lerp(a: number, b: number, t: number): number {
  return Math.round(a + (b - a) * t)
}

export function isWarning(d: Pick<DeviceView, 'warnEnabled' | 'lastBattery' | 'warnThreshold'>): boolean {
  return d.warnEnabled && d.lastBattery !== null && d.lastBattery <= d.warnThreshold
}

export interface RemainingEstimate {
  toEmptyMs: number | null
  toWarnMs: number | null
  toFullMs: number | null
}

type EstimateSource = Pick<
  DeviceView,
  | 'online'
  | 'lastBattery'
  | 'charging'
  | 'warnThreshold'
  | 'dischargeStartBattery'
  | 'dischargeStartTime'
  | 'estimatedDischargeRatePctPerMs'
  | 'chargeStartBattery'
  | 'chargeStartTime'
  | 'estimatedChargeRatePctPerMs'
  | 'estimateFromHistory'
>

/**
 * Projects the average discharge/charge rate forward against `now`, so calling this again
 * later with the same device (but a later `now`) yields a smaller remaining time — this is
 * what makes the panel's countdown tick down between actual battery readings.
 */
export function estimateRemaining(d: EstimateSource, now: number): RemainingEstimate {
  const none: RemainingEstimate = { toEmptyMs: null, toWarnMs: null, toFullMs: null }
  if (!d.online || d.lastBattery === null) return none

  if (
    d.charging === 'discharging' &&
    d.estimatedDischargeRatePctPerMs &&
    d.dischargeStartTime !== null &&
    d.dischargeStartBattery !== null
  ) {
    const rate = d.estimatedDischargeRatePctPerMs
    const toEmptyMs = Math.max(0, d.dischargeStartTime + d.dischargeStartBattery / rate - now)
    const toWarnMs =
      d.lastBattery > d.warnThreshold
        ? Math.max(0, d.dischargeStartTime + (d.dischargeStartBattery - d.warnThreshold) / rate - now)
        : null
    return { toEmptyMs, toWarnMs, toFullMs: null }
  }

  if (
    d.charging === 'charging' &&
    d.estimatedChargeRatePctPerMs &&
    d.chargeStartTime !== null &&
    d.chargeStartBattery !== null
  ) {
    const rate = d.estimatedChargeRatePctPerMs
    const toFullMs = Math.max(0, d.chargeStartTime + (100 - d.chargeStartBattery) / rate - now)
    return { toEmptyMs: null, toWarnMs: null, toFullMs }
  }

  return none
}

export function formatDuration(totalMs: number): string {
  const totalMinutes = Math.max(1, Math.round(totalMs / 60000))
  const h = Math.floor(totalMinutes / 60)
  const m = totalMinutes % 60
  if (h === 0) return `${m}m`
  if (m === 0) return `${h}h`
  return `${h}h ${m}m`
}

export function estimateLabel(d: EstimateSource, now: number): string | null {
  const { toEmptyMs, toWarnMs, toFullMs } = estimateRemaining(d, now)
  const prefix = d.estimateFromHistory ? '~' : ''
  if (d.charging === 'charging' && toFullMs !== null) return `${prefix}${formatDuration(toFullMs)} to full`
  if (d.charging === 'discharging') {
    const parts: string[] = []
    if (toWarnMs !== null) parts.push(`${prefix}${formatDuration(toWarnMs)} to low`)
    if (toEmptyMs !== null) parts.push(`${prefix}${formatDuration(toEmptyMs)} to empty`)
    if (parts.length > 0) return parts.join(' · ')
  }
  return null
}
