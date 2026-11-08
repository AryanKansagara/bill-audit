import { Waterfall } from './charts.tsx'
import { Icon, Link, pctFmt, qty, toast, usd, usdShort, monthName } from './ui.tsx'
import { updateProject, type Project } from './store.ts'
import type { Analysis } from './analysis.ts'
import { DIM, RETENTIONS } from './engine/prices.ts'
import { cardinalityAfter, costByArea, defaultLogLever, noLevers, type Levers, type LogLever } from './engine/model.ts'
import { indexCost } from './engine/drivers.ts'

const FLEX_DAYS = [30, 90, 180, 365, 450]

export function LeversTab({ p, a }: { p: Project; a: Analysis }) {
  const lv = p.levers
  const set = (fn: (l: Levers) => Levers) => void updateProject(p.id, x => ({ ...x, levers: fn(x.levers) }))
  const setIdx = (index: string, patch: Partial<LogLever>) => set(l => {
    const cur = { ...defaultLogLever(), ...l.logIdx[index], ...patch }
    const logIdx = { ...l.logIdx, [index]: cur }
    return { ...l, logIdx }
  })
  const toggleTag = (metric: string, key: string) => set(l => {
    const cur = l.metricDrop[metric] ?? []
    const next = cur.includes(key) ? cur.filter(k => k !== key) : [...cur, key]
    return { ...l, metricDrop: { ...l.metricDrop, [metric]: next } }
  })
  const adopt = () => {
    const base = a.levers.base
    void updateProject(p.id, x => ({
      ...x,
      snapshots: x.snapshots.map(s => s.id !== a.snap.id ? s : {
        ...s,
        plan: {
          adoptedAt: new Date().toISOString(),
          levers: x.levers,
          actions: a.levers.steps.map(st => ({ id: st.key, label: st.label, area: st.area, monthlySavings: st.savings })),
          baselineByArea: costByArea(base),
        },
      }),
    }))
    toast(`Plan adopted for ${monthName(a.snap.month, true)}. Import next month to see what was realized.`)
  }
  const reset = () => {
    const prev = p.levers
    set(() => noLevers())
    toast('Levers reset', { action: { label: 'Undo', run: () => set(() => prev) } })
  }
  const steps = a.levers.steps.map(s => ({ key: s.key, label: shortName(s.label), value: s.savings, hint: `${s.label}: ${usd(s.savings)}/mo` }))
  const metrics = [...a.snap.metrics].sort((x, y) => y.avg - x.avg).slice(0, 10)
  const indexes = [...a.snap.logIndexes].sort((x, y) => indexCost(y, p.settings) - indexCost(x, p.settings))
  const totals = a.bill.lines
  const ing = totals.find(l => l.dim === 'apm_ingested_gb')
  const idx = totals.find(l => l.dim === 'indexed_spans')

  return (
    <div className="levers">
      <div className="lv-controls">
        <section className="card">
          <div className="card-head"><h2><Icon name="logs" /> Logs</h2><span className="muted small">exclusion filters, pre-ingest drops, retention, Flex</span></div>
          {indexes.length ? indexes.map((ix, n) => {
            const l = { ...defaultLogLever(), ...lv.logIdx[ix.index] }
            return (
              <div key={ix.index} className={`lv-row ${lv.logIdx[ix.index] ? 'touched' : ''}`}>
                <div className="lv-row-head">
                  <code>{ix.index}</code>
                  <span className="muted small">{qty(ix.events)} events · {ix.retention}d · {usd(indexCost(ix, p.settings))}/mo · {ix.queries30d ?? '?'} queries</span>
                </div>
                <div className="lv-grid">
                  <Slider label="Exclusion filter" hint={n === 0 ? 'share of indexed events sampled out' : ''} value={l.exclude} onChange={v => setIdx(ix.index, { exclude: v })} />
                  <Slider label="Drop before ingest" hint={n === 0 ? 'Vector pipeline; also cuts ingest GB' : ''} value={l.preDrop} onChange={v => setIdx(ix.index, { preDrop: v })} />
                  <label className="field-sm">Retention
                    <select value={l.retention ?? ix.retention} disabled={l.flex} onChange={e => setIdx(ix.index, { retention: Number(e.target.value) })}>
                      {RETENTIONS.map(r => <option key={r} value={r}>{r} days</option>)}
                    </select>
                  </label>
                  <div className="field-sm">
                    <span>Flex Tier</span>
                    <div className="row">
                      <button className={`switch ${l.flex ? 'on' : ''}`} role="switch" aria-checked={l.flex} aria-label={`Move ${ix.index} to Flex`} onClick={() => setIdx(ix.index, { flex: !l.flex })}><i /></button>
                      <select aria-label="Flex retention" value={l.flexDays} disabled={!l.flex} onChange={e => setIdx(ix.index, { flexDays: Number(e.target.value) })}>
                        {FLEX_DAYS.map(d => <option key={d} value={d}>{d}d</option>)}
                      </select>
                    </div>
                  </div>
                </div>
                {l.flex && <p className="note">Flex logs are searchable but do not feed monitors. {p.settings.flexComputeMonthly ? `Includes ${usd(p.settings.flexComputeMonthly)}/mo Flex compute.` : <>Add your Flex compute fee under <Link to={`/app/p/${p.id}/rates`}>Rates</Link> if you are past Starter.</>}</p>}
              </div>
            )
          }) : (
            <>
              <Slider label="Exclude from all indexes" hint="no index breakdown imported" value={lv.logsGlobalExclude} onChange={v => set(l => ({ ...l, logsGlobalExclude: v }))} />
              <p className="muted small">Import log volume by index to set filters per index and generate Terraform. <Link to="/docs#logs">How</Link></p>
            </>
          )}
        </section>

        <section className="card">
          <div className="card-head"><h2><Icon name="metric" /> Metrics without Limits</h2><span className="muted small">click a tag to drop it from the allowlist</span></div>
          {metrics.length ? metrics.map(m => {
            const drop = lv.metricDrop[m.metric] ?? []
            const after = cardinalityAfter(m, drop)
            return (
              <div key={m.metric} className={`lv-row ${drop.length ? 'touched' : ''}`}>
                <div className="lv-row-head">
                  <code>{m.metric}</code>
                  <span className="muted small num">{qty(m.avg)} → {drop.length ? <b>{qty(after)}</b> : qty(m.avg)} timeseries</span>
                </div>
                <div className="tag-toggles">
                  {m.tags.map(t => (
                    <button key={t.key} className={`tagcard toggle ${drop.includes(t.key) ? 'dropped' : ''} ${t.card >= 200 ? 'bad' : ''}`} aria-pressed={drop.includes(t.key)} onClick={() => toggleTag(m.metric, t.key)}>
                      {t.key}<b>{qty(t.card)}</b>
                    </button>
                  ))}
                </div>
              </div>
            )
          }) : <p className="muted small">Import a custom-metrics breakdown to configure tag allowlists. <Link to="/docs#metrics">How</Link></p>}
        </section>

        <section className="card">
          <div className="card-head"><h2><Icon name="trace" /> APM</h2></div>
          {ing || idx ? (
            <div className="lv-grid two">
              <Slider label="Ingestion kept" hint={ing ? `${qty(ing.qty)} GB, ${qty(ing.allotment)} GB allotted` : 'no ingestion usage'} value={lv.apmIngestKeep} min={0.05} onChange={v => set(l => ({ ...l, apmIngestKeep: v }))} keep />
              <Slider label="Indexed spans kept" hint={idx ? `${qty(idx.qty)} spans, ${qty(idx.allotment)} allotted` : 'no indexed spans'} value={lv.apmIndexKeep} min={0.05} onChange={v => set(l => ({ ...l, apmIndexKeep: v }))} keep />
            </div>
          ) : <p className="muted small">No APM span usage in this month.</p>}
        </section>

        <section className="card">
          <div className="card-head">
            <h2><Icon name="lock" /> Commitments</h2>
            <button className={`switch ${lv.commit ? 'on' : ''}`} role="switch" aria-checked={lv.commit} aria-label="Right-size commitments" onClick={() => set(l => ({ ...l, commit: !l.commit }))}><i /></button>
          </div>
          <p className="muted small">Commit level per dimension for the renewal year, sized to the usage you exceed with probability equal to the committed / on-demand price ratio. Computed on usage after the levers above.</p>
          <CommitTable a={a} p={p} />
        </section>
      </div>

      <aside className="lv-summary">
        <div className="card sticky">
          <div className="lv-sum-head">
            <div><small>Monthly bill</small><b className="num">{usd(a.bill.total)}</b></div>
            <div><small>Expected after</small><b className="num accent">{usd(a.levers.afterTotal)}</b></div>
            <div><small>Saved</small><b className="num save">{usd(a.levers.savings)}<em>{pctFmt(a.bill.total ? a.levers.savings / a.bill.total : 0, 1)}</em></b></div>
          </div>
          <Waterfall start={a.bill.total} startLabel="Now" steps={steps} endLabel="After" height={220} compact />
          <div className="lv-fc">
            <span>Renewal year</span>
            <b className="num">{usdShort(a.fc.year.mid)}</b>
            <Icon name="arrow" />
            <b className="num accent">{usdShort(a.planFc.year.mid)}</b>
            <small>range {usdShort(a.planFc.year.low)} to {usdShort(a.planFc.year.high)}</small>
          </div>
          <ul className="lv-steps">
            {a.levers.steps.length ? a.levers.steps.map(s => <li key={s.key}><span>{s.label}</span><b className="num">{usd(s.savings)}</b></li>) : <li className="muted">Move a slider to start a plan.</li>}
          </ul>
          <div className="row-end">
            <button className="btn btn-ghost btn-sm" onClick={reset} disabled={!a.levers.steps.length}>Reset</button>
            <Link to={`/app/p/${p.id}/artifacts`} className="btn btn-outline btn-sm">Get config</Link>
            <button className="btn btn-primary btn-sm" onClick={adopt} disabled={!a.levers.steps.length}>Adopt plan</button>
          </div>
          {a.snap.plan && <p className="muted small">A plan was adopted for {monthName(a.snap.month, true)} on {new Date(a.snap.plan.adoptedAt).toLocaleDateString()}. Adopting again replaces it.</p>}
        </div>
      </aside>
    </div>
  )
}

function shortName(label: string): string {
  if (label.startsWith('Index ')) return label.slice(6).split(':')[0]
  if (label.startsWith('Right-size')) return 'Commits'
  if (label.startsWith('Sample APM')) return 'APM ingest'
  if (label.startsWith('Keep')) return 'Indexed spans'
  if (label.startsWith('Exclude')) return 'All logs'
  return label.split(':')[0].split('.').slice(-1)[0]
}

function Slider({ label, hint, value, onChange, min = 0, keep }: { label: string; hint: string; value: number; onChange: (v: number) => void; min?: number; keep?: boolean }) {
  return (
    <label className={`slider ${keep ? (value < 1 ? 'active' : '') : value > 0 ? 'active' : ''}`}>
      <span className="sl-top"><span>{label}</span><b className="num">{pctFmt(value)}</b></span>
      <input type="range" min={min} max={1} step={0.01} value={value} onChange={e => onChange(Number(e.target.value))} aria-valuetext={pctFmt(value)} />
      {hint && <small>{hint}</small>}
    </label>
  )
}

function CommitTable({ a, p }: { a: Analysis; p: Project }) {
  const recs = a.commits.filter(r => r.current > 0 || Math.abs(r.annualDelta) > 600).sort((x, y) => x.annualDelta - y.annualDelta)
  if (!recs.length) return <p className="muted small">Not enough usage to recommend commitments.</p>
  return (
    <div className="table-wrap">
      <table className="tbl compact">
        <thead><tr><th>Dimension</th><th className="r">Current</th><th className="r">Recommended</th><th className="r">Expected use</th><th className="r">Annual effect</th></tr></thead>
        <tbody>
          {recs.map(r => (
            <tr key={r.dim}>
              <td>{DIM[r.dim].label}</td>
              <td className="r num">{qty(r.current)}</td>
              <td className="r num"><b>{qty(r.recommended)}</b></td>
              <td className="r num">{qty(r.expected)}</td>
              <td className={`r num ${r.annualDelta < 0 ? 'down' : 'up'}`}>{r.annualDelta < 0 ? '−' : '+'}{usdShort(Math.abs(r.annualDelta))}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted small">Quantities in {p.settings.tier === 'pro' ? 'Pro' : 'Enterprise'}-tier billable units per month, after allotments.</p>
    </div>
  )
}
