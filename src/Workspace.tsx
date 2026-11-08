import { useEffect, useMemo, useState } from 'react'
import { Footer, Header, Page, SyncBadge } from './Shell.tsx'
import { Icon, Link, Modal, monthName, navigate, pctFmt, qty, setMode, toast, usd, usdShort, useMode } from './ui.tsx'
import { HBars, StackedMonths, TrendChart, teamColors } from './charts.tsx'
import { deleteProject, latest, newProject, putProject, updateProject, useProjects, type Project } from './store.ts'
import { unattributedSources, useAnalysis, type Analysis } from './analysis.ts'
import { DIM } from './engine/prices.ts'
import { computeBill } from './engine/model.ts'
import { openSample } from './Landing.tsx'
import { Drivers } from './Drivers.tsx'
import { LeversTab } from './LeversTab.tsx'
import { Artifacts } from './Artifacts.tsx'
import { History } from './History.tsx'
import { ImportFlow } from './ImportFlow.tsx'
import { Rates } from './Rates.tsx'

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'drivers', label: 'Drivers' },
  { id: 'levers', label: 'Levers' },
  { id: 'artifacts', label: 'Artifacts' },
  { id: 'history', label: 'History' },
  { id: 'import', label: 'Import' },
  { id: 'rates', label: 'Rates & teams' },
] as const
export type TabId = typeof TABS[number]['id']

export function Workspace({ id, tab }: { id?: string; tab?: string }) {
  const { projects, loaded } = useProjects()
  const p = id ? projects.find(x => x.id === id) : undefined
  return (
    <>
      <Header />
      <Page className="ws">
        {!loaded ? <div className="ws-in"><div className="skeleton" style={{ height: 320 }} /></div>
          : id && !p ? <Missing />
          : p ? <ProjectView p={p} tab={(TABS.find(t => t.id === tab)?.id ?? 'overview') as TabId} />
          : <ProjectList projects={projects} />}
      </Page>
      <Footer />
    </>
  )
}

function Missing() {
  return (
    <div className="ws-in empty">
      <h1>Project not found</h1>
      <p className="muted">It may have been deleted, or it lives on another device. Sign in to sync projects across devices.</p>
      <Link to="/app" className="btn btn-primary">Back to projects</Link>
    </div>
  )
}

function ProjectList({ projects }: { projects: Project[] }) {
  const [importing, setImporting] = useState(() => new URLSearchParams(location.search).has('import'))
  const sorted = [...projects].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  const create = async () => {
    const p = await putProject(newProject(`Datadog account ${projects.length + 1}`))
    navigate(`/app/p/${p.id}/import`)
  }
  if (importing) {
    return (
      <div className="ws-in">
        <div className="crumbs"><button className="btn btn-link" onClick={() => { setImporting(false); navigate('/app', true) }}>← Projects</button></div>
        <h1 className="ws-title">Import your Datadog usage</h1>
        <ImportFlow onDone={id => navigate(`/app/p/${id}`)} />
      </div>
    )
  }
  if (!projects.length) {
    return (
      <div className="ws-in">
        <div className="first-run">
          <div className="fr-art" aria-hidden="true">
            {[62, 88, 54, 100, 40, 30].map((h, i) => <span key={i} style={{ height: `${h}%`, animationDelay: `${i * 90}ms` }} />)}
          </div>
          <h1>Your Datadog bill, line by line</h1>
          <p className="muted">Start with a synthetic company to see every feature, or import your own usage exports. Nothing leaves this browser unless you sign in.</p>
          <div className="cta-row center">
            <button className="btn btn-primary" onClick={openSample}>Try the sample</button>
            <button className="btn btn-outline" onClick={() => setImporting(true)}>Import your data</button>
          </div>
          <p className="fine center">Not sure what to export? <Link to="/docs">The docs list the exact clicks and API calls.</Link></p>
        </div>
      </div>
    )
  }
  return (
    <div className="ws-in">
      <div className="ws-head">
        <h1 className="ws-title">Projects</h1>
        <div className="row">
          <button className="btn btn-ghost" onClick={openSample}>Add sample</button>
          <button className="btn btn-outline" onClick={create}><Icon name="plus" /> New project</button>
          <button className="btn btn-primary" onClick={() => setImporting(true)}><Icon name="upload" /> Import</button>
        </div>
      </div>
      <div className="proj-grid">
        {sorted.map(p => {
          const l = latest(p)
          const total = l ? computeBill(l.usage, p.settings).total : 0
          return (
            <Link key={p.id} to={`/app/p/${p.id}`} className="proj-card">
              <div className="pc-top">{p.sample && <span className="tag-synth">Synthetic</span>}<span className="muted small">{p.snapshots.length} month{p.snapshots.length === 1 ? '' : 's'}</span></div>
              <h3>{p.name}</h3>
              <div className="pc-num num">{l ? usd(total) : '—'}<small>{l ? ` / ${monthName(l.month)}` : ' no data yet'}</small></div>
              <div className="muted small">Updated {new Date(p.updatedAt).toLocaleDateString()}</div>
            </Link>
          )
        })}
      </div>
    </div>
  )
}

function ProjectView({ p, tab }: { p: Project; tab: TabId }) {
  const [month, setMonth] = useState<string | undefined>()
  const a = useAnalysis(p, month)
  const [help, setHelp] = useState(false)
  const [confirmDel, setConfirmDel] = useState(false)
  const mode = useMode()
  const go = (t: TabId) => navigate(`/app/p/${p.id}${t === 'overview' ? '' : '/' + t}`)
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      if (e.metaKey || e.ctrlKey || e.altKey || el.closest('input,textarea,select,[contenteditable]')) return
      const n = Number(e.key)
      if (n >= 1 && n <= TABS.length) go(TABS[n - 1].id)
      else if (e.key === 'i') go('import')
      else if (e.key === 'b') navigate(`/app/p/${p.id}/brief`)
      else if (e.key === 't') setMode(mode === 'dark' ? 'light' : 'dark')
      else if (e.key === '?') setHelp(true)
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  })
  const del = async () => {
    setConfirmDel(false)
    const undo = await deleteProject(p.id)
    navigate('/app')
    toast(`Deleted "${p.name}"`, { action: { label: 'Undo', run: () => void undo().then(() => toast('Restored')) } })
  }
  const months = [...p.snapshots].sort((x, y) => y.month.localeCompare(x.month))
  const noData = !a
  const content = noData && tab !== 'rates' && tab !== 'import'
    ? <NoData p={p} />
    : tab === 'overview' ? <Overview p={p} a={a!} />
    : tab === 'drivers' ? <Drivers p={p} a={a!} />
    : tab === 'levers' ? <LeversTab p={p} a={a!} />
    : tab === 'artifacts' ? <Artifacts p={p} a={a!} />
    : tab === 'history' ? <History p={p} a={a!} />
    : tab === 'import' ? <ImportFlow project={p} onDone={() => go('overview')} />
    : <Rates p={p} a={a} />
  return (
    <div className="ws-in">
      <div className="pv-head">
        <div className="pv-title">
          <Link to="/app" className="crumb">Projects /</Link>
          <input className="name-input" aria-label="Project name" value={p.name} onChange={e => void updateProject(p.id, x => ({ ...x, name: e.target.value }))} />
          {p.sample && <span className="tag-synth">Synthetic data</span>}
        </div>
        <div className="pv-actions">
          <SyncBadge />
          {months.length > 0 && (
            <label className="month-sel"><span className="sr">Billing month</span>
              <select value={a?.snap.month ?? ''} onChange={e => setMonth(e.target.value)}>
                {months.map(s => <option key={s.id} value={s.month}>{monthName(s.month, true)}</option>)}
              </select>
            </label>
          )}
          <Link to={`/app/p/${p.id}/brief`} className="btn btn-outline btn-sm" title="Renewal brief (B)"><Icon name="print" /> Brief</Link>
          <button className="icon-btn" title="Keyboard shortcuts (?)" aria-label="Keyboard shortcuts" onClick={() => setHelp(true)}><Icon name="keyboard" /></button>
          <button className="icon-btn" title="Delete project" aria-label="Delete project" onClick={() => setConfirmDel(true)}><Icon name="trash" /></button>
        </div>
      </div>
      <nav className="tabs" aria-label="Project sections">
        {TABS.map((t, i) => (
          <Link key={t.id} to={`/app/p/${p.id}${t.id === 'overview' ? '' : '/' + t.id}`} className={tab === t.id ? 'on' : ''} aria-current={tab === t.id ? 'page' : undefined} title={`${t.label} (${i + 1})`}>{t.label}</Link>
        ))}
      </nav>
      <div className="tab-body" key={tab}>{content}</div>
      {help && (
        <Modal title="Keyboard shortcuts" onClose={() => setHelp(false)}>
          <dl className="keys">
            {TABS.map((t, i) => <div key={t.id}><dt><kbd>{i + 1}</kbd></dt><dd>{t.label}</dd></div>)}
            <div><dt><kbd>I</kbd></dt><dd>Import</dd></div>
            <div><dt><kbd>B</kbd></dt><dd>Renewal brief</dd></div>
            <div><dt><kbd>T</kbd></dt><dd>Toggle light and dark</dd></div>
            <div><dt><kbd>Esc</kbd></dt><dd>Close dialogs</dd></div>
          </dl>
        </Modal>
      )}
      {confirmDel && (
        <Modal title="Delete project?" onClose={() => setConfirmDel(false)}>
          <p>"{p.name}" and its {p.snapshots.length} monthly snapshot{p.snapshots.length === 1 ? '' : 's'} will be removed from this device{''} and from the cloud if you are signed in. You can undo for a few seconds.</p>
          <div className="row-end"><button className="btn btn-ghost" onClick={() => setConfirmDel(false)}>Cancel</button><button className="btn btn-danger" onClick={del}>Delete</button></div>
        </Modal>
      )}
    </div>
  )
}

function NoData({ p }: { p: Project }) {
  return (
    <div className="empty card">
      <Icon name="upload" size={28} />
      <h2>No usage yet</h2>
      <p className="muted">Import a Usage Attribution export or the usage API JSON to see the bill, drivers and levers for this account.</p>
      <Link to={`/app/p/${p.id}/import`} className="btn btn-primary">Import usage</Link>
    </div>
  )
}

export function Kpi({ label, value, sub, tone }: { label: string; value: string; sub?: React.ReactNode; tone?: 'alert' | 'good' | 'warn' }) {
  return (
    <div className={`kpi ${tone ?? ''}`}>
      <small>{label}</small>
      <b className="num">{value}</b>
      {sub && <span>{sub}</span>}
    </div>
  )
}

function Overview({ p, a }: { p: Project; a: Analysis }) {
  const b = a.bill
  const prevBill = a.bills.length > 1 ? a.bills[a.bills.length - 2].bill.total : null
  const mom = prevBill ? b.total / prevBill - 1 : null
  const wasted = b.lines.reduce((x, l) => x + l.wastedCommitCost, 0)
  const ratio = a.fc.year.mid / a.fc.trailingYear
  const sources = useMemo(() => unattributedSources(a, p).slice(0, 4), [a, p])
  const allTeams = useMemo(() => [...new Set(a.bills.flatMap(x => x.bill.byTeam.map(t => t.team)))], [a])
  const colors = useMemo(() => teamColors(allTeams), [allTeams])
  const unPct = b.total ? b.unattributed / b.total : 0
  return (
    <div className="overview">
      <div className="kpis">
        <Kpi label={`${monthName(a.snap.month, true)} bill`} value={usd(b.total)} sub={mom !== null ? <span className={mom > 0 ? 'up' : 'down'}>{mom > 0 ? '▲' : '▼'} {pctFmt(Math.abs(mom), 1)} vs last month</span> : 'Import more months for trends'} />
        <Kpi label="Renewal year forecast" value={usdShort(a.fc.year.mid)} sub={<>{usdShort(a.fc.year.low)} to {usdShort(a.fc.year.high)} · <strong>{ratio.toFixed(2)}×</strong> {a.fc.trend.n >= 12 ? 'the last 12 months' : 'this month × 12'}</>} tone={ratio > 1.3 ? 'warn' : undefined} />
        <Kpi label="Unattributed" value={usd(b.unattributed)} sub={`${pctFmt(unPct, 1)} of the bill has no team`} tone={unPct > 0.02 ? 'alert' : 'good'} />
        <Kpi label="Unused commitments" value={usd(wasted)} sub={wasted > 0 ? 'paid this month for usage you did not have' : 'commitments fully used'} tone={wasted > 0 ? 'warn' : 'good'} />
      </div>

      {b.unattributed > 1 && (
        <div className="alert-banner" role="alert">
          <Icon name="alert" size={20} />
          <div>
            <b>{usd(b.unattributed)} a month ({pctFmt(unPct, 1)}) is not attributed to any team.</b>
            <p>Largest sources: {sources.map((s, i) => <span key={i} className="chip mono-chip">{s.label} · {DIM[s.dim as keyof typeof DIM]?.label ?? s.dim} · {usd(s.cost)}</span>)}</p>
          </div>
          <Link to={`/app/p/${p.id}/rates`} className="btn btn-sm btn-outline">Add a tag rule</Link>
        </div>
      )}

      <div className="grid-2 gap">
        <section className="card">
          <div className="card-head"><h2>Bill by product</h2><span className="legend inline"><span><i className="swatch seg-commit" />Committed</span><span><i className="swatch seg-over" />On-demand</span><span><i className="swatch seg-waste" />Unused commit</span></span></div>
          <HBars rows={b.lines.slice(0, 12).map(l => ({
            key: l.dim,
            label: DIM[l.dim].label,
            value: l.cost,
            segments: [
              { value: l.committedCost - l.wastedCommitCost, cls: 'seg-commit', title: `Committed, used: ${usd(l.committedCost - l.wastedCommitCost)}` },
              { value: l.overageCost, cls: 'seg-over', title: `On-demand: ${usd(l.overageCost)}` },
              { value: l.wastedCommitCost, cls: 'seg-waste', title: `Unused commit: ${usd(l.wastedCommitCost)}` },
            ],
            sub: <>{qty(l.qty)} {DIM[l.dim].rawUnit}{l.allotment > 0 && <> · {qty(l.allotment)} allotted</>}{l.committed > 0 && <> · {qty(l.committed)} committed</>}</>,
          }))} />
          {b.lines.length > 12 && <p className="muted small">+{b.lines.length - 12} smaller lines totalling {usd(b.lines.slice(12).reduce((x, l) => x + l.cost, 0))}</p>}
          {b.flexCompute > 0 && <p className="muted small">Includes Flex compute {usd(b.flexCompute)}.</p>}
        </section>
        <section className="card">
          <div className="card-head"><h2>Cost by team</h2><span className="muted small">tag <code>{p.settings.teamTag}</code> + {p.settings.rules.length} rule{p.settings.rules.length === 1 ? '' : 's'}</span></div>
          <HBars rows={[
            ...b.byTeam.map(t => ({ key: t.team, label: t.team, value: t.cost, color: colors.get(t.team), sub: topDims(t.byDim) })),
            { key: '__un', label: <span className="alert-text"><Icon name="alert" size={13} /> Unattributed</span>, value: b.unattributed, color: 'var(--alert)', sub: 'No team tag and no matching rule' },
          ]} />
        </section>
      </div>

      <section className="card">
        <div className="card-head">
          <h2>Monthly bill and renewal forecast</h2>
          <span className="muted small">Trend {pctFmt(a.fc.trend.growth, 1)}/month (median month-over-month) · renewal {monthName(p.settings.renewalDate.slice(0, 7), true)}</span>
        </div>
        <TrendChart actual={a.bills.map(x => ({ idx: monthIdx(x.month), value: x.bill.total }))} forecast={a.fc.months} plan={a.levers.steps.length ? a.planFc.months : undefined} renewalIdx={a.fc.renewalIdx} />
        {a.fc.trend.n < 3 && <p className="muted small">With fewer than three months the range is wide and growth is assumed flat. Import more months to tighten it.</p>}
      </section>

      {a.bills.length > 1 && (
        <section className="card">
          <div className="card-head"><h2>Team spend by month</h2></div>
          <StackedMonths colors={colors} months={a.bills.map(x => ({ month: x.month, parts: [...x.bill.byTeam.map(t => ({ key: t.team, value: t.cost })), { key: 'unattributed', value: x.bill.unattributed }] }))} />
        </section>
      )}

      {a.recon && (
        <section className={`card recon ${Math.abs(a.recon.diffPct) > 0.1 ? 'warn' : ''}`}>
          <h2>Check against Datadog's estimate</h2>
          <p>Imported estimated cost for {monthName(a.snap.month, true)}: <b className="num">{usd(a.recon.reported)}</b>. This model: <b className="num">{usd(a.recon.modelled)}</b> ({a.recon.diffPct >= 0 ? '+' : ''}{pctFmt(a.recon.diffPct, 1)}).
            {Math.abs(a.recon.diffPct) > 0.1 ? ' The gap is large: set your contract rates and commitments under Rates & teams.' : ' Close enough to trust the levers.'}</p>
        </section>
      )}
    </div>
  )
}

function monthIdx(m: string) {
  const [y, mo] = m.split('-').map(Number)
  return y * 12 + mo - 1
}

function topDims(byDim: Partial<Record<string, number>>): string {
  return Object.entries(byDim).sort((a, b) => b[1]! - a[1]!).slice(0, 3).map(([d, c]) => `${DIM[d as keyof typeof DIM].label} ${usdShort(c!)}`).join(' · ')
}
