import type { DeviceRecord } from '../shared/types'

export interface EstimateRates {
  estimatedDischargeRatePctPerMs: number | null
  estimatedChargeRatePctPerMs: number | null
}

/** Require this much streak time before trusting the averaged rate. */
const MIN_ELAPSED_MS = 5 * 60 * 1000
/** Require at least this much observed change — a floor, not an assumed sensor step size. */
const MIN_DELTA_PCT = 1

/** Average rate (%/ms) over the current discharge/charge streak, or null if not yet reliable. */
export function computeEstimateRates(d: DeviceRecord, now: number): EstimateRates {
  const none: EstimateRates = {
    estimatedDischargeRatePctPerMs: null,
    estimatedChargeRatePctPerMs: null
  }
  if (!d.online || d.lastBattery === null) return none

  if (d.charging === 'discharging' && d.dischargeStartTime !== null && d.dischargeStartBattery !== null) {
    const elapsed = now - d.dischargeStartTime
    const dropped = d.dischargeStartBattery - d.lastBattery
    if (elapsed >= MIN_ELAPSED_MS && dropped >= MIN_DELTA_PCT) {
      return { estimatedDischargeRatePctPerMs: dropped / elapsed, estimatedChargeRatePctPerMs: null }
    }
  }

  if (d.charging === 'charging' && d.chargeStartTime !== null && d.chargeStartBattery !== null) {
    const elapsed = now - d.chargeStartTime
    const gained = d.lastBattery - d.chargeStartBattery
    if (elapsed >= MIN_ELAPSED_MS && gained >= MIN_DELTA_PCT && d.lastBattery < 100) {
      return { estimatedDischargeRatePctPerMs: null, estimatedChargeRatePctPerMs: gained / elapsed }
    }
  }

  return none
}

/** Smoothing factor for blending a newly-validated live rate into the persisted long-term average. */
const AVG_RATE_SMOOTHING = 0.25

/** Exponential moving average update — call whenever `computeEstimateRates` yields a live rate. */
export function updateAverageRate(prevAvg: number | null, liveRate: number): number {
  return prevAvg === null ? liveRate : prevAvg + AVG_RATE_SMOOTHING * (liveRate - prevAvg)
}

export interface DisplayRates extends EstimateRates {
  /** True when the rate came from the persisted average rather than the current live streak. */
  fromHistory: boolean
}

/**
 * The rate to show the user: the live current-streak rate when it's already validated, otherwise
 * a fallback to the persisted long-term average (if one exists) so an estimate is visible
 * immediately after a streak reset instead of going blank for another `MIN_ELAPSED_MS`.
 */
export function computeDisplayRates(d: DeviceRecord, now: number): DisplayRates {
  const live = computeEstimateRates(d, now)
  if (live.estimatedDischargeRatePctPerMs !== null || live.estimatedChargeRatePctPerMs !== null) {
    return { ...live, fromHistory: false }
  }

  const none: DisplayRates = {
    estimatedDischargeRatePctPerMs: null,
    estimatedChargeRatePctPerMs: null,
    fromHistory: false
  }
  if (!d.online || d.lastBattery === null) return none

  if (
    d.charging === 'discharging' &&
    d.dischargeStartTime !== null &&
    d.dischargeStartBattery !== null &&
    d.avgDischargeRatePctPerMs !== null
  ) {
    return {
      estimatedDischargeRatePctPerMs: d.avgDischargeRatePctPerMs,
      estimatedChargeRatePctPerMs: null,
      fromHistory: true
    }
  }

  if (
    d.charging === 'charging' &&
    d.chargeStartTime !== null &&
    d.chargeStartBattery !== null &&
    d.avgChargeRatePctPerMs !== null &&
    d.lastBattery < 100
  ) {
    return {
      estimatedDischargeRatePctPerMs: null,
      estimatedChargeRatePctPerMs: d.avgChargeRatePctPerMs,
      fromHistory: true
    }
  }

  return none
}
