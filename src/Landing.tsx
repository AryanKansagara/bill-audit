import { useEffect, useMemo, useRef, useState } from 'react'
import { Waterfall } from './charts.tsx'
import { Icon, Link, navigate, pctFmt, toast, usd, usdShort, useMedia, useTween } from './ui.tsx'
import { Footer, Header, Page } from './Shell.tsx'
import { analyse } from './analysis.ts'
import { noLevers, type Levers } from './engine/model.ts'
import { logsIndexTerraform, metricTagTerraform, vectorConfig } from './engine/artifacts.ts'
import { putProject, sampleProject, type Project } from './store.ts'

const HERO_LEVERS = [
  { key: 'debug', label: 'Exclude 90% of the debug index', area: 'Logs' },
  { key: 'cart', label: 'Allowlist tags on checkout.cart.latency', area: 'Metrics' },
  { key: 'flex', label: 'Move the audit index to Flex', area: 'Logs' },
  { key: 'apm', label: 'Sample APM ingestion to the allotment', area: 'APM' },
  { key: 'commit', label: 'Right-size commitments', area: 'Contract' },
] as const
type HeroKey = typeof HERO_LEVERS[number]['key']

function leversFor(on: Set<HeroKey>, keepToFit: number): Levers {
  const lv = noLevers()
  if (on.has('debug')) lv.logIdx.debug = { exclude: 0.9, preDrop: 0, flex: false, flexDays: 90 }
  if (on.has('flex')) lv.logIdx.audit = { exclude: 0, preDrop: 0, flex: true, flexDays: 365 }
  if (on.has('cart')) lv.metricDrop['checkout.cart.latency'] = ['cart_id']
  if (on.has('apm')) lv.apmIngestKeep = Math.floor(keepToFit * 100) / 100
  lv.commit = on.has('commit')
  return lv
}

export async function openSample() {
  const p = await putProject(sampleProject())
  navigate(`/app/p/${p.id}`)
  toast('Sample project created. Every number in it is synthetic.')
}

function Hero() {
  const base = useMemo(() => sampleProject(), [])
  const plain = useMemo(() => analyse(base)!, [base])
  const keep = plain.apm?.keepToFit ?? 1
  const [on, setOn] = useState<Set<HeroKey>>(new Set())
  const touched = useRef(false)
  const reduce = useMedia('(prefers-reduced-motion: reduce)')
  // Plays the levers in once so the chart shows itself working; stops as soon as the visitor touches it.
  useEffect(() => {
    if (reduce) { setOn(new Set(['debug', 'cart', 'commit'])); return }
    const order: HeroKey[] = ['debug', 'cart', 'flex']
    const timers = order.map((k, i) => setTimeout(() => { if (!touched.current) setOn(s => new Set([...s, k])) }, 1100 + i * 900))
    return () => timers.forEach(clearTimeout)
  }, [reduce])
  const a = useMemo(() => analyse({ ...base, levers: leversFor(on, keep) } as Project)!, [base, on, keep])
  const save = useTween(a.levers.savings)
  const yearNow = a.fc.year.mid
  const yearPlan = useTween(a.planFc.year.mid)
  const toggle = (k: HeroKey) => {
    touched.current = true
    setOn(s => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n })
  }
  const steps = a.levers.steps.map(s => ({ key: s.key, label: shortLabel(s.key), value: s.savings, hint: `${s.label}: ${usd(s.savings)}/mo` }))
  return (
    <section className="hero">
      <div className="hero-in">
        <div className="hero-copy">
          <p className="eyebrow">Datadog bill audit</p>
          <h1>See where your Datadog money goes. Then ship the change that cuts it.</h1>
          <p className="lede">Import your usage exports, attribute every dollar to a team, find the line items that are growing fastest, and generate the exclusion filters, tag allowlists and pipeline config that bring the renewal back under control.</p>
          <div className="cta-row">
            <button className="btn btn-primary" onClick={openSample}>Try the sample</button>
            <Link to="/app?import=1" className="btn btn-outline">Import your data</Link>
          </div>
          <p className="fine">Runs in your browser. No Datadog API keys, no upload. Prices are public list rates as of Nov 2026; plug in your contract rates.</p>
        </div>
        <div className="hero-panel" aria-label="Live demo on synthetic data">
          <div className="hp-head">
            <div>
              <span className="tag-synth">Synthetic sample</span>
              <h2>Northwind Freight · Oct 2026</h2>
            </div>
            <div className="hp-kpi">
              <small>Saved per month</small>
              <b className="num save">{usd(save)}</b>
            </div>
          </div>
          <Waterfall start={a.bill.total} startLabel="Oct bill" steps={steps} endLabel="After" height={210} compact />
          <div className="hp-levers" role="group" aria-label="Savings levers">
            {HERO_LEVERS.map(l => (
              <button key={l.key} className={`lever-chip ${on.has(l.key) ? 'on' : ''}`} aria-pressed={on.has(l.key)} onClick={() => toggle(l.key)}>
                <i className="chk">{on.has(l.key) && <Icon name="check" size={12} />}</i>
                <span><small>{l.area}</small>{l.label}</span>
              </button>
            ))}
          </div>
          <div className="hp-fc">
            <div><small>Renewal year at current trajectory</small><b className="num">{usdShort(yearNow)}</b><em>{usdShort(a.fc.year.low)} to {usdShort(a.fc.year.high)}</em></div>
            <Icon name="arrow" size={20} />
            <div><small>With these changes</small><b className="num accent">{usdShort(yearPlan)}</b><em>{pctFmt(1 - a.planFc.year.mid / yearNow)} lower</em></div>
          </div>
        </div>
      </div>
    </section>
  )
}

function shortLabel(key: string): string {
  if (key === 'log:debug') return 'Debug logs'
  if (key === 'log:audit') return 'Audit → Flex'
  if (key.startsWith('metric:')) return 'Cart tags'
  if (key === 'apm:ingest') return 'APM sampling'
  if (key === 'commit') return 'Commits'
  return key
}

const PAINS = [
  { k: 'Visibility', q: 'A platform engineer on r/devops asked the question plenty of teams share: we pay the bill, so why is it so hard to see our own cost data?', a: 'Usage attribution by team and service, with unattributed spend called out, not hidden.' },
  { k: 'Predictability', q: 'One team on r/Observability opened a renewal quote at close to twice the previous year, with little warning in between.', a: 'A renewal-year forecast with a range, built from your monthly history, plus a commit level sized to it.' },
  { k: 'Action', q: 'In an r/devops thread on auditing the bill, the top answer: filtering logs before they reach Datadog cut the noise, and the cost, by about 90%.', a: 'Generated exclusion filters, Flex moves, tag allowlists and a Vector pipeline you can apply today.' },
]

export function Landing() {
  const sample = useMemo(() => {
    const p = sampleProject()
    const snap = p.snapshots[p.snapshots.length - 1]
    const lv = noLevers()
    lv.logIdx.debug = { exclude: 0.9, preDrop: 0.5, flex: false, flexDays: 90 }
    lv.metricDrop['checkout.cart.latency'] = ['cart_id']
    return { tf: logsIndexTerraform(snap, lv), mt: metricTagTerraform(snap, lv), vec: vectorConfig(snap, lv) }
  }, [])
  const [tab, setTab] = useState<'tf' | 'mt' | 'vec'>('tf')
  return (
    <>
      <Header />
      <Page className="landing">
        <Hero />

        <section className="sec">
          <div className="sec-in">
            <p className="eyebrow center">Why this exists</p>
            <h2 className="h2 center">Get value and predictability from Datadog, not a surprise at renewal</h2>
            <div className="pains">
              {PAINS.map(p => (
                <article key={p.k} className="pain">
                  <span className="pain-k">{p.k}</span>
                  <blockquote>{p.q}</blockquote>
                  <p><Icon name="check" /> {p.a}</p>
                </article>
              ))}
            </div>
            <p className="fine center">Paraphrased from public Reddit threads. Bill Audit helps you keep the tooling you rely on and spend on the parts that earn it.</p>
          </div>
        </section>

        <section className="sec sec-soft">
          <div className="sec-in">
            <h2 className="h2 center">From export to merged change in four steps</h2>
            <ol className="steps">
              <li><b>01</b><h3>Import</h3><p>Usage Attribution CSVs (monthly or hourly), the usage-attribution or estimated-cost JSON from the API, plus optional custom-metric and log-index breakdowns. Formats are detected and columns mapped for you.</p></li>
              <li><b>02</b><h3>Attribute</h3><p>Cost per product and per team, using your team tag plus rules for the rest. Hosts billed on the 99th-percentile high-water mark, allotments pooled the way Datadog pools them.</p></li>
              <li><b>03</b><h3>Find drivers</h3><p>Biggest and fastest-growing lines, cardinality explosions by tag, log indexes nobody queries, APM ingestion past its allotment, and commitments you are not using.</p></li>
              <li><b>04</b><h3>Ship changes</h3><p>Drag the levers, watch the bill and the renewal forecast move, then copy the Terraform, API payloads, Vector config and a printable renewal brief.</p></li>
            </ol>
          </div>
        </section>

        <section className="band">
          <div className="sec-in band-in">
            <div>
              <p className="eyebrow light">Artifacts, not just charts</p>
              <h2 className="h2 light">The output is a change you can review</h2>
              <p className="light-p">Every lever produces config: <code>datadog_logs_index</code> exclusion filters and Flex retention, <code>datadog_metric_tag_configuration</code> allowlists for Metrics without Limits, the matching API payloads, and a Vector pipeline that drops or samples noise before it is ingested.</p>
              <button className="btn btn-white" onClick={openSample}>Generate them on the sample</button>
            </div>
            <div className="code-card">
              <div className="code-tabs" role="tablist">
                {([['tf', 'logs_index.tf'], ['mt', 'metric_tags.tf'], ['vec', 'vector.yaml']] as const).map(([k, l]) => (
                  <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>
                ))}
              </div>
              <pre className="code"><code>{sample[tab]}</code></pre>
            </div>
          </div>
        </section>

        <section className="sec sec-dark">
          <div className="sec-in grid-2">
            <div>
              <p className="eyebrow light">Renewal season</p>
              <h2 className="h2 light">Commit to what you will use, not what you used once</h2>
              <p className="light-p">Bill Audit projects each billing dimension through the renewal year with an 80% range, then sizes commitments with the newsvendor rule: commit up to the usage level you exceed with probability equal to the committed-to-on-demand price ratio. One-off spikes move the level without being extrapolated as growth.</p>
              <p className="light-p">The renewal brief prints current spend, the forecast, the savings plan and the commit recommendation on two pages for the meeting.</p>
            </div>
            <ul className="facts">
              <li><b>99th percentile</b><span>Host-based products bill on the high-water mark of the lower 99% of hourly counts.</span></li>
              <li><b>Pooled allotments</b><span>Custom metrics, containers, indexed spans and ingested spans are allotted per host and pooled across the account.</span></li>
              <li><b>Ingested vs indexed</b><span>Allowlisting tags keeps ingestion (cheap) while cutting indexed timeseries (expensive).</span></li>
              <li><b>Your contract</b><span>List prices are a dated default. Override rates and commit levels per project.</span></li>
            </ul>
          </div>
        </section>

        <section className="sec">
          <div className="sec-in cta-final">
            <h2 className="h2 center">Start with the sample, or bring last month's export</h2>
            <p className="center muted">Everything stays on your device unless you choose to sign in and sync.</p>
            <div className="cta-row center">
              <button className="btn btn-primary" onClick={openSample}>Try the sample</button>
              <Link to="/docs" className="btn btn-outline">How to export from Datadog</Link>
            </div>
          </div>
        </section>
      </Page>
      <Footer />
    </>
  )
}
