# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Windows system-tray Electron app that shows battery levels for paired Bluetooth devices and vendor-specific HID devices (Razer mice, Sony DualSense). Built with electron-vite + React + TypeScript. Windows-only.

## Commands

```bash
npm run dev        # build:helper + hot-reload dev mode (electron-vite dev)
npm run build      # build:helper + compile to out/
npm run build:helper  # dotnet publish devicehelper (single-file self-contained) → src/main/scripts/devicehelper.exe
npm run dist       # build + package NSIS installer → dist/
npm run dist:dir   # build + package unpacked dir (faster, no installer)
```

No test suite currently. TypeScript is the primary correctness check — the build will fail on type errors.

**Build requirements:** .NET 10 SDK (for `build:helper`). Single-file self-contained — no runtime required on the target machine.

## Documentation

Any code change that affects architecture, settings, IPC channels, shared types, file structure, or user-facing behaviour must be accompanied by corresponding updates to both `CLAUDE.md` and `README.md`.

## Architecture

### Three Electron processes

**Main** (`src/main/`) — Node.js process, owns all system access:
- `index.ts` — entry point, wires IPC handlers, starts the polling loop, registers the `Alt+B` global hotkey to toggle the panel
- `devicehelper.ts` — manages the persistent `devicehelper.exe` child process; line-buffers stdout, parses JSON, auto-restarts on crash (max 5 retries). Exposes `startDeviceHelper`, `stopDeviceHelper`, `getLastDevices`, `requestRefresh`, `probeDevices` (compat shim).
- `poller.ts` — event-driven: `startPolling` calls `startDeviceHelper` and fires `runOnce` on every C# push event; `reschedulePolling` → `requestRefresh`; `stopPolling` → `stopDeviceHelper`. No interval timer.
- `store.ts` — `electron-store` wrapper; persists `DeviceRecord` registry + `AppSettings`; exposes `DeviceView` (adds `displayName`) to the renderer
- `windows.ts` — creates/manages the three `BrowserWindow`s: floating panel, settings, about; `broadcast()` sends to all three simultaneously on every update
- `tray.ts` — tray icon + context menu; left-click toggles panel, right-click shows menu (Settings / About / Quit)
- `icons.ts` — generates the tray icon programmatically as an RGBA PNG via `nativeImage` (adapts to dark/light OS theme); the `trayTemplate.png` in resources is unused

**C# helper** (`src/main/devicehelper/`) — `devicehelper.exe` (single-file self-contained, ~42 MB, .NET 10):
- `Program.cs` — single-file implementation with three providers + DeviceManager:
  - `BluetoothProvider` — three WinRT `DeviceWatcher`s: AEP BT Classic + AEP BT LE (both request `System.Devices.Aep.IsConnected` → `Updated` fires on connect/disconnect) + PnP (BTH nodes, `null` properties, for battery reads only); battery via `CM_Get_DevNode_Property` P/Invoke (`DEVPKEY_Bluetooth_Battery = {104EA319...} pid=2`); 60-second battery re-poll.
  - `RazerProvider` — HID class GUID watcher (VID 0x1532); 30s poll timer; Razer openrazer protocol (class 0x07, cmd 0x80=battery, cmd 0x84=charging), txId=0x1f, battery = resp[10]/255×100; opens HID interfaces with `CreateFile(desiredAccess=0, FILE_FLAG_OVERLAPPED)` as a fallback when `GENERIC_READ|WRITE` fails (mirrors hidapi `open_rw=FALSE`) — this bypasses Synapse's exclusive HID lock because the kernel HID driver services `IOCTL_HID_SET/GET_FEATURE` without checking the handle's access mask
  - `DualSenseProvider` — WinRT `HidDevice.GetDeviceSelector(0x0001, 0x0005)` watcher (VID 0x054C, PIDs 0x0CE6/0x0DF2); per-device read thread; MAC from feature report 0x09
  - `DeviceManager` — 150ms debounce, emits `{"type":"snapshot"|"update","devices":[...]}` JSON lines to stdout
- stdin: `"quit"` → graceful stop; `"refresh"` → immediate emit
- stderr: diagnostic logs only (not parsed by Node.js)

**Preload** (`src/preload/index.ts`) — bridges IPC to `window.api` via `contextBridge`. The exported `Api` type is the authoritative contract for what the renderer can call. Event listener methods (`onDevicesUpdate`, `onSettingsUpdate`) return an unsubscribe function for use in `useEffect` cleanup. IPC channel names are defined as constants in `src/shared/ipc.ts` (`IPC` object) — always use those, never raw strings.

**Renderer** (`src/renderer/`) — React SPA. All three windows share the same bundle; routing is hash-based (`#/panel`, `#/settings`, `#/about`) handled in `App.tsx`. Components must not assume which window they're in beyond the URL hash.
- `hooks/useDevices.ts` — subscribes to `devices:update` push events
- `hooks/useSettings.ts` — subscribes to `settings:update` push events
- `utils/battery.ts` — `levelColor()` computes indicator color from level + thresholds (fixed or dynamic interpolation); `isWarning()` checks per-device warn state

### Data flow

```
BluetoothProvider (WinRT DeviceWatcher) ──┐
RazerProvider     (HID watcher + poll)   ──┼─► DeviceManager merge ──► stdout JSON ──► devicehelper.ts ──► poller.ts ──► store ──► broadcast ──► renderer
DualSenseProvider (HID watcher + thread) ──┘
```

`devicehelper.exe` runs as a persistent child process. On device connect/disconnect/battery-change events it emits a JSON line. `devicehelper.ts` in the main process line-buffers stdout, parses JSON, and invokes `onUpdate`. `poller.ts` calls `runOnce` synchronously on each event — no polling timer. `requestRefresh()` sends `"refresh\n"` to stdin triggering an immediate re-emit from C#.

New devices default `showOnPanel` and `warnEnabled` to `true` only when `battery !== null` (i.e. unknown-battery devices are hidden by default).

### IPC channels

| Channel | Direction | Purpose |
|---|---|---|
| `devices:get` | invoke | fetch current device list |
| `devices:setConfig` | invoke | patch alias/visibility/warn settings |
| `devices:refresh` | invoke | force an immediate poll |
| `devices:reorder` | invoke | persist drag-and-drop sort order |
| `devices:update` | push | broadcast after each poll |
| `settings:get` / `settings:set` | invoke | read/write `AppSettings` |
| `settings:update` | push | broadcast after settings change |
| `app:info` | invoke | name/version/author |
| `panel:resize` | send | renderer reports content size so main can resize the frameless panel |
| `window:action` | send | `closePanel`, `openSettings`, `openAbout`, `quit` |
| `update:status` | push | broadcast `UpdateStatus` on each updater state change |
| `update:check` | invoke | trigger immediate update check |
| `update:install` | invoke | quit and install downloaded update |

### Key design constraints

- **Auto-update via electron-updater**: `src/main/updater.ts` — `initUpdater()` sets up event handlers; `checkForUpdates()` is called 3 s after startup (no-op in dev). `autoDownload: true` downloads silently; `autoInstallOnAppQuit: true` installs on next quit. Status broadcast on `update:status`. Tray menu "Check for Updates" opens the About page and triggers a manual check. Publish config in `electron-builder.yml` (`provider: github, owner: intellinside, repo: battery-status`); release with `npm run dist -- --publish always` (requires `GH_TOKEN`).
- **Windows-only**: `devicehelper.exe` uses WinRT `DeviceWatcher`, `CM_Get_DevNode_Property` (cfgmgr32), and Win32 HID P/Invoke. No cross-platform fallback.
- **Battery via cfgmgr32**: Windows BT AEP does not expose battery as a WinRT property. Battery is read via `CM_Get_DevNode_Property` P/Invoke on the `BTHENUM` device node (`DEVPKEY_Bluetooth_Battery`). The PnP watcher collects instance IDs for this purpose.
- **devicehelper.exe ships as `extraResources`**: packaged to `resources/scripts/devicehelper.exe`; `devicehelper.ts` checks `resources/scripts/`, `<appPath>/src/main/scripts/`, and `__dirname` fallback paths.
- **Frameless transparent panel**: `resizable: false` on Windows blocks programmatic resize, so `windows.ts` toggles `setResizable` around every `setBounds` call.
- **Charging state is inferred** for standard BT devices (level went up → charging, down → discharging, same → idle); DualSense reports it directly via status byte nibble.
- **Single-instance lock**: a second app launch re-focuses the settings window instead of spawning a new process.
- **Razer HID access**: works with Razer Synapse running. Synapse holds MI_00 with an exclusive write lock (`shareMode=0`), but `CreateFile(desiredAccess=0)` always succeeds (Windows sharing rules only block access bits the caller *requests*), and the HID driver's `IOCTL_HID_SET/GET_FEATURE` doesn't validate the file handle's access mask — so `HidD_SetFeature`/`HidD_GetFeature` both work on zero-access handles.

### Shared types

`src/shared/types.ts` is the contract between all three processes. `ProbeResult` is internal (probe → merge); `DeviceRecord` is persisted; `DeviceView` adds `displayName` and is what the renderer receives.

`AppSettings` color fields: `lowColorThreshold` (default 20) is both the red-zone boundary and the default per-device warn threshold for new devices; `warnColorThreshold` (default 40) is the upper boundary of the orange zone; `dynamicColorMode` switches to smooth red→orange→green interpolation via `utils/battery.ts`.

`src/shared/ipc.ts` exports the `IPC` constants object with all channel name strings. Use it everywhere instead of raw string literals.

### Extending AppSettings

Adding a new setting requires four touches:

1. **`src/shared/types.ts`** — add the field to `AppSettings`
2. **`src/main/store.ts`** — add a default in `defaultSettings` and clamp/validate it in `setSettings`
3. **`src/renderer/src/pages/Settings.tsx`** — add the UI control, calling `patchSettings({ field: value })`
4. **Consumer** (e.g. `Panel.tsx`) — read via `getSettings()` / `onSettingsUpdate` and apply

`getSettings()` always spreads `defaultSettings` before the persisted store value, so new fields with defaults are safe to read from existing stores without migration.
