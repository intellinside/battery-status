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
