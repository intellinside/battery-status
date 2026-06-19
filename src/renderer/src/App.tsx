import { useEffect, useState } from 'react'
import Panel from './pages/Panel'
import Settings from './pages/Settings'
import About from './pages/About'

function currentRoute(): string {
  return window.location.hash.replace(/^#\/?/, '') || 'panel'
}

export default function App(): JSX.Element {
  const [route, setRoute] = useState(currentRoute())

  useEffect(() => {
    const onHashChange = (): void => setRoute(currentRoute())
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  switch (route) {
    case 'settings':
      return <Settings />
    case 'about':
      return <About />
    case 'panel':
    default:
      return <Panel />
  }
}
