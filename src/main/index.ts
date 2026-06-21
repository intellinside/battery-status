import { app, globalShortcut, ipcMain } from 'electron'
import { createTray } from './tray'
import {
  broadcast,
  hidePanel,
  repositionPanel,
  resizePanel,
  showAbout,
  showSettings,
  showPanelOnStartup,
  togglePanel
} from './windows'
import { reschedulePolling, runOnce, startPolling, stopPolling } from './poller'
import {
  getDeviceViews,
  getSettings,
  setSettings,
  updateDeviceConfig,
  reorderDevices,
  deleteDevice
} from './store'
import type { AppInfo, AppSettings, DeviceConfigPatch, WindowAction } from '../shared/types'
import { IPC } from '../shared/ipc'

// Single-instance: a second launch should just surface the existing app.
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => showSettings())
  void start()
}

function applyAutoLaunch(enabled: boolean): void {
  // Not applied in dev (electron.exe isn't the real install target).
  if (!app.isPackaged) return
  app.setLoginItemSettings({ openAtLogin: enabled, openAsHidden: true })
}

async function start(): Promise<void> {
  await app.whenReady()

  // No dock/taskbar presence — this is a tray-only app.
  app.setAppUserModelId('pro.intellinside.batterystatus')

  const t = createTray()
  globalShortcut.register('Alt+B', () => togglePanel(t))
  registerDeviceIpc()
  registerSettingsIpc()
  registerWindowIpc()

  const settings = getSettings()
  applyAutoLaunch(settings.autoLaunch)

  startPolling((devices) => broadcast(IPC.DEVICES_UPDATE, devices))

  if (settings.panelVisible) {
    showPanelOnStartup(t)
  }
}

function registerDeviceIpc(): void {
  ipcMain.handle(IPC.DEVICES_GET, () => getDeviceViews())

  ipcMain.handle(IPC.DEVICES_SET_CONFIG, (_e, id: string, patch: DeviceConfigPatch) => {
    updateDeviceConfig(id, patch)
    const views = getDeviceViews()
    broadcast(IPC.DEVICES_UPDATE, views)
    return views
  })

  ipcMain.handle(IPC.DEVICES_REFRESH, async () => {
    await runOnce()
    return getDeviceViews()
  })

  ipcMain.handle(IPC.DEVICES_REORDER, (_e, ids: string[]) => {
    const views = reorderDevices(ids)
    broadcast(IPC.DEVICES_UPDATE, views)
    return views
  })

  ipcMain.handle(IPC.DEVICES_DELETE, (_e, id: string) => {
    deleteDevice(id)
    const views = getDeviceViews()
    broadcast(IPC.DEVICES_UPDATE, views)
    return views
  })
}

function registerSettingsIpc(): void {
  ipcMain.handle(IPC.SETTINGS_GET, (): AppSettings => getSettings())

  ipcMain.handle(IPC.SETTINGS_SET, (_e, patch: Partial<AppSettings>): AppSettings => {
    const next = setSettings(patch)
    broadcast(IPC.SETTINGS_UPDATE, next)

    if (patch.autoLaunch !== undefined) applyAutoLaunch(next.autoLaunch)
    if (patch.pollIntervalSec !== undefined) reschedulePolling()

    if (
      patch.panelCorner !== undefined ||
      patch.panelMarginX !== undefined ||
      patch.panelMarginY !== undefined
    ) {
      repositionPanel()
    }
    return next
  })
}

function registerWindowIpc(): void {
  ipcMain.on(IPC.PANEL_RESIZE, (_e, size: { width: number; height: number }) => {
    resizePanel(size.width, size.height)
  })

  ipcMain.handle(
    IPC.APP_INFO,
    (): AppInfo => ({
      name: app.getName(),
      version: app.getVersion(),
      author: 'intellinside <devbyside@gmail.com>'
    })
  )

  ipcMain.on(IPC.WINDOW_ACTION, (_e, action: WindowAction) => {
    switch (action) {
      case 'closePanel':
        hidePanel()
        break
      case 'openSettings':
        showSettings()
        break
      case 'openAbout':
        showAbout()
        break
      case 'quit':
        app.quit()
        break
    }
  })
}

let quitting = false
app.on('before-quit', (e) => {
  if (quitting) return
  e.preventDefault()
  quitting = true
  stopPolling().then(() => app.quit())
})
app.on('will-quit', () => globalShortcut.unregisterAll())
