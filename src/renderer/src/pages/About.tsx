import { useEffect, useState } from 'react'
import type { AppInfo, UpdateStatus } from '../../../shared/types'
import '../styles/about.css'

export default function About(): JSX.Element {
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [update, setUpdate] = useState<UpdateStatus>({ state: 'idle' })

  useEffect(() => {
    window.api.getAppInfo().then(setInfo)
    return window.api.onUpdateStatus(setUpdate)
  }, [])

  return (
    <div className="about">
      <div className="about__logo">🔋</div>
      <h1 className="about__name">Battery Status</h1>
      <p className="about__version">Version {info?.version ?? '—'}</p>
      <div className="about__update">
        <UpdateStatusView status={update} />
      </div>
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

function UpdateStatusView({ status }: { status: UpdateStatus }): JSX.Element {
  switch (status.state) {
    case 'idle':
      return (
        <button className="about__update-btn" onClick={() => window.api.checkForUpdate()}>
          Check for updates
        </button>
      )
    case 'checking':
      return <span className="about__update-text">Checking for updates…</span>
    case 'up-to-date':
      return <span className="about__update-text about__update-text--ok">You're up to date ✓</span>
    case 'available':
      return (
        <span className="about__update-text">
          v{status.version} available — downloading…
        </span>
      )
    case 'downloading':
      return (
        <span className="about__update-text">
          Downloading… {status.progress ?? 0}%
        </span>
      )
    case 'downloaded':
      return (
        <button className="about__update-btn about__update-btn--install" onClick={() => window.api.installUpdate()}>
          v{status.version} ready — Restart to install
        </button>
      )
    case 'error':
      return (
        <div className="about__update-error">
          <span>Update error: {status.error}</span>
          <button className="about__update-btn" onClick={() => window.api.checkForUpdate()}>
            Try again
          </button>
        </div>
      )
  }
}
