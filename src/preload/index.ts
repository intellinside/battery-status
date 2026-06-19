import { contextBridge, ipcRenderer } from 'electron'
import type {
  AppInfo,
  AppSettings,
  DeviceConfigPatch,
  DeviceView,
  WindowAction
} from '../shared/types'

const api = {
  getDevices: (): Promise<DeviceView[]> => ipcRenderer.invoke('devices:get'),

  setDeviceConfig: (id: string, patch: DeviceConfigPatch): Promise<DeviceView[]> =>
    ipcRenderer.invoke('devices:setConfig', id, patch),

  refreshDevices: (): Promise<DeviceView[]> => ipcRenderer.invoke('devices:refresh'),

  reorderDevices: (ids: string[]): Promise<DeviceView[]> =>
    ipcRenderer.invoke('devices:reorder', ids),

  onDevicesUpdate: (cb: (devices: DeviceView[]) => void): (() => void) => {
    const handler = (_e: unknown, devices: DeviceView[]): void => cb(devices)
    ipcRenderer.on('devices:update', handler)
    return () => ipcRenderer.removeListener('devices:update', handler)
  },

  getSettings: (): Promise<AppSettings> => ipcRenderer.invoke('settings:get'),

  setSettings: (patch: Partial<AppSettings>): Promise<AppSettings> =>
    ipcRenderer.invoke('settings:set', patch),

  onSettingsUpdate: (cb: (settings: AppSettings) => void): (() => void) => {
    const handler = (_e: unknown, settings: AppSettings): void => cb(settings)
    ipcRenderer.on('settings:update', handler)
    return () => ipcRenderer.removeListener('settings:update', handler)
  },

  getAppInfo: (): Promise<AppInfo> => ipcRenderer.invoke('app:info'),

  reportPanelSize: (width: number, height: number): void =>
    ipcRenderer.send('panel:resize', { width, height }),

  windowAction: (action: WindowAction): void =>
    ipcRenderer.send('window:action', action)
}

export type Api = typeof api

contextBridge.exposeInMainWorld('api', api)
