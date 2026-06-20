# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Windows system-tray Electron app that shows battery levels for paired Bluetooth devices and vendor-specific HID devices (Razer mice, Sony DualSense). Built with electron-vite + React + TypeScript. Windows-only.

## Commands

```bash
npm run dev        # hot-reload dev mode (electron-vite dev)
npm run build      # compile to out/
npm run dist       # build + package NSIS installer → dist/
npm run dist:dir   # build + package unpacked dir (faster, no installer)
```

No test suite currently. TypeScript is the primary correctness check — the build will fail on type errors.

## Documentation

Any code change that affects architecture, settings, IPC channels, shared types, file structure, or user-facing behaviour must be accompanied by corresponding updates to both `CLAUDE.md` and `README.md`.

## Architecture

### Three Electron processes

**Main** (`src/main/`) — Node.js process, owns all system access:
- `index.ts` — entry point, wires IPC handlers, starts the polling loop, registers the `Alt+B` global hotkey to toggle the panel
- `bluetooth.ts` — spawns `bt-battery.ps1` via `powershell.exe`, parses its JSON output into `ProbeResult[]`
- `vendor.ts` — reads battery from HID devices that don't surface through Windows PnP (Razer via feature reports, DualSense via input reports); caches the last-working Razer HID path in `razerPath` to avoid reopening every interface each poll
- `poller.ts` — merges both probe sources, derives charging state trend, fires low-battery `Notification`s, drives the interval timer; uses a `warned` Set to suppress duplicate low-battery notifications until the device recovers above the threshold
- `store.ts` — `electron-store` wrapper; persists `DeviceRecord` registry + `AppSettings`; exposes `DeviceView` (adds `displayName`) to the renderer
- `windows.ts` — creates/manages the three `BrowserWindow`s: floating panel, settings, about; `broadcast()` sends to all three simultaneously on every update
- `tray.ts` — tray icon + context menu; left-click toggles panel, right-click shows menu (Settings / About / Quit)
- `icons.ts` — generates the tray icon programmatically as an RGBA PNG via `nativeImage` (adapts to dark/light OS theme); the `trayTemplate.png` in resources is unused

**Preload** (`src/preload/index.ts`) — bridges IPC to `window.api` via `contextBridge`. The exported `Api` type is the authoritative contract for what the renderer can call. Event listener methods (`onDevicesUpdate`, `onSettingsUpdate`) return an unsubscribe function for use in `useEffect` cleanup. IPC channel names are defined as constants in `src/shared/ipc.ts` (`IPC` object) — always use those, never raw strings.

**Renderer** (`src/renderer/`) — React SPA. All three windows share the same bundle; routing is hash-based (`#/panel`, `#/settings`, `#/about`) handled in `App.tsx`. Components must not assume which window they're in beyond the URL hash.
- `hooks/useDevices.ts` — subscribes to `devices:update` push events
- `hooks/useSettings.ts` — subscribes to `settings:update` push events
- `utils/battery.ts` — `levelColor()` computes indicator color from level + thresholds (fixed or dynamic interpolation); `isWarning()` checks per-device warn state

### Data flow

```
bt-battery.ps1 ──┐
                 ├─► poller.ts merge ──► store (DeviceRecord[]) ──► broadcast('devices:update') ──► renderer
vendor HID     ──┘
```

The polling loop (`poller.ts`) runs on a configurable interval (`pollIntervalSec`). Each cycle runs both probes in parallel (`Promise.all`), merges results by device id (vendor HID takes priority for battery/charging), updates the `electron-store` registry, and broadcasts the new `DeviceView[]` to all open windows.

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

### Key design constraints

- **Windows-only**: `bt-battery.ps1` uses `Win32_PnPEntity` / `Get-PnpDevice` / `DEVPKEY_Bluetooth_Battery`. There is no cross-platform fallback.
- **node-hid is native**: `asarUnpack` in `electron-builder.yml` unpacks it so the `.node` binary is accessible at runtime.
- **PowerShell script ships as `extraResources`**: packaged to `resources/scripts/bt-battery.ps1`; `bluetooth.ts` checks both dev and packaged paths.
- **Frameless transparent panel**: `resizable: false` on Windows blocks programmatic resize, so `windows.ts` toggles `setResizable` around every `setBounds` call.
- **Charging state is inferred** for standard BT devices (level went up → charging, down → discharging, same → idle); vendor HID sources report it directly.
- **Single-instance lock**: a second app launch re-focuses the settings window instead of spawning a new process.

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
