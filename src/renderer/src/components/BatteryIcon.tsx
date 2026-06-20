import type { ChargingState } from '../../../shared/types'
import { levelColor } from '../utils/battery'

interface Props {
  level: number | null
  charging: ChargingState
  warn?: boolean
  size?: number
}

/** SVG battery whose fill scales with the charge level, with a charging bolt overlay. */
export default function BatteryIcon({
  level,
  charging,
  warn = false,
  size = 34
}: Props): JSX.Element {
  const width = size
  const height = size * 0.5
  const bodyW = width * 0.82
  const capW = width * 0.07
  const pad = Math.max(1.5, width * 0.06)
  const known = level !== null && !Number.isNaN(level)
  const pct = known ? Math.min(100, Math.max(0, level as number)) : 0
  const fillW = ((bodyW - pad * 2) * pct) / 100
  const color = known ? levelColor(pct, warn) : '#9aa0a6'

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={known ? `${pct}%` : 'battery level unknown'}
    >
      <rect
        x={1}
        y={1}
        width={bodyW - 2}
        height={height - 2}
        rx={3}
        ry={3}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.6}
        opacity={0.85}
      />
      <rect
        x={bodyW}
        y={height * 0.3}
        width={capW}
        height={height * 0.4}
        rx={1}
        fill="currentColor"
        opacity={0.85}
      />
      {known && (
        <rect x={pad} y={pad} width={fillW} height={height - pad * 2} rx={1.5} fill={color} />
      )}
      {charging === 'charging' && (
        <path
          d={`M ${bodyW * 0.52} ${height * 0.2}
              L ${bodyW * 0.38} ${height * 0.55}
              L ${bodyW * 0.5} ${height * 0.55}
              L ${bodyW * 0.46} ${height * 0.82}
              L ${bodyW * 0.62} ${height * 0.42}
              L ${bodyW * 0.5} ${height * 0.42} Z`}
          fill="#ffffff"
          stroke="#1b1b1b"
          strokeWidth={0.6}
        />
      )}
    </svg>
  )
}
