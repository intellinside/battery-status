import { app, ipcMain } from 'electron'
import { createTray } from './tray'
import {
  broadcast,
  hidePanel,
  repositionPanel,
  resizePanel,
  showAbout,
  showSettings,
  showPanelOnStartup
} from './windows'
import { reschedulePolling, runOnce, startPolling, stopPolling } from './poller'
import {
  getDeviceViews,
  getSettings,
  setSettings,
  updateDeviceConfig,
  reorderDevices
} from './store'
import type { AppInfo, AppSettings, DeviceConfigPatch, WindowAction } from '../shared/types'

const DEVICES_UPDATE = 'devices:update'
const SETTINGS_UPDATE = 'settings:update'

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
  registerIpc()

  const settings = getSettings()
  applyAutoLaunch(settings.autoLaunch)

  startPolling((devices) => broadcast(DEVICES_UPDATE, devices))

  if (settings.panelVisible !== false) {
    showPanelOnStartup(t)
  }

  // Keep running with no windows open.
  app.on('window-all-closed', (e: Electron.Event) => e.preventDefault())
}

function registerIpc(): void {
  ipcMain.handle('devices:get', () => getDeviceViews())

  ipcMain.handle('devices:setConfig', (_e, id: string, patch: DeviceConfigPatch) => {
    updateDeviceConfig(id, patch)
    const views = getDeviceViews()
    broadcast(DEVICES_UPDATE, views)
    return views
  })

  ipcMain.handle('devices:refresh', async () => {
    await runOnce()
    return getDeviceViews()
  })

  ipcMain.handle('devices:reorder', (_e, ids: string[]) => {
    const views = reorderDevices(ids)
    broadcast(DEVICES_UPDATE, views)
    return views
  })

  ipcMain.handle('settings:get', (): AppSettings => getSettings())

  ipcMain.handle('settings:set', (_e, patch: Partial<AppSettings>): AppSettings => {
    const next = setSettings(patch)
    broadcast(SETTINGS_UPDATE, next)

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

  ipcMain.on('panel:resize', (_e, size: { width: number; height: number }) => {
    resizePanel(size.width, size.height)
  })

  ipcMain.handle(
    'app:info',
    (): AppInfo => ({
      name: app.getName(),
      version: app.getVersion(),
      author: 'intellinside <devbyside@gmail.com>'
    })
  )

  ipcMain.on('window:action', (_e, action: WindowAction) => {
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

app.on('before-quit', () => stopPolling())
