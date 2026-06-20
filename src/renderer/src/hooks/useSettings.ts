import { useEffect, useState } from 'react'
import type { AppSettings } from '../../../shared/types'

/** Subscribe to the current app settings (initial fetch + push updates). */
export function useSettings(): AppSettings | null {
  const [settings, setSettings] = useState<AppSettings | null>(null)

  useEffect(() => {
    let active = true
    window.api.getSettings().then((s) => {
      if (active) setSettings(s)
    })
    const unsubscribe = window.api.onSettingsUpdate((s) => {
      if (active) setSettings(s)
    })
    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  return settings
}
