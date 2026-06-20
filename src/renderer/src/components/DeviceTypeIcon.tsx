import type { DeviceType } from '../../../shared/types'

interface Props {
  type: DeviceType
  size?: number
  color?: string
}

export default function DeviceTypeIcon({ type, size = 16, color = 'currentColor' }: Props): JSX.Element {
  switch (type) {
    case 'keyboard':
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-label="Keyboard">
          <rect x="1" y="3.5" width="14" height="9" rx="1.5" stroke={color} strokeWidth="1.2" />
          <rect x="3" y="5.5" width="2" height="1.5" rx="0.4" fill={color} />
          <rect x="6.5" y="5.5" width="2" height="1.5" rx="0.4" fill={color} />
          <rect x="10" y="5.5" width="2" height="1.5" rx="0.4" fill={color} />
          <rect x="3" y="8" width="2" height="1.5" rx="0.4" fill={color} />
          <rect x="6.5" y="8" width="2" height="1.5" rx="0.4" fill={color} />
          <rect x="10" y="8" width="2" height="1.5" rx="0.4" fill={color} />
          <rect x="5" y="10.5" width="6" height="1.5" rx="0.4" fill={color} />
        </svg>
      )

    case 'mouse':
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-label="Mouse">
          <path
            d="M8 1.5C5 1.5 3.5 3.8 3.5 7.5C3.5 11.2 5.5 14.5 8 14.5C10.5 14.5 12.5 11.2 12.5 7.5C12.5 3.8 11 1.5 8 1.5Z"
            stroke={color}
            strokeWidth="1.2"
          />
          <line x1="8" y1="1.5" x2="8" y2="7.5" stroke={color} strokeWidth="1.1" />
          <rect x="6.8" y="3.2" width="2.4" height="3.2" rx="1.2" fill={color} opacity="0.75" />
        </svg>
      )

    case 'headphones':
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-label="Headphones">
          <path
            d="M3 9C3 5.1 5.2 2 8 2C10.8 2 13 5.1 13 9"
            stroke={color}
            strokeWidth="1.4"
            strokeLinecap="round"
          />
          <rect x="1.5" y="8.5" width="3" height="4.5" rx="1.5" fill={color} />
          <rect x="11.5" y="8.5" width="3" height="4.5" rx="1.5" fill={color} />
        </svg>
      )

    case 'controller':
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-label="Controller">
          <path
            d="M3 6C3 4.5 4 4 5 4H11C12 4 13 4.5 13 6V10C13 11.5 12 12 11 12H10L8 10.5L6 12H5C4 12 3 11.5 3 10V6Z"
            stroke={color}
            strokeWidth="1.2"
          />
          <rect x="4.5" y="7.8" width="0.9" height="2.4" rx="0.3" fill={color} />
          <rect x="3.5" y="8.8" width="2.9" height="0.9" rx="0.3" fill={color} />
          <circle cx="10.5" cy="6.8" r="0.75" fill={color} />
          <circle cx="11.8" cy="8.2" r="0.75" fill={color} />
          <circle cx="9.2" cy="8.2" r="0.75" fill={color} />
        </svg>
      )

    case null:
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-label="Device">
          <rect x="5" y="7.5" width="6" height="5" rx="1" stroke={color} strokeWidth="1.2" />
          <rect x="7" y="11.5" width="2" height="2" rx="0.3" fill={color} />
          <path d="M4 5.5Q8 3 12 5.5" stroke={color} strokeWidth="1.2" strokeLinecap="round" fill="none" />
          <path d="M2 3.5Q8 0.5 14 3.5" stroke={color} strokeWidth="1.2" strokeLinecap="round" fill="none" />
        </svg>
      )
  }
}
