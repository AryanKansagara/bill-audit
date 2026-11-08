import { useEffect } from 'react'
import { Icon, Link, Monogram, monthName, pctFmt, qty, usd, usdShort } from './ui.tsx'
import { TrendChart } from './charts.tsx'
import { useProjects } from './store.ts'
import { useAnalysis } from './analysis.ts'
import { DIM, PRICES_AS_OF } from './engine/prices.ts'
import { monthIndex } from './engine/model.ts'

export function Brief({ id }: { id: string }) {
  const { projects, loaded } = useProjects()
  const p = projects.find(x => x.id === id)
  const a = useAnalysis(p)
  useEffect(() => { if (p) document.title = `Renewal brief: ${p.name}` }, [p])
  if (!loaded) return <div className="brief-wrap"><div className="skeleton" style={{ height: 400 }} /></div>
  if (!p || !a) return <div className="brief-wrap empty"><h1>Nothing to brief yet</h1><p className="muted">Import usage first.</p><Link to={p ? `/app/p/${p.id}/import` : '/app'} className="btn btn-primary">Import</Link></div>
  const b = a.bill
  const wasted = b.lines.reduce((x, l) => x + l.wastedCommitCost, 0)
  const recs = a.commits.filter(r => r.current > 0 || Math.abs(r.annualDelta) > 600).sort((x, y) => x.annualDelta - y.annualDelta).slice(0, 10)
  const steps = a.levers.steps
  return (
    <div className="brief-wrap">
      <div className="brief-bar no-print">
        <Link to={`/app/p/${p.id}/levers`} className="btn btn-ghost btn-sm">← Back to levers</Link>
        <span className="muted small">Use your browser's print dialog and choose "Save as PDF".</span>
        <button className="btn btn-primary btn-sm" onClick={() => window.print()}><Icon name="print" /> Print / Save PDF</button>
      </div>
      <article className="brief">
        <header className="brief-head">
          <div className="brand"><Monogram size={26} /><span>Bill Audit</span></div>
          <div>
            <h1>Datadog renewal brief</h1>
            <p>{p.name}{p.sample && ' · synthetic data'} · usage through {monthName(a.snap.month, true)} · renewal {monthName(p.settings.renewalDate.slice(0, 7), true)} · prepared {new Date().toLocaleDateString('en-US', { dateStyle: 'medium' })}</p>
          </div>
        </header>

        <section className="brief-kpis">
          <div><small>Current monthly bill</small><b>{usd(b.total)}</b><span>{monthName(a.snap.month, true)}</span></div>
          <div><small>Renewal year, current path</small><b>{usdShort(a.fc.year.mid)}</b><span>80% range {usdShort(a.fc.year.low)} to {usdShort(a.fc.year.high)}</span></div>
          <div><small>Renewal year, with plan</small><b className="accent">{usdShort(a.planFc.year.mid)}</b><span>{pctFmt(1 - a.planFc.year.mid / a.fc.year.mid)} lower</span></div>
          <div><small>Unattributed / unused commit</small><b>{usdShort(b.unattributed)} / {usdShort(wasted)}</b><span>per month</span></div>
        </section>

        <section>
          <h2>1. Where the money goes</h2>
          <div className="brief-2">
            <table className="tbl compact">
              <thead><tr><th>Product</th><th className="r">Usage</th><th className="r">Cost</th><th className="r">Share</th></tr></thead>
              <tbody>{b.lines.slice(0, 8).map(l => <tr key={l.dim}><td>{DIM[l.dim].label}</td><td className="r">{qty(l.qty)}</td><td className="r">{usd(l.cost)}</td><td className="r">{pctFmt(l.cost / b.total)}</td></tr>)}</tbody>
            </table>
            <table className="tbl compact">
              <thead><tr><th>Team</th><th className="r">Cost</th><th className="r">Share</th></tr></thead>
              <tbody>
                {b.byTeam.slice(0, 7).map(t => <tr key={t.team}><td>{t.team}</td><td className="r">{usd(t.cost)}</td><td className="r">{pctFmt(t.cost / b.total)}</td></tr>)}
                <tr className="row-low"><td>Unattributed</td><td className="r">{usd(b.unattributed)}</td><td className="r">{pctFmt(b.unattributed / b.total)}</td></tr>
              </tbody>
            </table>
          </div>
        </section>

        <section>
          <h2>2. Forecast to renewal</h2>
          <TrendChart actual={a.bills.map(x => ({ idx: monthIndex(x.month), value: x.bill.total }))} forecast={a.fc.months} plan={steps.length ? a.planFc.months : undefined} renewalIdx={a.fc.renewalIdx} height={200} />
          <p className="small">Monthly growth {pctFmt(a.fc.trend.growth, 1)} (median month-over-month, so one-off jumps are not extrapolated) from {a.fc.trend.n} month{a.fc.trend.n === 1 ? '' : 's'} of history. Range widens with the horizon.</p>
        </section>

        <section className="brief-break">
          <h2>3. Savings plan</h2>
          {steps.length ? (
            <table className="tbl compact">
              <thead><tr><th>Change</th><th>Area</th><th className="r">Per month</th><th className="r">Per year</th></tr></thead>
              <tbody>
                {steps.map(s => <tr key={s.key}><td>{s.label}</td><td>{s.area}</td><td className="r">{usd(s.savings)}</td><td className="r">{usd(s.savings * 12)}</td></tr>)}
                <tr className="total"><td>Total</td><td /><td className="r">{usd(a.levers.savings)}</td><td className="r">{usd(a.levers.savings * 12)}</td></tr>
              </tbody>
            </table>
          ) : <p className="muted">No levers set yet.</p>}
        </section>

        <section>
          <h2>4. Commitment recommendation</h2>
          <table className="tbl compact">
            <thead><tr><th>Dimension</th><th className="r">Current / mo</th><th className="r">Recommended / mo</th><th className="r">Expected use</th><th className="r">Annual effect</th></tr></thead>
            <tbody>{recs.map(r => <tr key={r.dim}><td>{DIM[r.dim].label}</td><td className="r">{qty(r.current)}</td><td className="r"><b>{qty(r.recommended)}</b></td><td className="r">{qty(r.expected)}</td><td className="r">{r.annualDelta < 0 ? '−' : '+'}{usd(Math.abs(r.annualDelta))}</td></tr>)}</tbody>
          </table>
          <p className="small">Each commitment is set where the chance of using more equals the committed-to-on-demand price ratio, on usage after the plan above. Quantities are billable units after allotments.</p>
        </section>

        <footer className="brief-foot">
          Estimates use Datadog public list prices captured {PRICES_AS_OF}{Object.keys(p.settings.rates).length ? `, with ${Object.keys(p.settings.rates).length} contract rate override(s)` : ''}. Hosts bill on the 99th-percentile high-water mark; allotments are pooled per account. Prepared with Bill Audit, an independent tool not affiliated with Datadog.
        </footer>
      </article>
    </div>
  )
}
