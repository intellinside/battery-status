# Battery Status

Windows system-tray app that shows battery levels for paired Bluetooth devices and vendor-specific HID devices (Razer mice, Sony DualSense).

---

## For users

### What it does

- Floats a transparent panel on your desktop showing the battery level of every connected Bluetooth device
- Sends a Windows notification when a device drops below its configured threshold
- Supports Razer wireless mice (via USB dongle) and Sony DualSense controllers, whose battery level Windows does not expose through the standard Bluetooth API
- Shows charging state (charging / discharging / idle) for each device
- Lives entirely in the system tray — no taskbar presence

### Requirements

- Windows 10 or 11
- Bluetooth adapter (for Bluetooth devices)
- PowerShell (built into Windows — no additional install needed)

### Installation

1. Download the NSIS installer from the Releases page and run it.
2. The app starts automatically and places an icon in the system tray.
3. Right-click the tray icon to open Settings, show/hide the panel, or quit.

### Panel

The floating panel appears in a corner of the screen and lists every device that is currently connected and configured to be shown. Two display modes are available:

- **List view** (default) — device name + battery percentage with a coloured battery icon
- **Compact view** — a horizontal strip of circular battery rings (configurable size)

The panel snaps to a screen corner. You can drag the corner and offset positions in Settings.

### Settings — General tab

| Setting | Default | Description |
|---|---|---|
| Refresh interval | 60 s | How often battery levels are polled |
| Default low-battery threshold | 20 % | Threshold applied to newly discovered devices |
| Panel background opacity | 85 % | Transparency of the floating panel |
| Panel corner | Bottom-right | Which screen corner the panel snaps to |
| Horizontal offset | 8 px | Distance from the left/right screen edge |
| Vertical offset | 8 px | Distance from the taskbar/top edge |
| Start automatically | On | Launch the app when you sign in to Windows |
| Compact panel view | Off | Switch to circular ring display mode |
| Compact ring size | 48 px | Diameter of each ring in compact mode (24–96 px) |

### Settings — Devices tab

Each paired device appears in a table. Per-device options:

| Column | Description |
|---|---|
| Monitor | Show/hide on the panel |
| Type | Device icon (keyboard, mouse, headphones, controller) — click to cycle |
| Device / alias | Click to rename; the system name is shown in a tooltip |
| Battery | Last known level |
| Low warning | Enable/disable and set the threshold for this device |

Drag rows to reorder. Click **Refresh now** to force an immediate poll.

### Supported devices

| Category | How it works |
|---|---|
| Standard Bluetooth (keyboards, headphones, mice, …) | Windows PnP via `DEVPKEY_Bluetooth_Battery`; connection state from WinRT APIs |
| Razer wireless mice (USB dongle) | Vendor HID feature report (class 0x07, commands 0x80 / 0x84) |
| Sony DualSense (USB or Bluetooth) | HID input report 0x01 (USB, byte 53) or 0x31 (BT, byte 54) |

Devices whose battery Windows cannot read are still listed in the Devices tab (so you can hide them) but are hidden from the panel by default.

---

## For developers

### Stack

| Layer | Technology |
|---|---|
| Framework | Electron 31 + electron-vite |
| UI | React 18 + TypeScript |
| Build | Vite 5 |
| Packaging | electron-builder (NSIS installer) |
| Persistence | electron-store |
| HID access | node-hid (native module, asar-unpacked) |
| Bluetooth probe | PowerShell script via `child_process.execFile` |

### Commands

```bash
npm run dev        # hot-reload dev mode (electron-vite dev)
npm run build      # compile TypeScript → out/
npm run dist       # build + package NSIS installer → dist/
npm run dist:dir   # build + package unpacked directory (faster, no installer)
```

TypeScript is the primary correctness check — there is no test suite. A type error will fail the build.

### Project layout

```
src/
  main/           Node.js (main process)
    index.ts      Entry point, IPC handlers, app lifecycle
    bluetooth.ts  PowerShell probe — parses Bluetooth battery via PnP
    vendor.ts     HID probe — Razer and DualSense battery
    poller.ts     Polling loop, merge, low-battery notifications
    store.ts      electron-store wrapper — DeviceRecord registry + AppSettings
    windows.ts    Three BrowserWindows: panel, settings, about
    tray.ts       Tray icon + context menu
    icons.ts      Tray icon generation
    scripts/
      bt-battery.ps1   PowerShell Bluetooth probe script
  preload/
    index.ts      contextBridge — exposes window.api to the renderer
    index.d.ts    Type declaration for window.api
  renderer/
    src/
      App.tsx           Hash-based router (#/panel, #/settings, #/about)
      pages/
        Panel.tsx       Floating battery panel
        Settings.tsx    Settings window (General + Devices tabs)
        About.tsx       About window
      components/
        BatteryIcon.tsx         SVG battery icon with charging/warn states
        CompactDeviceCircle.tsx Circular ring for compact mode
        DeviceRow.tsx           Row component for Devices tab
        DeviceTypeIcon.tsx      Device type SVG icons
      hooks/
        useDevices.ts   Subscribes to devices:update IPC push events
  shared/
    types.ts      Shared type contracts (ProbeResult, DeviceRecord, DeviceView, AppSettings, …)
resources/
  icon.ico / icon.png   App icon
  trayTemplate.png      Tray icon (dark mode)
electron-builder.yml    Packaging config
electron.vite.config.ts Vite config
```

### Architecture

The app has three Electron processes with a strict one-way data flow:

```
bt-battery.ps1 ──┐
                 ├─► poller.ts (merge + warn) ──► store (DeviceRecord[]) ──► broadcast ──► renderer
vendor HID     ──┘
```

**Main process** (`src/main/`) owns all system access — filesystem, HID, PowerShell, notifications, windows, tray.

**Preload** (`src/preload/index.ts`) bridges IPC to `window.api` via `contextBridge`. The exported `Api` type is the authoritative contract — prefer reading it over the raw IPC channel strings.

**Renderer** (`src/renderer/`) is a React SPA. All three windows share one bundle; the URL hash (`#/panel`, `#/settings`, `#/about`) selects the active view in `App.tsx`.

### IPC channels

| Channel | Direction | Purpose |
|---|---|---|
| `devices:get` | invoke | Fetch current device list |
| `devices:setConfig` | invoke | Patch alias / visibility / warn settings for one device |
| `devices:refresh` | invoke | Force an immediate poll |
| `devices:reorder` | invoke | Persist drag-and-drop sort order |
| `devices:update` | push (main → renderer) | Broadcast after each poll |
| `settings:get` | invoke | Read `AppSettings` |
| `settings:set` | invoke | Write partial `AppSettings` |
| `settings:update` | push (main → renderer) | Broadcast after settings change |
| `app:info` | invoke | App name / version / author |
| `panel:resize` | send (renderer → main) | Renderer reports content size so main resizes the frameless panel |
| `window:action` | send (renderer → main) | `closePanel`, `openSettings`, `openAbout`, `quit` |

### Shared types (`src/shared/types.ts`)

| Type | Description |
|---|---|
| `ProbeResult` | Raw row from a probe (bluetooth or vendor HID) |
| `DeviceRecord` | Persisted device entry (registry + battery history) |
| `DeviceView` | `DeviceRecord` + `displayName`; what the renderer receives |
| `AppSettings` | All persisted settings |
| `DeviceConfigPatch` | Partial patch applied by `devices:setConfig` |
| `ChargingState` | `'charging' \| 'discharging' \| 'idle' \| 'unknown'` |
| `DeviceType` | `'keyboard' \| 'mouse' \| 'headphones' \| 'controller' \| null` |
| `PanelCorner` | `'top-left' \| 'top-right' \| 'bottom-left' \| 'bottom-right'` |

### Polling loop (`poller.ts`)

Each cycle:
1. Runs both probes in parallel (`Promise.all([probeDevices(), probeVendorBattery()])`).
2. Merges results by device id — vendor HID results override battery/charging for matching devices and add new entries for dongle-only devices.
3. Derives charging state for standard BT devices by comparing the new level to the previous one (up → charging, down → discharging, same → idle). Vendor sources report charging state directly.
4. Updates the `electron-store` registry.
5. Fires a Windows notification for any device below its threshold (suppressed until the device recovers above the threshold via a `warned` Set).
6. Broadcasts the updated `DeviceView[]` to all open windows.

### Bluetooth probe (`bluetooth.ts` + `bt-battery.ps1`)

The PowerShell script enumerates all Bluetooth PnP entities via a fast CIM query (`Win32_PnPEntity WHERE PNPDeviceID LIKE 'BTH%'`), then batches the `DEVPKEY_Bluetooth_Battery` reads in a single pipeline over only the node types that can carry a level. Connection state uses WinRT `BluetoothDevice.GetDeviceSelectorFromConnectionStatus` (both classic and LE), which is more accurate than PnP `Status`.

The script path is resolved at runtime for both dev (`src/main/scripts/`) and packaged (`resources/scripts/`) layouts.

### Vendor HID probe (`vendor.ts`)

**Razer**: sends feature report with class `0x07` / command `0x80` (battery) and `0x84` (charging) to the first responding HID collection of the Razer VID (`0x1532`). The responding path is cached in `razerPath` to avoid reopening every interface on each poll.

**DualSense** (VID `0x054c`, PIDs `0x0ce6` / `0x0df2`): reads input report `0x01` (USB, byte 53) or `0x31` (Bluetooth, byte 54). USB and Bluetooth appearances collapse to one device record by reading the controller's MAC from feature report `0x09`.

### Windows (`windows.ts`)

Three `BrowserWindow` instances: floating panel (frameless, transparent, always-on-top), settings, about. `broadcast()` sends a given IPC event to all three simultaneously.

The panel is `resizable: false` to prevent user resizing, but programmatic resize is needed to fit content. To work around the Windows restriction that blocks `setBounds` on non-resizable windows, `windows.ts` temporarily toggles `setResizable(true)` around every `setBounds` call.

### Persistence (`store.ts`)

`electron-store` holds two keys: `settings` (an `AppSettings` object) and `devices` (a `Record<string, DeviceRecord>`). `getSettings()` always spreads `defaultSettings` before the stored value, so new settings fields with defaults are safe to read without a migration step.

### Adding a new setting

Four files need to change:

1. **`src/shared/types.ts`** — add the field to `AppSettings`
2. **`src/main/store.ts`** — add a default in `defaultSettings`; optionally clamp/validate in `setSettings`
3. **`src/renderer/src/pages/Settings.tsx`** — add the UI control, calling `patchSettings({ field: value })`
4. **Consumer** (e.g. `Panel.tsx`) — read via `getSettings()` / `onSettingsUpdate` and apply

### Design constraints

- **Windows-only.** The PowerShell script uses `Win32_PnPEntity`, `Get-PnpDevice`, `DEVPKEY_Bluetooth_Battery`, and WinRT APIs. There is no cross-platform fallback.
- **node-hid is native.** `asarUnpack` in `electron-builder.yml` keeps the `.node` binary outside the asar archive so it can be loaded at runtime.
- **Single-instance lock.** A second launch re-focuses the settings window instead of spawning a new process.
- **No taskbar button.** `app.setAppUserModelId` is called but `app.dock` / taskbar presence is suppressed; the app is tray-only.

### Building the installer

```bash
npm run dist
```

Outputs an NSIS installer to `dist/`. The installer is per-user (no elevation required) and creates Start Menu and Desktop shortcuts. To produce an unpacked directory instead (faster, no installer wizard):

```bash
npm run dist:dir
```
