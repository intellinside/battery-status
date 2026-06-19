import { useEffect, useState } from 'react'
import type { DeviceView } from '../../../shared/types'

/** Subscribe to the live device list (initial fetch + push updates). */
export function useDevices(): { devices: DeviceView[]; loading: boolean } {
  const [devices, setDevices] = useState<DeviceView[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    window.api.getDevices().then((d) => {
      if (active) {
        setDevices(d)
        setLoading(false)
      }
    })
    const unsubscribe = window.api.onDevicesUpdate((d) => {
      if (active) setDevices(d)
    })
    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  return { devices, loading }
}
