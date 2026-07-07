import { useEffect, useMemo, useRef, useState } from 'react'
import { useDevices } from '../hooks/useDevices'
import { useSettings } from '../hooks/useSettings'
import { isWarning, estimateLabel } from '../utils/battery'
import BatteryIcon from '../components/BatteryIcon'
import CompactDeviceCircle from '../components/CompactDeviceCircle'
import DeviceTypeIcon from '../components/DeviceTypeIcon'
import '../styles/panel.css'

export default function Panel(): JSX.Element {
  const { devices, loading } = useDevices()
  const settings = useSettings()
  const shown = useMemo(() => devices.filter((d) => d.showOnPanel && d.online), [devices])
  const rootRef = useRef<HTMLDivElement>(null)

  const opacity = settings?.panelOpacity ?? 85
  const compactPanel = settings?.compactPanel ?? false
  const compactCircleSize = settings?.compactCircleSize ?? 48
  const lowThreshold = settings?.lowColorThreshold ?? 20
  const warnColorThreshold = settings?.warnColorThreshold ?? 40
  const dynamicColorMode = settings?.dynamicColorMode ?? false
  const showTimeEstimate = settings?.showTimeEstimate ?? true

  // Forces a re-render aligned to wall-clock minute boundaries (not window-mount time) so
  // the estimated-time text updates in sync across every open window, instead of drifting
  // out of phase with other windows that mounted at a different moment.
  const [, forceTick] = useState(0)
  useEffect(() => {
    let interval: ReturnType<typeof setInterval>
    const msToNextMinute = 60_000 - (Date.now() % 60_000)
    const timeout = setTimeout(() => {
      forceTick((n) => n + 1)
      interval = setInterval(() => forceTick((n) => n + 1), 60_000)
    }, msToNextMinute)
    return () => {
      clearTimeout(timeout)
      clearInterval(interval)
    }
  }, [])

  // The panel window is transparent — clear the opaque body background from global.css.
  // overflow:hidden prevents scrollbars during the brief window before the ResizeObserver fires.
  useEffect(() => {
    document.documentElement.style.background = 'transparent'
    document.documentElement.style.overflow = 'hidden'
    document.body.style.background = 'transparent'
    document.body.style.overflow = 'hidden'
  }, [])

  // Report the rendered content size so the main process sizes the window to fit.
  useEffect(() => {
    const el = rootRef.current
    if (!el) return
    const report = (): void =>
      window.api.reportPanelSize(el.offsetWidth, el.offsetHeight)
    const observer = new ResizeObserver(report)
    observer.observe(el)
    report()
    return () => observer.disconnect()
  }, [])

  const background = `rgba(31, 33, 37, ${Math.min(100, Math.max(0, opacity)) / 100})`
  const now = Date.now()

  return (
    <div className="panel" style={{ background }} ref={rootRef}>
      {loading && <div className="panel__empty">Loading…</div>}

      {!loading && shown.length === 0 && (
        <div className="panel__empty">...</div>
      )}

      {!loading && shown.length > 0 && compactPanel && (
        <div className="panel__compact">
          {shown.map((d) => (
            <CompactDeviceCircle
              key={d.id}
              level={d.lastBattery}
              charging={d.charging}
              deviceType={d.deviceType}
              displayName={d.displayName}
              warn={isWarning(d)}
              size={compactCircleSize}
              lowThreshold={lowThreshold}
              warnColorThreshold={warnColorThreshold}
              dynamicColorMode={dynamicColorMode}
              tooltipEstimate={estimateLabel(d, now)}
            />
          ))}
        </div>
      )}

      {!loading && shown.length > 0 && !compactPanel && shown.map((d) => {
        const warn = isWarning(d)
        const fullEstimate = estimateLabel(d, now)
        return (
          <div
            className={`device${d.online ? '' : ' device--offline'}`}
            key={d.id}
            title={!showTimeEstimate && fullEstimate ? fullEstimate : undefined}
          >
            <div className="device__row">
              <div className="device__left">
                <DeviceTypeIcon type={d.deviceType} size={14} color="rgba(255,255,255,0.45)" />
                <span className="device__name" title={d.displayName}>
                  {d.displayName}
                </span>
              </div>
              <span className="device__battery">
                <BatteryIcon
                  level={d.lastBattery}
                  charging={d.charging}
                  warn={warn}
                  size={22}
                  lowThreshold={lowThreshold}
                  warnColorThreshold={warnColorThreshold}
                  dynamicColorMode={dynamicColorMode}
                />
                <span className={`device__pct${warn ? ' device__pct--warn' : ''}`}>
                  {d.lastBattery !== null ? `${d.lastBattery}%` : '—'}
                </span>
              </span>
            </div>
            {showTimeEstimate && fullEstimate && (
              <div className="device__estimate">{fullEstimate}</div>
            )}
          </div>
        )
      })}
    </div>
  )
}
