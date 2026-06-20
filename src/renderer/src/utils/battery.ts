import type { DeviceView } from '../../../shared/types'

export function levelColor(level: number, warn: boolean): string {
  if (warn || level <= 20) return '#e5484d'
  if (level <= 40) return '#f5a524'
  return '#46b450'
}

export function isWarning(d: Pick<DeviceView, 'warnEnabled' | 'lastBattery' | 'warnThreshold'>): boolean {
  return d.warnEnabled && d.lastBattery !== null && d.lastBattery < d.warnThreshold
}
