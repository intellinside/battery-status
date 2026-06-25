import { app, Menu, Tray, nativeTheme } from 'electron'
import { showAbout, showSettings, togglePanel } from './windows'
import { checkForUpdates } from './updater'
import { createTrayIcon, createTrayIconWithBattery } from './icons'
import type { AppSettings, DeviceView } from '../shared/types'

let tray: Tray | null = null
let lastDevices: DeviceView[] = []
let lastSettings: AppSettings | null = null

export function updateTrayIcon(devices: DeviceView[], settings: AppSettings): void {
  if (devices.length > 0) lastDevices = devices
  lastSettings = settings
  const dark = nativeTheme.shouldUseDarkColors
  if (settings.trayDeviceId) {
    const pool = devices.length > 0 ? devices : lastDevices
    const d = pool.find((dev) => dev.id === settings.trayDeviceId)
    console.log('[tray] updateTrayIcon: trayDeviceId=%s pool=%d found=%s online=%s battery=%s',
      settings.trayDeviceId, pool.length, d?.displayName ?? '—', d?.online, d?.lastBattery)
    if (d?.online && d.lastBattery !== null) {
      tray?.setImage(
        createTrayIconWithBattery(dark, d.lastBattery, settings.warnColorThreshold, settings.lowColorThreshold)
      )
      return
    }
  }
  tray?.setImage(createTrayIcon(dark))
}

export function createTray(): Tray {
  tray = new Tray(createTrayIcon(nativeTheme.shouldUseDarkColors))
  tray.setToolTip('Battery Status')

  nativeTheme.on('updated', () => {
    if (lastSettings) {
      updateTrayIcon(lastDevices, lastSettings)
    } else {
      tray?.setImage(createTrayIcon(nativeTheme.shouldUseDarkColors))
    }
  })

  const menu = Menu.buildFromTemplate([
    { label: 'Settings', click: () => showSettings() },
    { label: 'About', click: () => showAbout() },
    {
      label: 'Check for Updates',
      click: () => {
        showAbout()
        checkForUpdates()
      }
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        app.quit()
      }
    }
  ])

  // Left-click toggles the panel; right-click shows the context menu.
  tray.on('click', () => tray && togglePanel(tray))
  tray.on('right-click', () => tray?.popUpContextMenu(menu))

  return tray
}
