import { useMemo, useState } from 'react'
import { Icon, Link, monthName, pctFmt, qty, toast, usd } from './ui.tsx'
import { sortedSnapshots, updateProject, type Project } from './store.ts'
import type { Analysis } from './analysis.ts'
import { DIM, type DimId } from './engine/prices.ts'
import { computeBill } from './engine/model.ts'

const AREA: Record<string, string> = { logs: 'Logs', metrics: 'Custom metrics', apm: 'APM', commit: 'Unused commitments' }

export function History({ p, a }: { p: Project; a: Analysis }) {
  const snaps = sortedSnapshots(p)
  const [A, setA] = useState(snaps.length > 1 ? snaps[snaps.length - 2].month : snaps[0].month)
  const [B, setB] = useState(snaps[snaps.length - 1].month)
  const remove = (id: string) => {
    const s = p.snapshots.find(x => x.id === id)!
    void updateProject(p.id, x => ({ ...x, snapshots: x.snapshots.filter(y => y.id !== id) }))
    toast(`Removed ${monthName(s.month, true)}`, { action: { label: 'Undo', run: () => void updateProject(p.id, x => ({ ...x, snapshots: [...x.snapshots, s] })) } })
  }
  const cmp = useMemo(() => {
    const sa = snaps.find(s => s.month === A), sb = snaps.find(s => s.month === B)
    if (!sa || !sb) return null
    const ba = computeBill(sa.usage, p.settings), bb = computeBill(sb.usage, p.settings)
    const dims = [...new Set([...ba.lines, ...bb.lines].map(l => l.dim))] as DimId[]
    const byDim = dims.map(d => {
      const x = ba.lines.find(l => l.dim === d), y = bb.lines.find(l => l.dim === d)
      return { d, qa: x?.qty ?? 0, qb: y?.qty ?? 0, ca: x?.cost ?? 0, cb: y?.cost ?? 0 }
    }).sort((x, y) => Math.abs(y.cb - y.ca) - Math.abs(x.cb - x.ca))
    const teams = [...new Set([...ba.byTeam, ...bb.byTeam].map(t => t.team))]
    const byTeam = [...teams.map(t => ({ t, ca: ba.byTeam.find(x => x.team === t)?.cost ?? 0, cb: bb.byTeam.find(x => x.team === t)?.cost ?? 0 })), { t: '(unattributed)', ca: ba.unattributed, cb: bb.unattributed }]
      .sort((x, y) => Math.abs(y.cb - y.ca) - Math.abs(x.cb - x.ca))
    const metrics = sb.metrics.map(m => ({ m: m.metric, before: sa.metrics.find(x => x.metric === m.metric)?.avg ?? 0, after: m.avg }))
      .filter(x => Math.abs(x.after - x.before) / Math.max(1, x.before) > 0.25).sort((x, y) => (y.after - y.before) - (x.after - x.before)).slice(0, 6)
    return { ta: ba.total, tb: bb.total, byDim, byTeam, metrics }
  }, [A, B, p.settings, snaps])
  return (
    <div className="history">
      <section className="card">
        <div className="card-head"><h2>Monthly snapshots</h2><Link to={`/app/p/${p.id}/import`} className="btn btn-outline btn-sm"><Icon name="upload" /> Import a month</Link></div>
        <div className="table-wrap">
          <table className="tbl">
            <thead><tr><th>Month</th><th>Source</th><th className="r">Bill</th><th>Breakdowns</th><th>Plan</th><th /></tr></thead>
            <tbody>
              {[...snaps].reverse().map(s => (
                <tr key={s.id}>
                  <td><b>{monthName(s.month, true)}</b></td>
                  <td className="muted small">{s.source}<br />{new Date(s.createdAt).toLocaleDateString()}</td>
                  <td className="r num">{usd(computeBill(s.usage, p.settings).total)}</td>
                  <td className="small">{s.metrics.length ? `${s.metrics.length} metrics` : '—'} · {s.logIndexes.length ? `${s.logIndexes.length} indexes` : '—'}{s.reported?.length ? ' · estimated cost' : ''}</td>
                  <td>{s.plan ? <span className="chip good">{usd(s.plan.actions.reduce((x, y) => x + y.monthlySavings, 0))}/mo planned</span> : <span className="muted">—</span>}</td>
                  <td className="r"><button className="icon-btn" aria-label={`Remove ${monthName(s.month, true)}`} title="Remove snapshot" onClick={() => remove(s.id)}><Icon name="trash" /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <div className="card-head"><h2>Planned vs realized savings</h2></div>
        {a.realized ? (
          <>
            <p className="muted small">Plan adopted for {monthName(a.realized.planMonth, true)}, measured in {monthName(a.realized.month, true)}. Realized = the area's cost in the plan month minus its cost now, so organic growth counts against it.</p>
            <div className="table-wrap">
              <table className="tbl">
                <thead><tr><th>Area</th><th className="r">Planned / mo</th><th className="r">Realized / mo</th><th>Progress</th></tr></thead>
                <tbody>
                  {a.realized.rows.map(r => {
                    const prog = r.planned > 0 ? r.realized / r.planned : 0
                    return (
                      <tr key={r.area}>
                        <td>{AREA[r.area]}</td>
                        <td className="r num">{usd(r.planned)}</td>
                        <td className={`r num ${r.realized >= 0 ? 'down' : 'up'}`}>{usd(r.realized)}</td>
                        <td><div className="progress"><span style={{ width: `${Math.max(0, Math.min(1, prog)) * 100}%` }} /></div><small className="muted">{r.planned > 0 ? pctFmt(prog) : 'not planned'}</small></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <div className="empty-sm">
            <p className="muted">Adopt a plan on the Levers tab, apply the generated config, then import next month's usage. This table then shows planned against realized savings per area.</p>
            <Link to={`/app/p/${p.id}/levers`} className="btn btn-outline btn-sm">Open levers</Link>
          </div>
        )}
      </section>

      {snaps.length > 1 && cmp && (
        <section className="card">
          <div className="card-head">
            <h2>Compare months</h2>
            <div className="row">
              <select aria-label="From month" value={A} onChange={e => setA(e.target.value)}>{snaps.map(s => <option key={s.id} value={s.month}>{monthName(s.month)}</option>)}</select>
              <Icon name="arrow" />
              <select aria-label="To month" value={B} onChange={e => setB(e.target.value)}>{snaps.map(s => <option key={s.id} value={s.month}>{monthName(s.month)}</option>)}</select>
            </div>
          </div>
          <p className="cmp-total">Total <b className="num">{usd(cmp.ta)}</b> → <b className="num">{usd(cmp.tb)}</b> <span className={cmp.tb > cmp.ta ? 'up' : 'down'}>{cmp.tb >= cmp.ta ? '+' : ''}{usd(cmp.tb - cmp.ta)} ({pctFmt(cmp.ta ? cmp.tb / cmp.ta - 1 : 0, 1)})</span></p>
          <div className="grid-2 gap">
            <div className="table-wrap">
              <table className="tbl compact">
                <thead><tr><th>Product</th><th className="r">Usage</th><th className="r">Cost Δ</th></tr></thead>
                <tbody>{cmp.byDim.slice(0, 10).map(r => (
                  <tr key={r.d}><td>{DIM[r.d].label}</td><td className="r num small">{qty(r.qa)} → {qty(r.qb)}</td><td className={`r num ${r.cb > r.ca ? 'up' : 'down'}`}>{r.cb >= r.ca ? '+' : ''}{usd(r.cb - r.ca)}</td></tr>
                ))}</tbody>
              </table>
            </div>
            <div className="table-wrap">
              <table className="tbl compact">
                <thead><tr><th>Team</th><th className="r">Cost</th><th className="r">Δ</th></tr></thead>
                <tbody>{cmp.byTeam.map(r => (
                  <tr key={r.t}><td>{r.t}</td><td className="r num small">{usd(r.ca)} → {usd(r.cb)}</td><td className={`r num ${r.cb > r.ca ? 'up' : 'down'}`}>{r.cb >= r.ca ? '+' : ''}{usd(r.cb - r.ca)}</td></tr>
                ))}</tbody>
              </table>
            </div>
          </div>
          {cmp.metrics.length > 0 && (
            <>
              <h3 className="h3">Metrics that changed most</h3>
              <ul className="chips">{cmp.metrics.map(m => <li key={m.m} className="chip mono-chip">{m.m}: {qty(m.before)} → {qty(m.after)}</li>)}</ul>
            </>
          )}
        </section>
      )}
    </div>
  )
}
