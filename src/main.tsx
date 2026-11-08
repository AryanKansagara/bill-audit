import { StrictMode, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import { Toasts, usePath } from './ui.tsx'
import { Landing } from './Landing.tsx'
import { Workspace } from './Workspace.tsx'
import { Docs } from './Docs.tsx'
import { Brief } from './Brief.tsx'
import { NotFound, SettingsPage } from './SettingsPage.tsx'
import { loadProjects } from './store.ts'
import { initSync } from './sync.ts'

const TITLES: [RegExp, string][] = [
  [/^\/$/, 'Bill Audit: see where your Datadog money goes'],
  [/^\/app/, 'Workspace · Bill Audit'],
  [/^\/docs/, 'Docs · Bill Audit'],
  [/^\/settings/, 'Settings · Bill Audit'],
]

function App() {
  const path = usePath()
  useEffect(() => { document.title = TITLES.find(([r]) => r.test(path))?.[1] ?? 'Not found · Bill Audit' }, [path])
  const m = path.match(/^\/app\/p\/([^/]+)(?:\/([^/]+))?\/?$/)
  let page
  if (path === '/') page = <Landing />
  else if (m && m[2] === 'brief') page = <Brief id={m[1]} />
  else if (m) page = <Workspace id={m[1]} tab={m[2]} />
  else if (path === '/app' || path === '/app/') page = <Workspace />
  else if (path === '/docs' || path === '/docs/') page = <Docs />
  else if (path === '/settings' || path === '/settings/') page = <SettingsPage />
  else page = <NotFound />
  return <><a href="#main" className="skip">Skip to content</a>{page}<Toasts /></>
}

void loadProjects().then(() => initSync())
createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)
