import { contextBridge, ipcRenderer } from 'electron'
import type {
  AppInfo,
  AppSettings,
  DeviceConfigPatch,
  DeviceView,
  UpdateStatus,
  WindowAction
} from '../shared/types'
import { IPC } from '../shared/ipc'

const api = {
  getDevices: (): Promise<DeviceView[]> => ipcRenderer.invoke(IPC.DEVICES_GET),

  setDeviceConfig: (id: string, patch: DeviceConfigPatch): Promise<DeviceView[]> =>
    ipcRenderer.invoke(IPC.DEVICES_SET_CONFIG, id, patch),

  refreshDevices: (): Promise<DeviceView[]> => ipcRenderer.invoke(IPC.DEVICES_REFRESH),

  reorderDevices: (ids: string[]): Promise<DeviceView[]> =>
    ipcRenderer.invoke(IPC.DEVICES_REORDER, ids),

  deleteDevice: (id: string): Promise<DeviceView[]> =>
    ipcRenderer.invoke(IPC.DEVICES_DELETE, id),

  onDevicesUpdate: (cb: (devices: DeviceView[]) => void): (() => void) => {
    const handler = (_e: unknown, devices: DeviceView[]): void => cb(devices)
    ipcRenderer.on(IPC.DEVICES_UPDATE, handler)
    return () => ipcRenderer.removeListener(IPC.DEVICES_UPDATE, handler)
  },

  getSettings: (): Promise<AppSettings> => ipcRenderer.invoke(IPC.SETTINGS_GET),

  setSettings: (patch: Partial<AppSettings>): Promise<AppSettings> =>
    ipcRenderer.invoke(IPC.SETTINGS_SET, patch),

  onSettingsUpdate: (cb: (settings: AppSettings) => void): (() => void) => {
    const handler = (_e: unknown, settings: AppSettings): void => cb(settings)
    ipcRenderer.on(IPC.SETTINGS_UPDATE, handler)
    return () => ipcRenderer.removeListener(IPC.SETTINGS_UPDATE, handler)
  },

  getAppInfo: (): Promise<AppInfo> => ipcRenderer.invoke(IPC.APP_INFO),

  reportPanelSize: (width: number, height: number): void =>
    ipcRenderer.send(IPC.PANEL_RESIZE, { width, height }),

  windowAction: (action: WindowAction): void =>
    ipcRenderer.send(IPC.WINDOW_ACTION, action),

  onUpdateStatus: (cb: (status: UpdateStatus) => void): (() => void) => {
    const handler = (_e: unknown, status: UpdateStatus): void => cb(status)
    ipcRenderer.on(IPC.UPDATE_STATUS, handler)
    return () => ipcRenderer.removeListener(IPC.UPDATE_STATUS, handler)
  },

  checkForUpdate: (): Promise<void> => ipcRenderer.invoke(IPC.UPDATE_CHECK),

  installUpdate: (): Promise<void> => ipcRenderer.invoke(IPC.UPDATE_INSTALL)
}

export type Api = typeof api

contextBridge.exposeInMainWorld('api', api)
