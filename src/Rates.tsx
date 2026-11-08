import { Icon, toast, usd } from './ui.tsx'
import { updateProject, type Project } from './store.ts'
import type { Analysis } from './analysis.ts'
import { DIMS, PRICE_SOURCE, PRICES_AS_OF, PRO_HOST, type DimId } from './engine/prices.ts'
import { rateFor, type Settings, type TagRule } from './engine/model.ts'

export function Rates({ p, a }: { p: Project; a: Analysis | null }) {
  const s = p.settings
  const set = (patch: Partial<Settings>) => void updateProject(p.id, x => ({ ...x, settings: { ...x.settings, ...patch } }))
  const setRate = (d: DimId, k: 'annual' | 'onDemand', v: string) => {
    const rates = { ...s.rates }
    const cur = { ...rates[d] }
    if (v === '') delete cur[k]
    else cur[k] = Number(v)
    rates[d] = cur
    set({ rates })
  }
  const setCommit = (d: DimId, blocks: string, block: number) => {
    const commits = { ...s.commits }
    if (blocks === '' || Number(blocks) === 0) delete commits[d]
    else commits[d] = Number(blocks) * block
    set({ commits })
  }
  const setRule = (i: number, patch: Partial<TagRule>) => set({ rules: s.rules.map((r, j) => j === i ? { ...r, ...patch } : r) })
  const used = new Set(a?.bill.lines.map(l => l.dim) ?? [])
  const dims = [...DIMS].sort((x, y) => Number(used.has(y.id)) - Number(used.has(x.id)))
  const fillCommits = () => {
    if (!a) return
    const prev = s.commits
    set({ commits: Object.fromEntries(a.bill.lines.filter(l => l.billable > 0).map(l => [l.dim, l.billable])) })
    toast('Commitments set to this month\'s billable usage', { action: { label: 'Undo', run: () => set({ commits: prev }) } })
  }
  const tagKeys = [...new Set(a?.snap.usage.flatMap(r => Object.keys(r.tags)) ?? [])].sort()
  return (
    <div className="rates">
      <div className="grid-2 gap">
        <section className="card">
          <div className="card-head"><h2>Contract</h2></div>
          <div className="form">
            <label>Plan tier
              <select value={s.tier} onChange={e => set({ tier: e.target.value as Settings['tier'] })}>
                <option value="enterprise">Enterprise (200 custom metrics and 10 containers per host)</option>
                <option value="pro">Pro (100 custom metrics and 5 containers per host)</option>
              </select>
            </label>
            <label>Renewal date<input type="date" value={s.renewalDate} onChange={e => e.target.value && set({ renewalDate: e.target.value })} /></label>
            <label>Flex Logs compute, per month (USD)<input type="number" min={0} step={1} value={s.flexComputeMonthly} onChange={e => set({ flexComputeMonthly: Number(e.target.value) || 0 })} /><small className="muted">Scalable Flex compute is a flat fee on your contract. Leave 0 for Starter.</small></label>
          </div>
        </section>
        <section className="card">
          <div className="card-head"><h2>Team attribution</h2></div>
          <div className="form">
            <label>Team tag key<input value={s.teamTag} onChange={e => set({ teamTag: e.target.value.trim() })} list="tag-keys" /></label>
            <datalist id="tag-keys">{tagKeys.map(k => <option key={k} value={k} />)}</datalist>
            <div>
              <span className="label">Rules for rows without a team tag (first match wins)</span>
              {s.rules.map((r, i) => (
                <div key={i} className="rule">
                  <input aria-label="Tag key" placeholder="service" value={r.key} list="tag-keys" onChange={e => setRule(i, { key: e.target.value })} />
                  <span>matches</span>
                  <input aria-label="Pattern" placeholder="pay-*" value={r.pattern} onChange={e => setRule(i, { pattern: e.target.value })} />
                  <span>→</span>
                  <input aria-label="Team" placeholder="payments" value={r.team} onChange={e => setRule(i, { team: e.target.value })} />
                  <button className="icon-btn" aria-label="Remove rule" onClick={() => { const prev = s.rules; set({ rules: s.rules.filter((_, j) => j !== i) }); toast('Rule removed', { action: { label: 'Undo', run: () => set({ rules: prev }) } }) }}><Icon name="x" /></button>
                </div>
              ))}
              <button className="btn btn-ghost btn-sm" onClick={() => set({ rules: [...s.rules, { key: 'service', pattern: '', team: '' }] })}><Icon name="plus" /> Add rule</button>
            </div>
            {a && <p className="muted small">Attributed now: <b>{Math.round(a.bill.attributedShare * 1000) / 10}%</b> of {usd(a.bill.total)}.</p>}
          </div>
        </section>
      </div>

      <section className="card">
        <div className="card-head">
          <div><h2>Rates and commitments</h2><p className="muted small">List prices captured {PRICES_AS_OF} from <a href={PRICE_SOURCE} target="_blank" rel="noreferrer">datadoghq.com/pricing/list</a>. Blank fields use list. Commitments are monthly, in the priced unit.</p></div>
          <button className="btn btn-outline btn-sm" disabled={!a} onClick={fillCommits}>Commit to this month's usage</button>
        </div>
        <div className="table-wrap">
          <table className="tbl compact rates-tbl">
            <thead><tr><th>Dimension</th><th>Unit</th><th className="r">List annual</th><th className="r">List on-demand</th><th>Your committed rate</th><th>Your on-demand rate</th><th>Committed / month</th></tr></thead>
            <tbody>
              {dims.map(d => {
                const list = d.id === 'infra_host' && s.tier === 'pro' ? PRO_HOST : d
                const eff = rateFor(d.id, s)
                return (
                  <tr key={d.id} className={used.has(d.id) ? '' : 'dim'}>
                    <td>{d.label}{d.note && <small className="block muted">{d.note}</small>}</td>
                    <td className="small">{d.unit}</td>
                    <td className="r num">${list.annual}</td>
                    <td className="r num">${list.onDemand}</td>
                    <td><input type="number" min={0} step="0.01" aria-label={`${d.label} committed rate`} placeholder={String(eff.annual)} value={s.rates[d.id]?.annual ?? ''} onChange={e => setRate(d.id, 'annual', e.target.value)} /></td>
                    <td><input type="number" min={0} step="0.01" aria-label={`${d.label} on-demand rate`} placeholder={String(eff.onDemand)} value={s.rates[d.id]?.onDemand ?? ''} onChange={e => setRate(d.id, 'onDemand', e.target.value)} /></td>
                    <td><input type="number" min={0} step="any" aria-label={`${d.label} monthly commitment in ${d.unit}`} placeholder="0" value={s.commits[d.id] ? +(s.commits[d.id]! / d.block).toFixed(2) : ''} onChange={e => setCommit(d.id, e.target.value, d.block)} /></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
