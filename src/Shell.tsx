import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Icon, Link, Monogram, ThemeToggle, download, toast, usePath, Modal } from './ui.tsx'
import { deleteAccount, deleteCloudData, signIn, signOut, signUp, syncAll, useSync, type SyncState } from './sync.ts'
import { allProjects } from './store.ts'

export function Header() {
  const path = usePath()
  const [open, setOpen] = useState(false)
  const nav = [
    { to: '/app', label: 'Workspace', match: (p: string) => p.startsWith('/app') },
    { to: '/docs', label: 'Docs', match: (p: string) => p.startsWith('/docs') },
    { to: '/settings', label: 'Settings', match: (p: string) => p.startsWith('/settings') },
  ]
  return (
    <>
      <div className="topstrip">Usage-based billing, made legible: attribute every dollar, then generate the change that cuts it.</div>
      <header className="hdr">
        <div className="hdr-in">
          <Link to="/" className="brand" title="Bill Audit home"><Monogram /><span>Bill Audit</span><small>for Datadog</small></Link>
          <nav className={`hdr-nav ${open ? 'open' : ''}`} aria-label="Main">
            {nav.map(n => <Link key={n.to} to={n.to} className={n.match(path) ? 'on' : ''} aria-current={n.match(path) ? 'page' : undefined} onClick={() => setOpen(false)}>{n.label}</Link>)}
          </nav>
          <div className="hdr-right">
            <ThemeToggle />
            <AccountMenu />
            {!path.startsWith('/app') && <Link to="/app" className="btn btn-outline btn-sm hide-sm">Open workspace</Link>}
            <button className="icon-btn show-sm" aria-label="Menu" aria-expanded={open} onClick={() => setOpen(!open)}><Icon name="menu" /></button>
          </div>
        </div>
      </header>
    </>
  )
}

export function Footer() {
  return (
    <footer className="ftr">
      <div className="ftr-in">
        <div className="ftr-brand"><Monogram size={22} /> <b>Bill Audit</b></div>
        <p>Built by Aryan Kansagara. Independent project, not affiliated with Datadog. Datadog is a trademark of its owner.</p>
        <nav aria-label="Footer"><Link to="/docs">Docs</Link><Link to="/docs#pricing">Price assumptions</Link><Link to="/settings">Settings</Link></nav>
      </div>
    </footer>
  )
}

const LABEL: Record<SyncState, string> = { 'signed-out': 'Local only', syncing: 'Syncing', synced: 'Synced', offline: 'Offline', error: 'Sync failed' }

export function SyncBadge() {
  const s = useSync()
  return <span className={`sync-badge ${s.state}`} title={s.message || LABEL[s.state]}><i />{LABEL[s.state]}</span>
}

export function exportAll() {
  const data = { app: 'bill-audit', exportedAt: new Date().toISOString(), projects: allProjects() }
  download(`bill-audit-export-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(data, null, 2), 'application/json')
}

function AccountMenu() {
  const s = useSync()
  const [open, setOpen] = useState(false)
  const [auth, setAuth] = useState<null | 'in' | 'up'>(null)
  const [confirm, setConfirm] = useState<null | 'cloud' | 'account'>(null)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const f = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', f)
    return () => document.removeEventListener('mousedown', f)
  }, [open])
  const run = async (fn: () => Promise<void>, ok: string) => {
    try { await fn(); toast(ok) } catch (e) { toast(e instanceof Error ? e.message : String(e), { kind: 'error' }) }
  }
  return (
    <div className="acct" ref={ref}>
      <button className={`acct-btn ${s.state}`} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)} title={s.email ? `${s.email}: ${LABEL[s.state]}` : 'Account (optional)'}>
        <Icon name={s.email ? 'cloud' : 'user'} /><i className="dot" />
        <span className="hide-sm">{s.email ? LABEL[s.state] : 'Sign in'}</span>
      </button>
      {open && (
        <div className="acct-menu" role="menu">
          {s.email ? (
            <>
              <div className="acct-who"><b>{s.email}</b><SyncBadge />{s.message && <small>{s.message}</small>}</div>
              <button role="menuitem" onClick={() => run(syncAll, 'Sync finished')}>Sync now</button>
              <button role="menuitem" onClick={exportAll}>Export all my data (JSON)</button>
              <button role="menuitem" onClick={() => { setConfirm('cloud'); setOpen(false) }}>Delete my cloud data</button>
              <button role="menuitem" className="danger" onClick={() => { setConfirm('account'); setOpen(false) }}>Delete my account</button>
              <button role="menuitem" onClick={() => run(signOut, 'Signed out. Your projects stay on this device.')}>Sign out</button>
            </>
          ) : (
            <>
              <div className="acct-who"><b>Optional account</b><small>Everything works signed out. Sign in to sync projects across devices.</small></div>
              <button role="menuitem" onClick={() => { setAuth('in'); setOpen(false) }}>Sign in</button>
              <button role="menuitem" onClick={() => { setAuth('up'); setOpen(false) }}>Create account</button>
              <button role="menuitem" onClick={exportAll}>Export all my data (JSON)</button>
            </>
          )}
        </div>
      )}
      {auth && <AuthDialog mode={auth} onClose={() => setAuth(null)} onSwitch={() => setAuth(auth === 'in' ? 'up' : 'in')} />}
      {confirm && (
        <Modal title={confirm === 'cloud' ? 'Delete cloud data?' : 'Delete your account?'} onClose={() => setConfirm(null)}>
          <p>{confirm === 'cloud'
            ? 'This removes every Bill Audit project stored in the cloud for your account. Projects on this device are kept.'
            : 'This permanently deletes your account and all of its cloud data. Projects on this device are kept and keep working offline.'}</p>
          <div className="row-end">
            <button className="btn btn-ghost" onClick={() => setConfirm(null)}>Cancel</button>
            <button className="btn btn-danger" onClick={() => { const c = confirm; setConfirm(null); void run(c === 'cloud' ? deleteCloudData : deleteAccount, c === 'cloud' ? 'Cloud data deleted' : 'Account deleted') }}>Delete</button>
          </div>
        </Modal>
      )}
    </div>
  )
}

function AuthDialog({ mode, onClose, onSwitch }: { mode: 'in' | 'up'; onClose: () => void; onSwitch: () => void }) {
  const [email, setEmail] = useState('')
  const [pw, setPw] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true); setErr('')
    try {
      await (mode === 'in' ? signIn(email, pw) : signUp(email, pw))
      toast(mode === 'in' ? 'Signed in. Projects synced.' : 'Account created. Projects synced.')
      onClose()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally { setBusy(false) }
  }
  return (
    <Modal title={mode === 'in' ? 'Sign in' : 'Create an account'} onClose={onClose}>
      <form onSubmit={submit} className="form">
        <p className="muted">Optional. Syncs project settings, mappings and monthly snapshots (not raw files) so you can pick up on another device.</p>
        <label>Email<input type="email" required autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} /></label>
        <label>Password<input type="password" required minLength={8} autoComplete={mode === 'in' ? 'current-password' : 'new-password'} value={pw} onChange={e => setPw(e.target.value)} /></label>
        {err && <p className="err" role="alert">{err}</p>}
        <div className="row-end">
          <button type="button" className="btn btn-link" onClick={onSwitch}>{mode === 'in' ? 'Need an account?' : 'Have an account?'}</button>
          <button className="btn btn-primary" disabled={busy}>{busy ? 'Working…' : mode === 'in' ? 'Sign in' : 'Create account'}</button>
        </div>
      </form>
    </Modal>
  )
}

export function Page({ children, className }: { children: ReactNode; className?: string }) {
  return <main id="main" className={className}>{children}</main>
}
