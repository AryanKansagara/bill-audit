import { Icon, Link, navigate, pctFmt, qty, toast, usd, usdShort } from './ui.tsx'
import { HBars, Meter } from './charts.tsx'
import { updateProject, type Project } from './store.ts'
import type { Analysis } from './analysis.ts'
import { DIM } from './engine/prices.ts'
import { defaultLogLever } from './engine/model.ts'
import { looksUnbounded } from './engine/drivers.ts'

export function Drivers({ p, a }: { p: Project; a: Analysis }) {
  const addMetricLever = (metric: string, drop: string[]) => {
    void updateProject(p.id, x => ({ ...x, levers: { ...x.levers, metricDrop: { ...x.levers.metricDrop, [metric]: drop } } }))
    toast(`Added allowlist lever for ${metric}`, { action: { label: 'Open levers', run: () => navigate(`/app/p/${p.id}/levers`) } })
  }
  const addIndexLever = (index: string) => {
    void updateProject(p.id, x => ({ ...x, levers: { ...x.levers, logIdx: { ...x.levers.logIdx, [index]: { ...defaultLogLever(), exclude: 0.9 } } } }))
    toast(`Added a 90% exclusion on ${index}`, { action: { label: 'Open levers', run: () => navigate(`/app/p/${p.id}/levers`) } })
  }
  const growth = a.growth.filter(g => g.months > 0)
  return (
    <div className="drivers">
      <div className="grid-2 gap">
        <section className="card">
          <div className="card-head"><h2><Icon name="flame" /> Biggest line items</h2></div>
          <ol className="rank">
            {a.bill.lines.slice(0, 6).map(l => (
              <li key={l.dim}>
                <span>{DIM[l.dim].label}<small>{qty(l.billable)} billable {DIM[l.dim].rawUnit}{l.overage > 0 && l.committed > 0 ? `, ${qty(l.overage)} on-demand` : ''}</small></span>
                <b className="num">{usd(l.cost)}</b>
                <em className="num">{pctFmt(l.cost / a.bill.total)}</em>
              </li>
            ))}
          </ol>
        </section>
        <section className="card">
          <div className="card-head"><h2><Icon name="trend" /> Fastest growing</h2>{growth[0] && <span className="muted small">over {growth[0].months} months</span>}</div>
          {growth.length ? (
            <ol className="rank">
              {growth.slice(0, 6).map(g => (
                <li key={g.dim}>
                  <span>{DIM[g.dim].label}<small>{usd(g.first)} → {usd(g.last)}</small></span>
                  <b className={`num ${g.delta > 0 ? 'up' : 'down'}`}>{g.delta > 0 ? '+' : ''}{usdShort(g.delta)}</b>
                  <em className="num">{Number.isFinite(g.monthly) ? `${g.monthly >= 0 ? '+' : ''}${pctFmt(g.monthly, 1)}/mo` : 'new'}</em>
                </li>
              ))}
            </ol>
          ) : <p className="muted">Import at least two months to rank growth.</p>}
        </section>
      </div>

      <section className="card">
        <div className="card-head"><h2><Icon name="metric" /> Custom metric cardinality</h2><span className="muted small">{a.snap.metrics.length ? `${a.snap.metrics.length} metrics in the breakdown` : 'no breakdown imported'}</span></div>
        {!a.snap.metrics.length ? (
          <p className="muted">Paste the Top Custom Metrics export with tag cardinality to find explosions. <Link to={`/app/p/${p.id}/import`}>Import a breakdown</Link> · <Link to="/docs#metrics">how to get it</Link></p>
        ) : !a.explosions.length ? <p className="muted">No metric is dominated by a high-cardinality tag.</p> : (
          <div className="explosions">
            {a.explosions.slice(0, 6).map(e => {
              const active = (p.levers.metricDrop[e.metric] ?? []).length > 0
              return (
                <article key={e.metric} className={`explosion ${e.growth && e.growth > 1 ? 'hot' : ''}`}>
                  <header>
                    <code>{e.metric}</code>
                    {e.team && <span className="chip">{e.team}</span>}
                    {e.growth !== null && e.growth > 0.5 && <span className="chip hot">▲ {pctFmt(e.growth)} vs last month</span>}
                  </header>
                  <div className="ex-nums">
                    <div><small>Timeseries</small><b className="num">{qty(e.avg)}</b></div>
                    <div><small>Share</small><b className="num">{pctFmt(e.share, 1)}</b></div>
                    <div><small>Marginal cost</small><b className="num">{usd(e.monthlyCost)}/mo</b></div>
                    <div><small>Queries (30d)</small><b className="num">{e.queries30d ?? '—'}</b></div>
                  </div>
                  <div className="ex-tags">
                    {[...e.culprits.map(c => ({ ...c, bad: true })), ...a.snap.metrics.find(m => m.metric === e.metric)!.tags.filter(t => !e.culprits.includes(t)).map(t => ({ ...t, bad: false }))].map(t => (
                      <span key={t.key} className={`tagcard ${t.bad ? 'bad' : ''}`} title={t.bad && looksUnbounded(t.key) ? 'Looks unbounded (an ID or per-request value)' : undefined}>{t.key}<b>{qty(t.card)}</b></span>
                    ))}
                  </div>
                  <footer>
                    <span className="muted small">Allowlist: {e.keep.join(', ') || '(none)'}</span>
                    <button className="btn btn-sm btn-outline" disabled={active} onClick={() => addMetricLever(e.metric, e.culprits.map(c => c.key))}>{active ? 'Lever added' : `Drop ${e.culprits.map(c => c.key).join(', ')}`}</button>
                  </footer>
                </article>
              )
            })}
          </div>
        )}
      </section>

      <section className="card">
        <div className="card-head"><h2><Icon name="logs" /> Log indexes by value</h2><span className="muted small">indexing cost at the on-demand rate vs queries in 30 days</span></div>
        {!a.indexes.length ? (
          <p className="muted">Paste log volume by index to rank indexes. <Link to={`/app/p/${p.id}/import`}>Import a breakdown</Link> · <Link to="/docs#logs">how to get it</Link></p>
        ) : (
          <div className="table-wrap">
            <table className="tbl">
              <thead><tr><th>Index</th><th>Team</th><th className="r">Events / mo</th><th className="r">Retention</th><th className="r">Cost / mo</th><th className="r">Queries 30d</th><th className="r">$ / query</th><th>Verdict</th><th /></tr></thead>
              <tbody>
                {a.indexes.map(ix => (
                  <tr key={ix.index} className={ix.verdict === 'low' ? 'row-low' : ''}>
                    <td><code>{ix.index}</code></td>
                    <td>{ix.team ?? <span className="muted">—</span>}</td>
                    <td className="r num">{qty(ix.events)}</td>
                    <td className="r num">{ix.retention}d</td>
                    <td className="r num">{usd(ix.monthlyCost)}</td>
                    <td className="r num">{ix.queries30d ?? '—'}</td>
                    <td className="r num">{ix.costPerQuery !== null ? usd(ix.costPerQuery) : '—'}</td>
                    <td><span className={`verdict ${ix.verdict}`}>{ix.verdict === 'low' ? 'Low value' : ix.verdict === 'ok' ? 'Earning it' : 'Unknown'}</span><small className="block muted">{ix.reason}</small></td>
                    <td>{ix.verdict === 'low' && !p.levers.logIdx[ix.index] && <button className="btn btn-sm btn-outline" onClick={() => addIndexLever(ix.index)}>Add lever</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card">
        <div className="card-head"><h2><Icon name="trace" /> APM: ingested vs indexed spans</h2></div>
        {!a.apm ? <p className="muted">No APM span usage in this import.</p> : (
          <div className="apm">
            <div>
              <h3>Ingested spans</h3>
              <Meter value={a.apm.ingestedGb} max={a.apm.ingestAllotment} label="Ingested GB vs allotment" />
              <p className="small">{qty(a.apm.ingestedGb)} GB against {qty(a.apm.ingestAllotment)} GB included with {qty(a.apm.hosts)} APM hosts (150 GB each). Overage {usd(a.apm.ingestOverageCost)}/mo.
                {a.apm.keepToFit !== null && <> Keeping about <b>{pctFmt(a.apm.keepToFit)}</b> of ingested traffic fits the allotment.</>}</p>
            </div>
            <div>
              <h3>Indexed spans</h3>
              <Meter value={a.apm.indexedSpans} max={a.apm.indexAllotment} label="Indexed spans vs allotment" />
              <p className="small">{qty(a.apm.indexedSpans)} indexed against {qty(a.apm.indexAllotment)} included (1M per APM host). Overage {usd(a.apm.indexOverageCost)}/mo. {qty(a.apm.spansPerGb)} spans indexed per ingested GB: check retention filters that index more than you search.</p>
            </div>
          </div>
        )}
      </section>

      <section className="card">
        <div className="card-head"><h2>Spend by product family</h2></div>
        <HBars rows={families(a)} />
      </section>
    </div>
  )
}

function families(a: Analysis) {
  const m = new Map<string, number>()
  for (const l of a.bill.lines) m.set(DIM[l.dim].family, (m.get(DIM[l.dim].family) ?? 0) + l.cost)
  return [...m.entries()].sort((x, y) => y[1] - x[1]).map(([k, v]) => ({ key: k, label: k, value: v }))
}
