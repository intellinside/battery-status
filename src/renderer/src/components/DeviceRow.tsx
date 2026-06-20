import { useState } from 'react'
import { createPortal } from 'react-dom'
import BatteryIcon from './BatteryIcon'
import DeviceTypeIcon from './DeviceTypeIcon'
import type { DeviceConfigPatch, DeviceType, DeviceView } from '../../../shared/types'

interface Props {
  device: DeviceView
  onChange: (patch: DeviceConfigPatch) => void
  onDragStart: () => void
  onDragOver: (e: React.DragEvent) => void
  onDrop: () => void
  onDragEnd: () => void
  dropIndicator: 'before' | 'after' | null
}

interface EditState {
  alias: string
  deviceType: DeviceType
  warnEnabled: boolean
  warnThreshold: number
}

export default function DeviceRow({
  device,
  onChange,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  dropIndicator
}: Props): JSX.Element {
  const [editOpen, setEditOpen] = useState(false)
  const [edit, setEdit] = useState<EditState>({
    alias: '',
    deviceType: null,
    warnEnabled: false,
    warnThreshold: 20
  })

  const openEdit = (): void => {
    setEdit({
      alias: device.alias ?? '',
      deviceType: device.deviceType,
      warnEnabled: device.warnEnabled,
      warnThreshold: device.warnThreshold
    })
    setEditOpen(true)
  }

  const saveEdit = (): void => {
    const next = edit.alias.trim()
    onChange({
      alias: next.length ? next : null,
      deviceType: edit.deviceType,
      warnEnabled: edit.warnEnabled,
      warnThreshold: edit.warnThreshold
    })
    setEditOpen(false)
  }

  const rowClass = [
    device.online ? '' : 'row--offline',
    dropIndicator === 'before' ? 'row--drag-over-before' : '',
    dropIndicator === 'after' ? 'row--drag-over-after' : ''
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <>
      <tr
        className={rowClass}
        draggable
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDrop={onDrop}
        onDragEnd={onDragEnd}
      >
        <td className="col-panel">
          <input
            type="checkbox"
            checked={device.showOnPanel}
            onChange={(e) => onChange({ showOnPanel: e.target.checked })}
          />
        </td>

        <td className="col-status">
          <span className={`dot ${device.online ? 'dot--on' : 'dot--off'}`} />
        </td>

        <td className="col-type">
          {device.deviceType && <DeviceTypeIcon type={device.deviceType} size={16} />}
        </td>

        <td className="col-name">
          {device.alias ? (
            <>
              <div className="name-alias">{device.alias}</div>
              <div className="name-reported name-reported--dim">{device.name}</div>
              <div className="name-id">
                <code>{device.address}</code>
              </div>
            </>
          ) : (
            <>
              <div className="name-reported">{device.name}</div>
              <div className="name-id">
                <code>{device.address}</code>
              </div>
            </>
          )}
        </td>

        <td className="col-battery">
          <div className="col-battery__inner">
            <BatteryIcon level={device.lastBattery} charging={device.charging} size={28} />
            <span>{device.lastBattery !== null ? `${device.lastBattery}%` : '—'}</span>
          </div>
        </td>

        <td className="col-warn">
          {device.warnEnabled && (
            <span className="warn-label">{'< ' + device.warnThreshold + '%'}</span>
          )}
        </td>

        <td className="col-edit">
          <button className="edit-btn" onClick={openEdit}>
            Edit
          </button>
        </td>

        <td className="col-drag">
          <span className="drag-handle">
            <svg width="10" height="16" viewBox="0 0 10 16" fill="currentColor">
              <circle cx="3" cy="3" r="1.5" />
              <circle cx="7" cy="3" r="1.5" />
              <circle cx="3" cy="8" r="1.5" />
              <circle cx="7" cy="8" r="1.5" />
              <circle cx="3" cy="13" r="1.5" />
              <circle cx="7" cy="13" r="1.5" />
            </svg>
          </span>
        </td>
      </tr>

      {editOpen &&
        createPortal(
          <div className="modal-overlay" onClick={() => setEditOpen(false)}>
            <div className="modal" onClick={(e) => e.stopPropagation()}>
              <h3 className="modal__title">Edit device</h3>

              <div className="modal__device-name">{device.displayName}</div>

              <div className="modal__field">
                <span className="modal__label">Custom name</span>
                <input
                  className="modal__input"
                  type="text"
                  value={edit.alias}
                  placeholder="Custom name…"
                  onChange={(e) => setEdit((s) => ({ ...s, alias: e.target.value }))}
                  onKeyDown={(e) => e.key === 'Enter' && saveEdit()}
                />
              </div>

              <div className="modal__field">
                <span className="modal__label">Type</span>
                <select
                  className="modal__select"
                  value={edit.deviceType ?? ''}
                  onChange={(e) =>
                    setEdit((s) => ({
                      ...s,
                      deviceType: (e.target.value || null) as DeviceType
                    }))
                  }
                >
                  <option value="">None</option>
                  <option value="keyboard">Keyboard</option>
                  <option value="mouse">Mouse</option>
                  <option value="headphones">Headphones</option>
                  <option value="controller">Controller</option>
                </select>
              </div>

              <div className="modal__field modal__field--warn">
                <label className="modal__check">
                  <input
                    type="checkbox"
                    checked={edit.warnEnabled}
                    onChange={(e) => setEdit((s) => ({ ...s, warnEnabled: e.target.checked }))}
                  />
                  <span className="modal__label">Notification below</span>
                </label>
                <input
                  type="number"
                  className="modal__threshold"
                  min={1}
                  max={100}
                  value={edit.warnThreshold}
                  disabled={!edit.warnEnabled}
                  onChange={(e) =>
                    setEdit((s) => ({ ...s, warnThreshold: Number(e.target.value) }))
                  }
                />
                <span className="warn-pct">%</span>
              </div>

              <div className="modal__actions">
                <button className="modal__save" onClick={saveEdit}>
                  Save
                </button>
                <button className="modal__cancel" onClick={() => setEditOpen(false)}>
                  Cancel
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  )
}
