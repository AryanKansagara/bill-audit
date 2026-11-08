import { useRef } from 'react'
import { Footer, Header, Page, SyncBadge, exportAll } from './Shell.tsx'
import { Icon, Link, setMode, toast, useMode } from './ui.tsx'
import { allProjects, clearLocal, putProject, type Project } from './store.ts'
import { syncAll, useSync } from './sync.ts'
import { PRICES_AS_OF } from './engine/prices.ts'

export function SettingsPage() {
  const mode = useMode()
  const sync = useSync()
  const fileRef = useRef<HTMLInputElement>(null)
  const restore = async (f?: File) => {
    if (!f) return
    try {
      const j = JSON.parse(await f.text())
      const list: Project[] = Array.isArray(j?.projects) ? j.projects : []
      if (!list.length || !list.every(p => p.id && p.name && Array.isArray(p.snapshots))) throw new Error('Not a Bill Audit export')
      for (const p of list) await putProject(p, false)
      toast(`Restored ${list.length} project${list.length === 1 ? '' : 's'}`)
    } catch (e) {
      toast(`Could not restore: ${e instanceof Error ? e.message : e}`, { kind: 'error' })
    }
  }
  const wipe = async () => {
    const backup = allProjects()
    await clearLocal()
    toast(`Deleted ${backup.length} local project${backup.length === 1 ? '' : 's'}`, { action: { label: 'Undo', run: () => void Promise.all(backup.map(p => putProject(p, false))) } })
  }
  return (
    <>
      <Header />
      <Page className="ws">
        <div className="ws-in narrow">
          <h1 className="ws-title">Settings</h1>
          <section className="card">
            <h2>Appearance</h2>
            <div className="seg" role="radiogroup" aria-label="Color mode">
              {(['light', 'dark'] as const).map(m => <button key={m} role="radio" aria-checked={mode === m} className={mode === m ? 'on' : ''} onClick={() => setMode(m)}><Icon name={m === 'light' ? 'sun' : 'moon'} /> {m === 'light' ? 'Light' : 'Dark'}</button>)}
            </div>
          </section>
          <section className="card">
            <h2>Account and sync</h2>
            {sync.email ? (
              <>
                <p>Signed in as <b>{sync.email}</b> <SyncBadge /></p>
                {sync.message && <p className="muted small">{sync.message}</p>}
                <button className="btn btn-outline btn-sm" onClick={() => void syncAll()}>Sync now</button>
              </>
            ) : <p className="muted">Not signed in. Everything works locally; use the account menu in the header to sign in or create an account for cross-device sync.</p>}
            <p className="muted small">Synced: project settings, mappings, rates, levers and parsed monthly snapshots. Stays on this device: raw import files, and any project over 3.5 MB.</p>
          </section>
          <section className="card">
            <h2>Your data</h2>
            <div className="row wrap">
              <button className="btn btn-outline btn-sm" onClick={exportAll}><Icon name="download" /> Export all (JSON)</button>
              <button className="btn btn-outline btn-sm" onClick={() => fileRef.current?.click()}><Icon name="upload" /> Restore from export</button>
              <input ref={fileRef} type="file" accept=".json" hidden onChange={e => void restore(e.target.files?.[0])} />
              <button className="btn btn-danger btn-sm" onClick={wipe}><Icon name="trash" /> Delete all local projects</button>
            </div>
          </section>
          <section className="card">
            <h2>Keyboard</h2>
            <p className="muted small">In a project: <kbd>1</kbd>–<kbd>7</kbd> switch tabs, <kbd>I</kbd> import, <kbd>B</kbd> renewal brief, <kbd>T</kbd> toggle theme, <kbd>?</kbd> shortcut help, <kbd>Esc</kbd> closes dialogs.</p>
          </section>
          <section className="card">
            <h2>About the numbers</h2>
            <p className="muted small">List prices captured {PRICES_AS_OF}. <Link to="/docs#pricing">See every assumption and source</Link>.</p>
          </section>
        </div>
      </Page>
      <Footer />
    </>
  )
}

export function NotFound() {
  return (
    <>
      <Header />
      <Page className="ws">
        <div className="ws-in empty nf">
          <p className="nf-code num">404</p>
          <h1>No line item here</h1>
          <p className="muted">This page is not on the bill. Head back to your projects or the docs.</p>
          <div className="cta-row center"><Link to="/app" className="btn btn-primary">Workspace</Link><Link to="/docs" className="btn btn-outline">Docs</Link></div>
        </div>
      </Page>
      <Footer />
    </>
  )
}
