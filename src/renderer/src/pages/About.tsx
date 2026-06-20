import { useEffect, useState } from 'react'
import type { AppInfo } from '../../../shared/types'
import '../styles/about.css'

export default function About(): JSX.Element {
  const [info, setInfo] = useState<AppInfo | null>(null)

  useEffect(() => {
    window.api.getAppInfo().then(setInfo)
  }, [])

  return (
    <div className="about">
      <div className="about__logo">🔋</div>
      <h1 className="about__name">Battery Status</h1>
      <p className="about__version">Version {info?.version ?? '—'}</p>
      <p className="about__desc">
        Shows the battery level of your connected devices in the system tray.
      </p>
      <div className="about__meta">
        <span>Developer</span>
        <strong>{info?.author ?? 'intellinside'}</strong>
      </div>
      <p className="about__copy">© 2026 intellinside</p>
    </div>
  )
}
