import { execFile } from 'child_process'
import { app } from 'electron'
import { join } from 'path'
import { existsSync } from 'fs'
import type { ProbeResult } from '../shared/types'

/**
 * Locate the PowerShell probe script in both dev (source tree) and packaged
 * (extraResources) layouts.
 */
function scriptPath(): string {
  const candidates = [
    join(process.resourcesPath ?? '', 'scripts', 'bt-battery.ps1'),
    join(app.getAppPath(), 'src', 'main', 'scripts', 'bt-battery.ps1'),
    join(__dirname, '..', '..', 'src', 'main', 'scripts', 'bt-battery.ps1')
  ]
  return candidates.find((p) => p && existsSync(p)) ?? candidates[0]
}

/** Run the PowerShell probe once and return the parsed device list. */
export function probeDevices(): Promise<ProbeResult[]> {
  const script = scriptPath()
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script],
      { windowsHide: true, timeout: 30000, maxBuffer: 1024 * 1024 },
      (err, stdout) => {
        if (err) {
          console.error('[bluetooth] probe failed:', err.message)
          resolve([])
          return
        }
        resolve(parseProbeOutput(stdout))
      }
    )
  })
}

export function parseProbeOutput(stdout: string): ProbeResult[] {
  const text = stdout?.trim()
  if (!text) return []
  try {
    const parsed = JSON.parse(text)
    const arr = Array.isArray(parsed) ? parsed : [parsed]
    return arr
      .filter((d) => d && typeof d.id === 'string')
      .map((d) => ({
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
  } catch (e) {
    console.error('[bluetooth] failed to parse probe output:', (e as Error).message)
    return []
  }
}
