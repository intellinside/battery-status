import { BrowserWindow, Tray, screen, shell } from 'electron'
import { join } from 'path'
import { getSettings, setSettings } from './store'

const preloadPath = join(__dirname, '../preload/index.js')
const isDev = !!process.env['ELECTRON_RENDERER_URL']

function loadRoute(win: BrowserWindow, route: string): void {
  if (isDev) {
    void win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}#/${route}`)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'), { hash: route })
  }
}

let panel: BrowserWindow | null = null
let settings: BrowserWindow | null = null
let about: BrowserWindow | null = null
let trayRef: Tray | null = null
let pendingShow = false

/* -------------------------------------------------------------------------- */
/* Floating panel                                                             */
/* -------------------------------------------------------------------------- */

function createPanel(): BrowserWindow {
  const win = new BrowserWindow({
    width: 200,
    height: 140,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    focusable: false,
    resizable: false,
    movable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    fullscreenable: false,
    maximizable: false,
    minimizable: false,
    webPreferences: {
      preload: preloadPath,
      sandbox: false,
      contextIsolation: true
    }
  })

  // Keep above normal and topmost windows; the panel only hides via the tray toggle.
  win.setAlwaysOnTop(true, 'screen-saver')

  win.on('closed', () => {
    panel = null
  })

  loadRoute(win, 'panel')
  return win
}

/** Work area of the display the tray lives on (falls back to the primary display). */
function panelDisplay(): Electron.Display {
  return trayRef
    ? screen.getDisplayMatching(trayRef.getBounds())
    : screen.getPrimaryDisplay()
}

/** Top-left position that anchors a width×height panel to the configured corner. */
function computeCorner(width: number, height: number): { x: number; y: number } {
  const work = panelDisplay().workArea
  const { panelCorner, panelMarginX, panelMarginY } = getSettings()

  const right = panelCorner === 'top-right' || panelCorner === 'bottom-right'
  const bottom = panelCorner === 'bottom-left' || panelCorner === 'bottom-right'

  let x = right ? work.x + work.width - width - panelMarginX : work.x + panelMarginX
  let y = bottom ? work.y + work.height - height - panelMarginY : work.y + panelMarginY

  x = Math.min(Math.max(x, work.x), work.x + work.width - width)
  y = Math.min(Math.max(y, work.y), work.y + work.height - height)
  return { x: Math.round(x), y: Math.round(y) }
}

/** Resize the panel to the given content size and re-anchor it to its corner. */
function setPanelBounds(width: number, height: number): void {
  if (!panel || panel.isDestroyed()) return
  const work = panelDisplay().workArea
  const w = Math.min(420, Math.max(40, Math.round(width)))
  const h = Math.min(work.height, Math.max(40, Math.round(height)))
  const { x, y } = computeCorner(w, h)
  const cur = panel.getBounds()
  // resizable:false blocks programmatic resize on Windows — toggle it around the call.
  // Skip entirely when nothing changed to avoid the setResizable(true/false) style toggle
  // triggering SWP_FRAMECHANGED while the window is visible (causes DWM blink).
  if (cur.x !== x || cur.y !== y || cur.width !== w || cur.height !== h) {
    panel.setResizable(true)
    panel.setBounds({ x, y, width: w, height: h })
    panel.setResizable(false)
  }
  if (pendingShow) {
    pendingShow = false
    panel.setOpacity(0)
    panel.showInactive()
    // Defer opacity restore to after the current Win32 message dispatch cycle.
    // A tray click triggers OS activation messages (WM_ACTIVATEAPP etc.) that
    // cause DWM to repaint; keeping opacity=0 during that cycle hides the flash.
    setImmediate(() => {
      if (panel && !panel.isDestroyed()) panel.setOpacity(1)
    })
  }
}

/** Called from the renderer with its measured content size. */
export function resizePanel(width: number, height: number): void {
  setPanelBounds(width, height)
}

/** Re-anchor the panel at its current size (after corner/offset settings change). */
export function repositionPanel(): void {
  if (!panel || panel.isDestroyed() || !panel.isVisible()) return
  const { width, height } = panel.getBounds()
  setPanelBounds(width, height)
}

export function togglePanel(tray: Tray): void {
  trayRef = tray
  if (!panel) panel = createPanel()
  if (panel.isVisible()) {
    panel.hide()
    setSettings({ panelVisible: false })
  } else {
    pendingShow = true
    const { width, height } = panel.getBounds()
    setPanelBounds(width, height)
    setSettings({ panelVisible: true })
  }
}

export function hidePanel(): void {
  panel?.hide()
  setSettings({ panelVisible: false })
}

/** Show the panel on startup without toggling (always shows). */
export function showPanelOnStartup(tray: Tray): void {
  trayRef = tray
  if (!panel) panel = createPanel()
  const { width, height } = panel.getBounds()
  const { x, y } = computeCorner(width, height)
  panel.setPosition(Math.round(x), Math.round(y))
  panel.showInactive()
}

/* -------------------------------------------------------------------------- */
/* Settings                                                                   */
/* -------------------------------------------------------------------------- */

export function showSettings(): void {
  if (settings) {
    settings.show()
    settings.focus()
    return
  }
  settings = new BrowserWindow({
    width: 800,
    height: 560,
    minWidth: 600,
    minHeight: 420,
    title: 'Settings — Battery Status',
    autoHideMenuBar: true,
    webPreferences: { preload: preloadPath, sandbox: false, contextIsolation: true }
  })
  settings.on('closed', () => {
    settings = null
  })
  loadRoute(settings, 'settings')
}

/* -------------------------------------------------------------------------- */
/* About                                                                      */
/* -------------------------------------------------------------------------- */

export function showAbout(): void {
  if (about) {
    about.show()
    about.focus()
    return
  }
  about = new BrowserWindow({
    width: 420,
    height: 360,
    resizable: false,
    minimizable: false,
    maximizable: false,
    title: 'About — Battery Status',
    autoHideMenuBar: true,
    webPreferences: { preload: preloadPath, sandbox: false, contextIsolation: true }
  })
  about.on('closed', () => {
    about = null
  })
  about.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })
  loadRoute(about, 'about')
}

/* -------------------------------------------------------------------------- */

/** Send a payload to every open renderer. */
export function broadcast(channel: string, payload: unknown): void {
  for (const win of [panel, settings, about]) {
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
  }
}
