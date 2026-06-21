import { useEffect, useRef, useState } from 'react'
import { useDevices } from '../hooks/useDevices'
import DeviceRow from '../components/DeviceRow'
import type { AppSettings, DeviceConfigPatch, DeviceView } from '../../../shared/types'
import '../styles/settings.css'

type Tab = 'general' | 'devices'

export default function Settings(): JSX.Element {
  const [tab, setTab] = useState<Tab>('general')
  const { devices, loading } = useDevices()
  const [settings, setSettings] = useState<AppSettings | null>(null)

  const [refreshing, setRefreshing] = useState(false)
  const [localDevices, setLocalDevices] = useState<DeviceView[]>([])
  const [dragging, setDragging] = useState(false)
  const [dropTarget, setDropTarget] = useState<{ id: string; position: 'before' | 'after' } | null>(null)
  const dragSrcId = useRef<string | null>(null)

  const resetDrag = (): void => {
    setDragging(false)
    setDropTarget(null)
    dragSrcId.current = null
  }

  useEffect(() => {
    window.api.getSettings().then(setSettings)
  }, [])

  useEffect(() => {
    if (!dragging) setLocalDevices(devices)
  }, [devices, dragging])

  const patchSettings = (patch: Partial<AppSettings>): void => {
    setSettings((prev) => (prev ? { ...prev, ...patch } : prev))
    window.api.setSettings(patch).then(setSettings)
  }

  const patchDevice = (id: string, patch: DeviceConfigPatch): void => {
    window.api.setDeviceConfig(id, patch)
  }

  const handleDeleteDevice = (id: string): void => {
    window.api.deleteDevice(id)
  }

  const handleDragStart = (id: string): void => {
    dragSrcId.current = id
    setDragging(true)
  }

  const handleDragOver = (e: React.DragEvent, id: string): void => {
    e.preventDefault()
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const position: 'before' | 'after' = e.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
    setDropTarget({ id, position })
  }

  const handleDrop = (targetId: string): void => {
    const srcId = dragSrcId.current
    if (!srcId || srcId === targetId) {
      resetDrag()
      return
    }

    const srcIndex = localDevices.findIndex((d) => d.id === srcId)
    const tgtIndex = localDevices.findIndex((d) => d.id === targetId)
    if (srcIndex === -1 || tgtIndex === -1) {
      resetDrag()
      return
    }

    const position = dropTarget?.position ?? 'after'
    let insertSlot = position === 'before' ? tgtIndex : tgtIndex + 1
    const reordered = [...localDevices]
    const [moved] = reordered.splice(srcIndex, 1)
    if (insertSlot > srcIndex) insertSlot--
    reordered.splice(insertSlot, 0, moved)

    setLocalDevices(reordered)
    resetDrag()
    window.api.reorderDevices(reordered.map((d) => d.id))
  }

  const handleDragEnd = (): void => {
    resetDrag()
  }

  return (
    <div className="settings">
      <nav className="settings__tabs">
        <button
          className={tab === 'general' ? 'active' : ''}
          onClick={() => setTab('general')}
        >
          General
        </button>
        <button
          className={tab === 'devices' ? 'active' : ''}
          onClick={() => setTab('devices')}
        >
          Devices
        </button>
      </nav>

      <div className="settings__body">
        {tab === 'general' && settings && (
          <section className="general">
            <label className="field">
              <span>Refresh interval (seconds)</span>
              <input
                type="number"
                min={10}
                max={3600}
                value={settings.pollIntervalSec}
                onChange={(e) =>
                  patchSettings({ pollIntervalSec: Math.max(10, Number(e.target.value)) })
                }
              />
            </label>

            <label className="field field--check">
              <input
                type="checkbox"
                checked={settings.dynamicColorMode}
                onChange={(e) => patchSettings({ dynamicColorMode: e.target.checked })}
              />
              <span>Dynamic indicator color</span>
            </label>

            <label className="field">
              <span>Low-battery threshold (%)</span>
              <input
                type="number"
                min={1}
                max={100}
                value={settings.lowColorThreshold}
                onChange={(e) =>
                  patchSettings({ lowColorThreshold: Number(e.target.value) })
                }
              />
            </label>

            <label className="field">
              <span>Warn color threshold (%)</span>
              <input
                type="number"
                min={1}
                max={100}
                value={settings.warnColorThreshold}
                onChange={(e) =>
                  patchSettings({ warnColorThreshold: Number(e.target.value) })
                }
              />
            </label>

            <label className="field">
              <span>Panel background opacity</span>
              <span className="slider">
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={settings.panelOpacity}
                  onChange={(e) => patchSettings({ panelOpacity: Number(e.target.value) })}
                />
                <span className="slider__value">{settings.panelOpacity}%</span>
              </span>
            </label>

            <label className="field">
              <span>Panel corner</span>
              <select
                value={settings.panelCorner}
                onChange={(e) =>
                  patchSettings({ panelCorner: e.target.value as AppSettings['panelCorner'] })
                }
              >
                <option value="top-left">Top-left</option>
                <option value="top-right">Top-right</option>
                <option value="bottom-left">Bottom-left</option>
                <option value="bottom-right">Bottom-right</option>
              </select>
            </label>

            <label className="field">
              <span>Horizontal offset (px)</span>
              <input
                type="number"
                min={0}
                max={1000}
                value={settings.panelMarginX}
                onChange={(e) => patchSettings({ panelMarginX: Number(e.target.value) })}
              />
            </label>

            <label className="field">
              <span>Vertical offset (px)</span>
              <input
                type="number"
                min={0}
                max={1000}
                value={settings.panelMarginY}
                onChange={(e) => patchSettings({ panelMarginY: Number(e.target.value) })}
              />
            </label>

            <label className="field field--check">
              <input
                type="checkbox"
                checked={settings.compactPanel}
                onChange={(e) => patchSettings({ compactPanel: e.target.checked })}
              />
              <span>Compact panel view</span>
            </label>

            {settings.compactPanel && (
              <label className="field">
                <span>Compact ring size</span>
                <span className="slider">
                  <input
                    type="range"
                    min={24}
                    max={96}
                    value={settings.compactCircleSize}
                    onChange={(e) => patchSettings({ compactCircleSize: Number(e.target.value) })}
                  />
                  <span className="slider__value">{settings.compactCircleSize}px</span>
                </span>
              </label>
            )}
            <label className="field field--check">
              <input
                  type="checkbox"
                  checked={settings.autoLaunch}
                  onChange={(e) => patchSettings({ autoLaunch: e.target.checked })}
              />
              <span>Start automatically when I sign in to Windows</span>
            </label>
          </section>
        )}

        {tab === 'devices' && (
          <section className="devices">
            {loading && <p className="hint">Scanning…</p>}
            {!loading && devices.length === 0 && (
              <p className="hint">
                No Bluetooth devices found yet. Connect a device and wait for the next
                refresh.
              </p>
            )}
            {!loading && devices.length > 0 && (
              <table className="devices__table">
                <thead>
                  <tr>
                    <th className="col-panel">Monitor</th>
                    <th className="col-status">State</th>
                    <th className="col-type">Type</th>
                    <th>Device</th>
                    <th>Battery</th>
                    <th className="col-warn">Low warning</th>
                    <th />
                    <th className="col-drag" />
                  </tr>
                </thead>
                <tbody>
                  {localDevices.map((d) => (
                    <DeviceRow
                      key={d.id}
                      device={d}
                      onChange={(p) => patchDevice(d.id, p)}
                      onDelete={() => handleDeleteDevice(d.id)}
                      onDragStart={() => handleDragStart(d.id)}
                      onDragOver={(e) => handleDragOver(e, d.id)}
                      onDrop={() => handleDrop(d.id)}
                      onDragEnd={handleDragEnd}
                      dropIndicator={
                        dropTarget?.id === d.id && dragSrcId.current !== d.id
                          ? dropTarget.position
                          : null
                      }
                    />
                  ))}
                </tbody>
              </table>
            )}
            <div className="refresh-wrap">
              <button
                className="refresh"
                disabled={refreshing}
                onClick={async () => {
                  setRefreshing(true)
                  try {
                    await window.api.refreshDevices()
                  } finally {
                    setRefreshing(false)
                  }
                }}
              >
                Refresh now
              </button>
              {refreshing && <span className="refresh-spinner" aria-label="Refreshing…" />}
            </div>
          </section>
        )}
      </div>
    </div>
  )
}
