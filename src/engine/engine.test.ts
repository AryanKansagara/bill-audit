import { test } from 'node:test'
import assert from 'node:assert/strict'
import { aliasDim, DIM, retentionDim } from './prices.ts'
import {
  applyLevers, cardinalityAfter, computeBill, computeLines, defaultSettings, fitTrend, forecast, globMatch, meterMonthly,
  monthIndex, noLevers, p99HighWater, recommendCommits, teamOf, type Settings, type Snapshot, type UsageRow,
} from './model.ts'
import { build, detect, monthOf, parseCsv, parseTagCards } from './importer.ts'
import { cardinalityExplosions, growthByDim, logIndexValue, reconcile } from './drivers.ts'
import { chargebackCsv, logsIndexJson, logsIndexTerraform, metricTagTerraform, queryToVrl, vectorConfig } from './artifacts.ts'
import { sampleSettings, sampleSnapshots } from './sample.ts'

const S = (o: Partial<Settings> = {}): Settings => ({ ...defaultSettings(), renewalDate: '2027-01-01', ...o })
const snap = (usage: UsageRow[], extra: Partial<Snapshot> = {}): Snapshot => ({ id: 'x', month: '2026-10', createdAt: '', source: 't', usage, metrics: [], logIndexes: [], ...extra })
const close = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps * Math.max(1, Math.abs(b)), `${a} != ${b}`)

// ---------- metering ----------

test('p99 high-water mark drops the top 1% of hours', () => {
  // 720 hours at 100 hosts with 7 spike hours at 500: floor(720 * 0.01) = 7 hours discarded.
  const hours = Array(713).fill(100).concat(Array(7).fill(500))
  assert.equal(p99HighWater(hours), 100)
  // An eighth spike hour survives the cut.
  assert.equal(p99HighWater(Array(712).fill(100).concat(Array(8).fill(500))), 500)
})

test('metering: hosts p99, containers average, volumes sum', () => {
  assert.equal(meterMonthly('infra_host', [1, 2, 3]), 3)
  assert.equal(meterMonthly('container', [10, 20, 30]), 20)
  assert.equal(meterMonthly('logs_ingested_gb', [1, 2, 3]), 6)
})

// ---------- cost model ----------

test('APM worked example from the billing docs: 5 hosts, 30M indexed spans, 900 GB ingested = $212.50', () => {
  const s = S({ commits: { apm_host: 5, indexed_spans: 0, apm_ingested_gb: 0 }, rates: { indexed_spans: { onDemand: 1.7 } } })
  const lines = computeLines({ apm_host: 5, indexed_spans: 30e6, apm_ingested_gb: 900 }, s)
  const total = lines.reduce((a, l) => a + l.cost, 0)
  close(total, 212.5)
})

test('custom metric allotment is pooled per host and tier', () => {
  const ent = computeLines({ infra_host: 10, custom_metric: 2500 }, S({ tier: 'enterprise' }))
  const cm = ent.find(l => l.dim === 'custom_metric')!
  assert.equal(cm.allotment, 2000)
  assert.equal(cm.billable, 500)
  close(cm.cost, 5 * 5)
  const pro = computeLines({ infra_host: 10, custom_metric: 2500 }, S({ tier: 'pro' })).find(l => l.dim === 'custom_metric')!
  assert.equal(pro.allotment, 1000)
})

test('commit vs on-demand: unused commit is paid and reported as waste', () => {
  const l = computeLines({ infra_host: 300 }, S({ commits: { infra_host: 420 } }))[0]
  close(l.cost, 420 * 23)
  close(l.wastedCommitCost, 120 * 23)
  assert.equal(l.marginalRate, 0)
  const over = computeLines({ infra_host: 450 }, S({ commits: { infra_host: 420 } }))[0]
  close(over.cost, 420 * 23 + 30 * 27)
})

test('pro tier and contract overrides change the rate', () => {
  close(computeLines({ infra_host: 10 }, S({ tier: 'pro' }))[0].cost, 10 * 18)
  close(computeLines({ infra_host: 10 }, S({ rates: { infra_host: { onDemand: 12 } } }))[0].cost, 120)
})

// ---------- attribution ----------

test('team from tag, then from glob rules, otherwise unattributed', () => {
  const s = S({ rules: [{ key: 'service', pattern: 'pay-*', team: 'payments' }] })
  assert.equal(teamOf({ team: 'search' }, s), 'search')
  assert.equal(teamOf({ team: 'a | b' }, s), 'a')
  assert.equal(teamOf({ team: '<empty>', service: 'pay-ledger' }, s), 'payments')
  assert.equal(teamOf({ service: 'checkout' }, s), null)
  assert.ok(globMatch('search*', 'search-indexer'))
  assert.ok(!globMatch('search*', 'research'))
})

test('bill attribution sums to the total and surfaces unattributed spend', () => {
  const b = computeBill([
    { dim: 'infra_host', qty: 30, tags: { team: 'a' } },
    { dim: 'infra_host', qty: 10, tags: {} },
  ], S())
  const sum = b.byTeam.reduce((a, t) => a + t.cost, 0) + b.unattributed
  close(sum, b.total)
  close(b.unattributed, b.total / 4)
  close(b.attributedShare, 0.75)
})

// ---------- levers ----------

test('dropping a tag caps indexed timeseries at the kept-tag product', () => {
  const m = { metric: 'x', type: 'gauge' as const, avg: 50000, tags: [{ key: 'env', card: 3 }, { key: 'endpoint', card: 12 }, { key: 'cart_id', card: 15000 }] }
  assert.equal(cardinalityAfter(m, ['cart_id']), 36)
  assert.equal(cardinalityAfter(m, []), 50000)
  assert.equal(cardinalityAfter({ ...m, avg: 20 }, ['cart_id']), 20)
})

test('lever steps are marginal and add up to the total savings', () => {
  const h = sampleSnapshots(), s = sampleSettings(), last = h[h.length - 1]
  const lv = noLevers()
  lv.logIdx.debug = { exclude: 0.9, preDrop: 0, flex: false, flexDays: 90 }
  lv.metricDrop['checkout.cart.latency'] = ['cart_id']
  lv.apmIngestKeep = 0.5
  const r = applyLevers(last, s, lv, h)
  close(r.steps.reduce((a, x) => a + x.savings, 0), r.savings, 1e-9)
  close(r.base.total - r.after.total, r.savings, 1e-9)
  assert.ok(r.steps.every(x => x.savings > 0))
})

test('log exclusion removes exactly the excluded indexed events', () => {
  const ix = { index: 'debug', query: 'status:debug', events: 1e9, gb: 1000, retention: 15 }
  const sn = snap([{ dim: 'logs_indexed_15d', qty: 1e9, tags: {} }], { logIndexes: [ix] })
  const lv = noLevers(); lv.logIdx.debug = { exclude: 0.9, preDrop: 0, flex: false, flexDays: 90 }
  const r = applyLevers(sn, S(), lv)
  close(r.after.lines.find(l => l.dim === 'logs_indexed_15d')!.qty, 1e8, 1e-6)
  close(r.savings, 900 * 2.55)
})

test('moving an index to Flex bills stored events for the Flex retention', () => {
  const ix = { index: 'audit', query: 'source:audit', events: 6e8, gb: 600, retention: 30 }
  const sn = snap([{ dim: 'logs_indexed_30d', qty: 6e8, tags: {} }], { logIndexes: [ix] })
  const lv = noLevers(); lv.logIdx.audit = { exclude: 0, preDrop: 0, flex: true, flexDays: 360 }
  const r = applyLevers(sn, S({ flexComputeMonthly: 100 }), lv)
  const flex = r.after.lines.find(l => l.dim === 'flex_stored')!
  close(flex.qty, 6e8 * 12)
  close(r.after.total, 6e8 * 12 / 1e6 * 0.075 + 100)
  assert.equal(r.after.lines.some(l => l.dim === 'logs_indexed_30d' && l.qty > 0), false)
})

test('pre-ingestion drops also cut ingested GB; retention change moves the price bucket', () => {
  const ix = { index: 'access', query: 'source:nginx', events: 1e9, gb: 1000, retention: 15 }
  const sn = snap([{ dim: 'logs_indexed_15d', qty: 1e9, tags: {} }, { dim: 'logs_ingested_gb', qty: 1000, tags: {} }], { logIndexes: [ix] })
  const lv = noLevers(); lv.logIdx.access = { exclude: 0, preDrop: 0.5, flex: false, flexDays: 90, retention: 7 }
  const r = applyLevers(sn, S(), lv)
  close(r.after.lines.find(l => l.dim === 'logs_ingested_gb')!.qty, 500)
  close(r.after.lines.find(l => l.dim === 'logs_indexed_7d')!.qty, 5e8)
  assert.equal(r.after.lines.find(l => l.dim === 'logs_indexed_15d')?.qty ?? 0, 0)
})

test('MwL allowlist trades indexed metrics for cheap ingested metrics', () => {
  const m = { metric: 'cart', type: 'distribution' as const, avg: 100000, team: 'checkout', tags: [{ key: 'env', card: 3 }, { key: 'cart_id', card: 20000 }] }
  const sn = snap([{ dim: 'custom_metric', qty: 100000, tags: { team: 'checkout' } }], { metrics: [m] })
  const lv = noLevers(); lv.metricDrop.cart = ['cart_id']
  const r = applyLevers(sn, S(), lv)
  close(r.after.lines.find(l => l.dim === 'custom_metric')!.qty, 3)
  close(r.after.lines.find(l => l.dim === 'ingested_custom_metric')!.qty, 100000)
  close(r.savings, 100000 / 100 * 5 - 100000 / 100 * 0.1 - 3 / 100 * 5)
})

// ---------- forecast & commits ----------

test('trend uses the median monthly change, so a one-off step is not extrapolated', () => {
  const pts = [100, 103, 106.09, 300, 309].map((v, i) => ({ idx: 100 + i, value: v }))
  const t = fitTrend(pts)
  close(t.growth, 0.03, 1e-3)
  assert.equal(t.last, 309)
})

test('forecast: flat history projects flat, band contains the midpoint and widens', () => {
  const pts = [1000, 1000, 1000].map((v, i) => ({ idx: monthIndex('2026-08') + i, value: v }))
  const f = forecast(pts, '2027-01-01')
  close(f.year.mid, 12000, 1e-9)
  assert.ok(f.year.low < f.year.mid && f.year.high > f.year.mid)
  const w = (m: { low: number; high: number }) => m.high - m.low
  assert.ok(w(f.months[f.months.length - 1]) > w(f.months[0]))
})

test('commit recommendation follows the newsvendor quantile', () => {
  // Flat usage: optimal commit sits just under the usage level, never above it.
  const h = ['2026-07', '2026-08', '2026-09', '2026-10'].map(month => snap([{ dim: 'infra_host', qty: 300, tags: {} }], { month }))
  const rec = recommendCommits(h, S({ commits: { infra_host: 420 } })).find(r => r.dim === 'infra_host')!
  assert.ok(rec.recommended <= 300 && rec.recommended >= 250, String(rec.recommended))
  assert.ok(rec.annualDelta < 0, 'shrinking an oversized commit saves money')
  // No discount for committing means no reason to commit.
  const flat = recommendCommits(h, S({ rates: { infra_host: { annual: 27, onDemand: 27 } } })).find(r => r.dim === 'infra_host')!
  assert.equal(flat.recommended, 0)
})

// ---------- import ----------

test('CSV parser handles quotes, embedded commas, CRLF and tabs', () => {
  assert.deepEqual(parseCsv('a,b\r\n"x, y","he said ""hi"""\r\n'), [['a', 'b'], ['x, y', 'he said "hi"']])
  assert.deepEqual(parseCsv('a\tb\n1\t2'), [['a', 'b'], ['1', '2']])
})

test('detects monthly usage attribution CSV with tag columns and bytes scaling', () => {
  const csv = 'public_id,month,team,service,infra_host_usage,infra_host_percentage,ingested_logs_bytes_usage\nabc,2026-09,payments,pay-api,40,0.5,2000000000000\nabc,2026-10,payments,pay-api,42,0.5,3000000000000\n'
  const d = detect(csv)
  assert.equal(d.format, 'usage-csv')
  assert.deepEqual(d.columns.find(c => c.header === 'team')!.role, { kind: 'tag', key: 'team' })
  assert.equal(d.columns.find(c => c.header === 'infra_host_percentage')!.role.kind, 'ignore')
  const r = build(csv, d, '2026-01')
  assert.deepEqual(Object.keys(r.months).sort(), ['2026-09', '2026-10'])
  const logs = r.months['2026-10'].find(u => u.dim === 'logs_ingested_gb')!
  close(logs.qty, 3000)
  assert.equal(r.issues.length, 0)
})

test('hourly attribution: account p99 shared by tag-hour weight', () => {
  const lines = ['hour,team,total_usage']
  for (let h = 0; h < 100; h++) {
    const ts = `2026-10-${String(1 + Math.floor(h / 24)).padStart(2, '0')}T${String(h % 24).padStart(2, '0')}:00:00`
    lines.push(`${ts},a,${h === 50 ? 1000 : 30}`, `${ts},b,10`)
  }
  const d = detect(lines.join('\n'))
  assert.equal(d.needsProduct, true)
  const r = build(lines.join('\n'), d, '2026-01')
  const rows = r.months['2026-10']
  const total = rows.reduce((a, x) => a + x.qty, 0)
  assert.equal(total, 40, 'the single spike hour is discarded by the p99 rule')
  assert.ok(r.partial.includes('2026-10'))
})

test('validation report names lines and columns', () => {
  const csv = 'month,team,infra_host_usage\n2026-10,a,12\nnot-a-date,b,3\n2026-10,c,abc\n2026-10,d,-4\n'
  const r = build(csv, detect(csv), '2026-01')
  assert.deepEqual(r.issues.map(i => i.line), [3, 4, 5])
  assert.equal(r.issues[1].column, 'infra_host_usage')
  assert.equal(r.rowsUsed, 1)
})

test('usage attribution and estimated cost JSON from the API', () => {
  const ua = JSON.stringify({ usage: [{ month: '2026-10-01T00:00:00Z', tags: { team: ['search'] }, values: { infra_host_usage: 12, infra_host_percentage: 0.1, custom_timeseries_usage: 900 } }] })
  const d = detect(ua)
  assert.equal(d.format, 'usage-json')
  const r = build(ua, d, '2026-01')
  assert.equal(r.months['2026-10'].length, 2)
  assert.equal(r.months['2026-10'][0].tags.team, 'search')
  const cost = JSON.stringify({ data: [{ attributes: { date: '2026-10-01T00:00:00Z', charges: [{ product_name: 'infra_host', charge_type: 'committed', cost: 100 }, { product_name: 'infra_host', charge_type: 'on_demand', cost: 20 }, { product_name: 'infra_host', charge_type: 'total', cost: 120 }] } }] })
  const c = build(cost, detect(cost), '2026-01')
  assert.equal(c.reported['2026-10'].length, 3)
  const rec = reconcile(snap([{ dim: 'infra_host', qty: 5, tags: {} }], { reported: c.reported['2026-10'] }), S())!
  assert.equal(rec.reported, 120)
})

test('metric and log breakdown pastes', () => {
  assert.deepEqual(parseTagCards('env:3 cart_id:15000'), [{ key: 'env', card: 3 }, { key: 'cart_id', card: 15000 }])
  assert.deepEqual(parseTagCards('env(3);service(40)'), [{ key: 'env', card: 3 }, { key: 'service', card: 40 }])
  const m = 'metric_name,type,avg_per_hour,tags,team\ncart.latency,distribution,180000,env:3 cart_id:15000,checkout\n'
  const dm = detect(m)
  assert.equal(dm.format, 'metrics-csv')
  assert.equal(build(m, dm, '2026-10').metrics[0].tags[1].card, 15000)
  const l = 'index,query,team,events_m,retention_days,queries_30d\ndebug,status:debug,platform,3400,15,3\n'
  const dl = detect(l)
  assert.equal(dl.format, 'logs-csv')
  const ix = build(l, dl, '2026-10').logIndexes[0]
  assert.equal(ix.events, 3.4e9)
  assert.equal(ix.queries30d, 3)
})

test('month parsing and dimension aliases', () => {
  assert.equal(monthOf('2026-10-14T03:00:00Z'), '2026-10')
  assert.equal(monthOf('10/14/2026'), '2026-10')
  assert.equal(aliasDim('Custom Timeseries Usage'), 'custom_metric')
  assert.equal(aliasDim('logs_indexed_30day'), 'logs_indexed_30d')
  assert.equal(retentionDim(10), 'logs_indexed_15d')
  assert.equal(DIM.custom_metric.block, 100)
})

// ---------- drivers ----------

test('sample: cardinality explosion, noisy index and growth are detected', () => {
  const h = sampleSnapshots(), s = sampleSettings(), last = h[h.length - 1]
  const b = computeBill(last.usage, s)
  const ex = cardinalityExplosions(last, h[h.length - 2], s, b)
  assert.equal(ex[0].metric, 'checkout.cart.latency')
  assert.equal(ex[0].culprits[0].key, 'cart_id')
  const iv = logIndexValue(last, s)
  assert.equal(iv[0].index, 'debug')
  assert.equal(iv[0].verdict, 'low')
  assert.equal(growthByDim(h, s)[0].dim, 'custom_metric')
  // The sample commit is oversized.
  assert.ok(b.lines.find(l => l.dim === 'infra_host')!.wastedCommitCost > 2000)
  assert.ok(b.unattributed > 0)
})

// ---------- artifacts ----------

test('generated Terraform and API bodies reflect the lever settings', () => {
  const h = sampleSnapshots(), last = h[h.length - 1]
  const lv = noLevers()
  lv.logIdx.debug = { exclude: 0.9, preDrop: 0, flex: false, flexDays: 90 }
  lv.logIdx.audit = { exclude: 0, preDrop: 0, flex: true, flexDays: 365 }
  lv.metricDrop['checkout.cart.latency'] = ['cart_id']
  const tf = logsIndexTerraform(last, lv)
  assert.match(tf, /resource "datadog_logs_index" "debug"/)
  assert.match(tf, /sample_rate = 0\.9/)
  assert.match(tf, /flex_retention_days = 365/)
  const json = JSON.parse(logsIndexJson(last, lv))
  assert.equal(json[0].body.exclusion_filters[0].filter.sample_rate, 0.9)
  const mt = metricTagTerraform(last, lv)
  assert.match(mt, /tags {8}= \["env", "service", "region", "endpoint"\]/)
  assert.match(mt, /include_percentiles = false/)
  assert.doesNotMatch(mt, /"cart_id"\]/)
})

test('Datadog query to VRL and the Vector pipeline', () => {
  assert.equal(queryToVrl('status:debug'), '((to_string(.status) ?? "") == "debug")')
  assert.equal(queryToVrl('service:pay-* -status:debug'), '(starts_with((to_string(.service) ?? ""), "pay-")) && !((to_string(.status) ?? "") == "debug")')
  assert.equal(queryToVrl('service:a OR service:b'), null)
  const h = sampleSnapshots(), last = h[h.length - 1]
  const lv = noLevers()
  lv.logIdx.debug = { exclude: 0, preDrop: 0.75, flex: false, flexDays: 90 }
  lv.logIdx.access = { exclude: 0, preDrop: 1, flex: false, flexDays: 90 }
  const v = vectorConfig(last, lv)
  assert.match(v, /type: sample\n {4}inputs: \[drop_access\]|type: sample\n {4}inputs: \[datadog_agent\.logs\]/)
  assert.match(v, /rate: 4/)
  assert.match(v, /type: filter/)
  assert.match(v, /inputs: \[(sample|drop)_\w+\]\n {4}default_api_key/)
})

test('chargeback CSV totals match the bill', () => {
  const h = sampleSnapshots(), s = sampleSettings(), last = h[h.length - 1]
  const b = computeBill(last.usage, s)
  const rows = parseCsv(chargebackCsv(b, last.month)).slice(1)
  close(rows.reduce((a, r) => a + Number(r[3]), 0), b.total, 1e-3)
})

test('example exports round-trip through the importer to the same bill', async () => {
  const { monthlyAttributionCsv, hourlyHostsCsv, estimatedCostJson } = await import('../examples.ts')
  const csv = monthlyAttributionCsv()
  const d = detect(csv)
  assert.equal(d.format, 'usage-csv')
  const r = build(csv, d, '2026-01')
  assert.equal(Object.keys(r.months).length, 6)
  const s = sampleSettings(), last = sampleSnapshots().at(-1)!
  close(computeBill(r.months['2026-10'], s).total, computeBill(last.usage, s).total, 1e-3)
  close(computeBill(r.months['2026-10'], s).unattributed, computeBill(last.usage, s).unattributed, 1e-2)
  const h = hourlyHostsCsv()
  const hr = build(h, { ...detect(h), needsProduct: false }, '2026-01')
  const hosts = hr.months['2026-10'].reduce((a, x) => a + x.qty, 0)
  // The 3-hour deploy spike falls inside the top 1% of 744 hours (7 dropped), so it never sets the bill.
  const peakDaily = sampleSnapshots().at(-1)!.usage.filter(u => u.dim === 'infra_host').reduce((a, u) => a + Math.round(u.qty), 0)
  assert.ok(hosts <= peakDaily * 1.01 && hosts > peakDaily * 0.95, String(hosts))
  const c = estimatedCostJson()
  assert.equal(detect(c).format, 'cost-json')
})

test('hourly usage attribution JSON is metered like the hourly CSV', () => {
  const usage = []
  for (let h = 0; h < 48; h++) {
    const hour = `2026-10-0${1 + Math.floor(h / 24)}T${String(h % 24).padStart(2, '0')}:00:00Z`
    usage.push({ hour, tags: { team: ['a'] }, usage_type: 'infra_host_usage', total_usage_sum: 10 + (h === 5 ? 90 : 0) })
    usage.push({ hour, tags: { team: ['b'] }, usage_type: 'infra_host_usage', total_usage_sum: 5 })
  }
  const text = JSON.stringify({ usage })
  assert.equal(detect(text).label, 'Hourly usage attribution (API JSON)')
  const r = build(text, detect(text), '2026-01')
  const rows = r.months['2026-10']
  // 48 hours: floor(0.48) = 0 hours dropped, so the spike hour (105) is the high-water mark.
  close(rows.reduce((a, x) => a + x.qty, 0), 105)
  assert.ok(rows.every(x => x.dim === 'infra_host'))
})
