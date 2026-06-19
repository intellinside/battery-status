import { app, Menu, Tray, nativeTheme } from 'electron'
import { showAbout, showSettings, togglePanel } from './windows'
import { createTrayIcon } from './icons'

let tray: Tray | null = null

export function createTray(): Tray {
  tray = new Tray(createTrayIcon(nativeTheme.shouldUseDarkColors))
  tray.setToolTip('Battery Status')

  nativeTheme.on('updated', () => {
    tray?.setImage(createTrayIcon(nativeTheme.shouldUseDarkColors))
  })

  const menu = Menu.buildFromTemplate([
    { label: 'Settings', click: () => showSettings() },
    { label: 'About', click: () => showAbout() },
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

export function getTray(): Tray | null {
  return tray
}
