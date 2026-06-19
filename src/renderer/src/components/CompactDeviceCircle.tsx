import DeviceTypeIcon from './DeviceTypeIcon'
import type { ChargingState, DeviceType } from '../../../shared/types'

interface Props {
  level: number | null
  charging: ChargingState
  deviceType: DeviceType
  displayName: string
  warn?: boolean
  size?: number
}

function levelColor(level: number, warn: boolean): string {
  if (warn || level <= 20) return '#e5484d'
  if (level <= 40) return '#f5a524'
  return '#46b450'
}

export default function CompactDeviceCircle({
  level,
  charging,
  deviceType,
  displayName,
  warn = false,
  size = 48
}: Props): JSX.Element {
  const strokeW = Math.max(1.5, size * 5.5 / 48)
  const r = (size - strokeW) / 2
  const cx = size / 2
  const cy = size / 2
  const circumference = 2 * Math.PI * r
  const known = level !== null && !Number.isNaN(level)
  const pct = known ? Math.min(100, Math.max(0, level as number)) : 0
  const color = known ? levelColor(pct, warn) : '#6b7079'
  const dashOffset = circumference * (1 - pct / 100)
  const iconSize = Math.round(size * 0.5)
  const boltSize = Math.round(size * 0.32)

  const tooltip = known
    ? `${displayName} – ${pct}%${charging === 'charging' ? ' (charging)' : ''}`
    : displayName

  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }} title={tooltip}>
      <svg
        width={size}
        height={size}
        style={{ display: 'block', transform: 'rotate(-90deg)' }}
        aria-hidden="true"
      >
        {/* Background track */}
        <circle
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          stroke="rgba(255,255,255,0.1)"
          strokeWidth={strokeW}
        />
        {/* Progress arc */}
        {known && pct > 0 && (
          <circle
            cx={cx}
            cy={cy}
            r={r}
            fill="none"
            stroke={color}
            strokeWidth={strokeW}
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
            strokeLinecap="round"
          />
        )}
      </svg>

      {/* Device type icon */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'rgba(255,255,255,0.7)'
        }}
      >
        <DeviceTypeIcon type={deviceType} size={iconSize} />
      </div>

      {/* Charging bolt overlay */}
      {charging === 'charging' && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            pointerEvents: 'none'
          }}
        >
          <svg width={boltSize} height={boltSize} viewBox="0 0 10 14">
            <circle cx="5" cy="7" r="5" fill="rgba(0,0,0,0.55)" />
            <path
              d="M6 1.5L2.5 7.5H5L3.5 12.5L8.5 6H6Z"
              fill={color}
              stroke="rgba(0,0,0,0.3)"
              strokeWidth="0.4"
            />
          </svg>
        </div>
      )}
    </div>
  )
}
