import { spawn } from 'child_process'
import type { ChildProcess } from 'child_process'
import { app } from 'electron'
import { join } from 'path'
import { existsSync } from 'fs'
import type { ProbeResult } from '../shared/types'

type UpdateListener = (devices: ProbeResult[]) => void

let proc: ChildProcess | null = null
let lastDevices: ProbeResult[] = []
let updateListener: UpdateListener | null = null
let restartCount = 0
let restartTimer: NodeJS.Timeout | null = null
let stopping = false
let stopResolve: (() => void) | null = null
let stopKillTimer: NodeJS.Timeout | null = null
const MAX_RESTARTS = 5

function helperPath(): string {
  const candidates = [
    join(process.resourcesPath ?? '', 'scripts', 'devicehelper.exe'),
    join(app.getAppPath(), 'src', 'main', 'scripts', 'devicehelper.exe'),
    join(__dirname, '..', '..', 'src', 'main', 'scripts', 'devicehelper.exe')
  ]
  return candidates.find((p) => p && existsSync(p)) ?? candidates[0]
}

function parseJsonLine(line: string): void {
  const text = line.trim()
  if (!text) return
  try {
    const msg = JSON.parse(text)
    if (!Array.isArray(msg?.devices)) return
    const devices: ProbeResult[] = msg.devices
      .filter((d: unknown) => d && typeof (d as Record<string, unknown>).id === 'string')
      .map((d: Record<string, unknown>) => ({
        id: String(d.id),
        name: typeof d.name === 'string' ? d.name : String(d.id),
        address: typeof d.address === 'string' ? d.address : String(d.id),
        online: Boolean(d.online),
        battery:
          d.battery === null || d.battery === undefined ? null : Number(d.battery),
        charging:
          d.charging === 'charging' ? 'charging'
          : d.charging === 'discharging' ? 'discharging'
          : undefined
      }))
    lastDevices = devices
    updateListener?.(devices)
  } catch (e) {
    console.error('[devicehelper] parse error:', (e as Error).message)
  }
}

function spawnHelper(): void {
  const exePath = helperPath()
  if (!existsSync(exePath)) {
    console.error('[devicehelper] binary not found at', exePath)
    return
  }

  console.log('[devicehelper] spawning', exePath)
  proc = spawn(exePath, [], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })

  let buffer = ''
  proc.stdout?.on('data', (chunk: Buffer) => {
    buffer += chunk.toString('utf8')
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) parseJsonLine(line)
  })

  proc.stderr?.on('data', (chunk: Buffer) => {
    console.log('[devicehelper]', chunk.toString('utf8').trim())
  })

  proc.on('exit', (code) => {
    console.warn(`[devicehelper] exited (code ${code})`)
    proc = null
    if (stopKillTimer) { clearTimeout(stopKillTimer); stopKillTimer = null }
    if (stopResolve) { const res = stopResolve; stopResolve = null; res() }
    if (!stopping && restartCount < MAX_RESTARTS) {
      restartCount++
      console.log(`[devicehelper] restarting in 2s (attempt ${restartCount}/${MAX_RESTARTS})`)
      restartTimer = setTimeout(spawnHelper, 2000)
    } else if (!stopping) {
      console.error('[devicehelper] max restarts reached, giving up')
    }
  })

  proc.on('error', (err) => {
    console.error('[devicehelper] spawn error:', err.message)
  })
}

export function startDeviceHelper(onUpdate: UpdateListener): void {
  updateListener = onUpdate
  restartCount = 0
  stopping = false
  spawnHelper()
}

export function stopDeviceHelper(): Promise<void> {
  if (restartTimer) { clearTimeout(restartTimer); restartTimer = null }
  stopping = true
  updateListener = null
  if (!proc) return Promise.resolve()
  return new Promise<void>((resolve) => {
    stopResolve = resolve
    try { proc!.stdin?.write('quit\n') } catch { }
    stopKillTimer = setTimeout(() => {
      console.warn('[devicehelper] quit timeout, force-killing')
      stopResolve = null
      proc?.kill()
      proc = null
      resolve()
    }, 3000)
  })
}

export function getLastDevices(): ProbeResult[] {
  return lastDevices
}

export function requestRefresh(): void {
  if (proc?.stdin?.writable) {
    try { proc.stdin.write('refresh\n') } catch { }
  }
}

// Kept for backwards-compat with poller.ts runOnce signature
export function probeDevices(): Promise<ProbeResult[]> {
  return Promise.resolve(lastDevices)
}
