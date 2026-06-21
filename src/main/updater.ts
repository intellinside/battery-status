import { app } from 'electron'
import { autoUpdater } from 'electron-updater'
import { broadcast } from './windows'
import { IPC } from '../shared/ipc'
import type { UpdateStatus } from '../shared/types'

export function initUpdater(): void {
  if (!app.isPackaged) return

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('checking-for-update', () =>
    broadcast(IPC.UPDATE_STATUS, { state: 'checking' } satisfies UpdateStatus)
  )

  autoUpdater.on('update-available', ({ version }) =>
    broadcast(IPC.UPDATE_STATUS, { state: 'available', version } satisfies UpdateStatus)
  )

  autoUpdater.on('update-not-available', () =>
    broadcast(IPC.UPDATE_STATUS, { state: 'up-to-date' } satisfies UpdateStatus)
  )

  autoUpdater.on('download-progress', ({ percent }) =>
    broadcast(IPC.UPDATE_STATUS, { state: 'downloading', progress: Math.round(percent) } satisfies UpdateStatus)
  )

  autoUpdater.on('update-downloaded', ({ version }) =>
    broadcast(IPC.UPDATE_STATUS, { state: 'downloaded', version } satisfies UpdateStatus)
  )

  autoUpdater.on('error', (err) =>
    broadcast(IPC.UPDATE_STATUS, { state: 'error', error: err.message } satisfies UpdateStatus)
  )
}

export function checkForUpdates(): void {
  if (!app.isPackaged) return
  void autoUpdater.checkForUpdates()
}

export function installUpdate(): void {
  autoUpdater.quitAndInstall()
}
