import { DIM, DIMS, PRO_HOST, retentionDim, type DimId } from './prices.ts'

export type Tags = Record<string, string>

export interface UsageRow { dim: DimId; qty: number; tags: Tags }

export type MetricType = 'count' | 'gauge' | 'rate' | 'distribution'
export interface TagCard { key: string; card: number }
export interface MetricRow {
  metric: string
  type: MetricType
  /** Monthly average of distinct timeseries per hour (what Datadog bills). */
  avg: number
  tags: TagCard[]
  team?: string
  /** Times queried in dashboards, monitors, notebooks or the API over the last 30 days, if known. */
  queries30d?: number | null
}

export interface LogIndexRow {
  index: string
  /** Index filter query, used in generated configs. */
  query: string
  team?: string
  /** Indexed events this month. */
  events: number
  /** Ingested GB this month for logs routed to this index. */
  gb: number
  retention: number
  /** Searches, monitors and dashboard queries hitting this index over the last 30 days, if known. */
  queries30d?: number | null
  flex?: boolean
}

export interface ReportedCharge { product: string; chargeType: string; cost: number }

export interface PlannedAction { id: string; label: string; area: Area; monthlySavings: number }
export interface Plan { adoptedAt: string; levers: Levers; actions: PlannedAction[]; baselineByArea: Record<Area, number> }

export interface Snapshot {
  id: string
  /** Billing month, YYYY-MM. */
  month: string
  createdAt: string
  source: string
  usage: UsageRow[]
  metrics: MetricRow[]
  logIndexes: LogIndexRow[]
  reported?: ReportedCharge[]
  /** Savings plan adopted while this was the latest month; realized next import. */
  plan?: Plan
}

export interface TagRule { key: string; pattern: string; team: string }

export interface Settings {
  tier: 'pro' | 'enterprise'
  renewalDate: string
  rates: Partial<Record<DimId, { annual?: number; onDemand?: number }>>
  /** Committed monthly quantity per dimension, in raw units (hosts, metrics, events, GB). */
  commits: Partial<Record<DimId, number>>
  teamTag: string
  rules: TagRule[]
  /** Flat monthly Flex compute fee from your contract (0 if Starter or not yet bought). */
  flexComputeMonthly: number
}

export const defaultSettings = (): Settings => ({
  tier: 'enterprise',
  renewalDate: nextYear(),
  rates: {},
  commits: {},
  teamTag: 'team',
  rules: [],
  flexComputeMonthly: 0,
})

function nextYear(): string {
  const d = new Date()
  return `${d.getFullYear() + 1}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}

// ---------- metering ----------

/** Datadog host billing: highest hourly count after discarding the top 1% of hours. */
export function p99HighWater(hourly: number[]): number {
  if (!hourly.length) return 0
  const s = [...hourly].sort((a, b) => a - b)
  const drop = Math.floor(s.length * 0.01)
  return s[s.length - 1 - drop]
}

export function meterMonthly(dim: DimId, hourly: number[]): number {
  if (!hourly.length) return 0
  const m = DIM[dim].metering
  if (m === 'p99') return p99HighWater(hourly)
  if (m === 'average') return hourly.reduce((a, b) => a + b, 0) / hourly.length
  return hourly.reduce((a, b) => a + b, 0)
}

// ---------- rates ----------

export function rateFor(dim: DimId, s: Settings): { annual: number; onDemand: number } {
  const base = DIM[dim]
  let annual = base.annual, onDemand = base.onDemand
  if (dim === 'infra_host' && s.tier === 'pro') ({ annual, onDemand } = PRO_HOST)
  const o = s.rates[dim]
  return { annual: o?.annual ?? annual, onDemand: o?.onDemand ?? onDemand }
}

// ---------- bill ----------

export interface Line {
  dim: DimId
  qty: number
  allotment: number
  billable: number
  committed: number
  overage: number
  unusedCommit: number
  committedCost: number
  overageCost: number
  wastedCommitCost: number
  cost: number
  /** Price of the next raw unit (overage rate if past commit, else 0 while commit is unused). */
  marginalRate: number
}

export interface Bill {
  lines: Line[]
  total: number
  flexCompute: number
  byTeam: { team: string; cost: number; byDim: Partial<Record<DimId, number>> }[]
  unattributed: number
  attributedShare: number
}

export function sumByDim(rows: UsageRow[]): Partial<Record<DimId, number>> {
  const out: Partial<Record<DimId, number>> = {}
  for (const r of rows) out[r.dim] = (out[r.dim] ?? 0) + r.qty
  for (const k in out) out[k as DimId] = Math.max(0, out[k as DimId]!)
  return out
}

export function computeLines(totals: Partial<Record<DimId, number>>, s: Settings): Line[] {
  const lines: Line[] = []
  for (const d of DIMS) {
    const qty = totals[d.id] ?? 0
    const committed = s.commits[d.id] ?? 0
    if (qty <= 0 && committed <= 0) continue
    const allotment = d.allotment ? (totals[d.allotment.per] ?? 0) * d.allotment[s.tier] : 0
    const billable = Math.max(0, qty - allotment)
    const covered = Math.min(billable, committed)
    const overage = billable - covered
    const r = rateFor(d.id, s)
    const committedCost = (committed / d.block) * r.annual
    const overageCost = (overage / d.block) * r.onDemand
    const unusedCommit = committed - covered
    lines.push({
      dim: d.id, qty, allotment, billable, committed, overage, unusedCommit,
      committedCost, overageCost,
      wastedCommitCost: (unusedCommit / d.block) * r.annual,
      cost: committedCost + overageCost,
      marginalRate: unusedCommit > 0 ? 0 : r.onDemand / d.block,
    })
  }
  return lines
}

const EMPTY = new Set(['', '<empty>', 'n/a', 'none', 'null', 'untagged', 'no value'])

export function globMatch(pattern: string, value: string): boolean {
  const re = new RegExp('^' + pattern.split('*').map(p => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$', 'i')
  return re.test(value)
}

/** Team for a usage row: explicit team tag first, then the first matching rule. */
export function teamOf(tags: Tags, s: Settings): string | null {
  const first = (v: string | undefined) => (v ?? '').split('|')[0].trim()
  const t = first(tags[s.teamTag])
  if (t && !EMPTY.has(t.toLowerCase())) return t
  for (const r of s.rules) {
    const v = first(tags[r.key])
    if (v && !EMPTY.has(v.toLowerCase()) && globMatch(r.pattern, v)) return r.team
  }
  return null
}

export function computeBill(usage: UsageRow[], s: Settings): Bill {
  const totals = sumByDim(usage)
  const lines = computeLines(totals, s)
  const flexCompute = (totals.flex_stored ?? 0) > 0 ? s.flexComputeMonthly : 0
  const teams = new Map<string, { team: string; cost: number; byDim: Partial<Record<DimId, number>> }>()
  let unattributed = 0
  // Group rows per dim by team, then share each line's cost by positive quantity.
  for (const line of lines) {
    const rows = usage.filter(r => r.dim === line.dim)
    const byTeam = new Map<string | null, number>()
    for (const r of rows) {
      const t = teamOf(r.tags, s)
      byTeam.set(t, (byTeam.get(t) ?? 0) + r.qty)
    }
    let pos = 0
    for (const v of byTeam.values()) pos += Math.max(0, v)
    if (pos <= 0) { unattributed += line.cost; continue }
    for (const [t, q] of byTeam) {
      const c = line.cost * (Math.max(0, q) / pos)
      if (t === null) { unattributed += c; continue }
      const e = teams.get(t) ?? { team: t, cost: 0, byDim: {} }
      e.cost += c
      e.byDim[line.dim] = (e.byDim[line.dim] ?? 0) + c
      teams.set(t, e)
    }
  }
  unattributed += flexCompute
  const total = lines.reduce((a, l) => a + l.cost, 0) + flexCompute
  return {
    lines: lines.sort((a, b) => b.cost - a.cost),
    total,
    flexCompute,
    byTeam: [...teams.values()].sort((a, b) => b.cost - a.cost),
    unattributed,
    attributedShare: total > 0 ? 1 - unattributed / total : 1,
  }
}

// ---------- levers ----------

export type Area = 'logs' | 'metrics' | 'apm' | 'commit'

export interface LogLever { exclude: number; preDrop: number; flex: boolean; flexDays: number; retention?: number }
export interface Levers {
  logIdx: Record<string, LogLever>
  /** Fraction of indexed logs excluded across all indexes, for snapshots without an index breakdown. */
  logsGlobalExclude: number
  /** Tag keys to drop per metric (Metrics without Limits allowlist = all other tags). */
  metricDrop: Record<string, string[]>
  apmIngestKeep: number
  apmIndexKeep: number
  commit: boolean
}

export const noLevers = (): Levers => ({ logIdx: {}, logsGlobalExclude: 0, metricDrop: {}, apmIngestKeep: 1, apmIndexKeep: 1, commit: false })

export const defaultLogLever = (): LogLever => ({ exclude: 0, preDrop: 0, flex: false, flexDays: 90 })

/** Estimated indexed timeseries once some tags are dropped: never above today's count or the kept-tag product. */
export function cardinalityAfter(m: MetricRow, drop: string[]): number {
  if (!drop.length) return m.avg
  const kept = m.tags.filter(t => !drop.includes(t.key))
  const product = kept.reduce((a, t) => a * Math.max(1, t.card), 1)
  return Math.min(m.avg, product)
}

export interface Adjust { area: Area; key: string; label: string; rows: UsageRow[] }

/** The usage deltas each lever produces, each tagged with the team it belongs to. */
export function leverAdjustments(snap: Snapshot, lv: Levers): Adjust[] {
  const out: Adjust[] = []
  const totals = sumByDim(snap.usage)

  for (const ix of snap.logIndexes) {
    const l = lv.logIdx[ix.index]
    if (!l) continue
    const tags: Tags = ix.team ? { team: ix.team, index: ix.index } : { index: ix.index }
    const rows: UsageRow[] = []
    const kept = ix.events * (1 - l.preDrop) * (1 - l.exclude)
    const fromDim = ix.flex ? 'flex_stored' : retentionDim(ix.retention)
    const fromQty = ix.flex ? ix.events * (ix.retention / 30) : ix.events
    if (l.preDrop > 0) rows.push({ dim: 'logs_ingested_gb', qty: -ix.gb * l.preDrop, tags })
    if (l.flex) {
      rows.push({ dim: fromDim, qty: -fromQty, tags })
      // Flex storage is billed on events stored, so a steady state holds flexDays/30 months of volume.
      rows.push({ dim: 'flex_stored', qty: kept * (l.flexDays / 30), tags })
    } else if (!ix.flex) {
      const toDim = retentionDim(l.retention ?? ix.retention)
      rows.push({ dim: fromDim, qty: -ix.events, tags })
      rows.push({ dim: toDim, qty: kept, tags })
    }
    const parts = [
      l.preDrop > 0 && `drop ${pct(l.preDrop)} before ingest`,
      l.exclude > 0 && `exclude ${pct(l.exclude)}`,
      l.flex && `move to Flex (${l.flexDays}d)`,
      !l.flex && l.retention && l.retention !== ix.retention && `retention ${ix.retention}d → ${l.retention}d`,
    ].filter(Boolean)
    if (parts.length) out.push({ area: 'logs', key: 'log:' + ix.index, label: `Index ${ix.index}: ${parts.join(', ')}`, rows })
  }

  if (lv.logsGlobalExclude > 0) {
    const rows = snap.usage
      .filter(r => r.dim.startsWith('logs_indexed_'))
      .map(r => ({ ...r, qty: -r.qty * lv.logsGlobalExclude }))
    if (rows.length) out.push({ area: 'logs', key: 'log:*', label: `Exclude ${pct(lv.logsGlobalExclude)} of indexed logs`, rows })
  }

  for (const m of snap.metrics) {
    const drop = lv.metricDrop[m.metric]
    if (!drop?.length) continue
    const after = cardinalityAfter(m, drop)
    const tags: Tags = m.team ? { team: m.team, metric: m.metric } : { metric: m.metric }
    out.push({
      area: 'metrics', key: 'metric:' + m.metric,
      label: `${m.metric}: drop ${drop.join(', ')}`,
      rows: [
        { dim: 'custom_metric', qty: after - m.avg, tags },
        { dim: 'ingested_custom_metric', qty: m.avg, tags },
      ],
    })
  }

  const scale = (dim: DimId, keep: number) => snap.usage.filter(r => r.dim === dim).map(r => ({ ...r, qty: -r.qty * (1 - keep) }))
  if (lv.apmIngestKeep < 1 && totals.apm_ingested_gb)
    out.push({ area: 'apm', key: 'apm:ingest', label: `Sample APM ingestion to ${pct(lv.apmIngestKeep)}`, rows: scale('apm_ingested_gb', lv.apmIngestKeep) })
  if (lv.apmIndexKeep < 1 && totals.indexed_spans)
    out.push({ area: 'apm', key: 'apm:index', label: `Keep ${pct(lv.apmIndexKeep)} of indexed spans`, rows: scale('indexed_spans', lv.apmIndexKeep) })
  return out
}

export function pct(x: number): string {
  return `${Math.round(x * 100)}%`
}

export interface LeverStep { key: string; label: string; area: Area; savings: number }
export interface LeverResult {
  base: Bill
  /** Bill with usage levers applied, before commit changes. */
  after: Bill
  /** Expected monthly total with every lever, commit sizing included. */
  afterTotal: number
  steps: LeverStep[]
  savings: number
  settingsAfter: Settings
  usageAfter: UsageRow[]
}

/**
 * Applies levers one at a time so each step's savings are marginal (they sum to the total),
 * then optionally re-sizes commits on the reduced usage.
 */
export function applyLevers(snap: Snapshot, s: Settings, lv: Levers, history: Snapshot[] = [snap]): LeverResult {
  const base = computeBill(snap.usage, s)
  let usage = snap.usage
  let prev = base
  const steps: LeverStep[] = []
  for (const a of leverAdjustments(snap, lv)) {
    usage = [...usage, ...a.rows]
    const b = computeBill(usage, s)
    steps.push({ key: a.key, label: a.label, area: a.area, savings: prev.total - b.total })
    prev = b
  }
  let settingsAfter = s
  let commitSavings = 0
  if (lv.commit) {
    const rec = recommendCommits(history, s, usage)
    settingsAfter = { ...s, commits: { ...s.commits, ...Object.fromEntries(rec.map(r => [r.dim, r.recommended])) } }
    // Commit sizing pays off over the renewal year, so its saving is the expected monthly average there.
    commitSavings = -rec.reduce((a, r) => a + r.annualDelta, 0) / 12
    steps.push({ key: 'commit', label: 'Right-size commitments for the renewal year', area: 'commit', savings: commitSavings })
  }
  const savings = base.total - prev.total + commitSavings
  return { base, after: prev, afterTotal: base.total - savings, steps, savings, settingsAfter, usageAfter: usage }
}

export function costByArea(b: Bill): Record<Area, number> {
  const out: Record<Area, number> = { logs: 0, metrics: 0, apm: 0, commit: 0 }
  for (const l of b.lines) {
    const f = DIM[l.dim].family
    if (f === 'Logs') out.logs += l.cost
    else if (f === 'Metrics') out.metrics += l.cost
    else if (f === 'APM') out.apm += l.cost
    out.commit += l.wastedCommitCost
  }
  return out
}

// ---------- forecast ----------

export function monthIndex(month: string): number {
  const [y, m] = month.split('-').map(Number)
  return y * 12 + (m - 1)
}

export function monthLabel(idx: number): string {
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`
}

export interface Trend { growth: number; sigma: number; n: number; last: number; lastIdx: number; intercept: number }

/**
 * Monthly growth as the median month-over-month log change, so a one-off step (a cardinality
 * explosion, a migration) moves the level without being extrapolated as a growth rate.
 * sigma is the spread of those changes, the per-month uncertainty in log space.
 */
export function fitTrend(points: { idx: number; value: number }[]): Trend {
  const p = points.filter(x => x.value > 0).sort((a, b) => a.idx - b.idx)
  const n = p.length
  if (!n) return { growth: 0, sigma: 0.08, n: 0, last: 0, lastIdx: 0, intercept: 0 }
  const last = p[n - 1]
  if (n === 1) return { growth: 0, sigma: 0.08, n, last: last.value, lastIdx: last.idx, intercept: Math.log(last.value) }
  const diffs: number[] = []
  for (let i = 1; i < n; i++) diffs.push(Math.log(p[i].value / p[i - 1].value) / Math.max(1, p[i].idx - p[i - 1].idx))
  const sorted = [...diffs].sort((a, b) => a - b)
  const med = sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
  // Robust spread: median absolute deviation scaled to a standard deviation.
  const mad = [...diffs.map(d => Math.abs(d - med))].sort((a, b) => a - b)[Math.floor(diffs.length / 2)] * 1.4826
  const sigma = n > 2 ? Math.max(0.03, mad) : 0.08
  return { growth: Math.exp(med) - 1, sigma, n, last: last.value, lastIdx: last.idx, intercept: Math.log(last.value) }
}

const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length

export interface Forecast {
  trend: Trend
  months: { idx: number; mid: number; low: number; high: number }[]
  renewalIdx: number
  /** Next contract year (12 months from renewal). */
  year: { mid: number; low: number; high: number }
  /** Last 12 months of actuals (or annualized latest month when fewer). */
  trailingYear: number
}

/** 80% band: z = 1.2816. Uncertainty widens with the horizon (random-walk style). */
export function forecast(points: { idx: number; value: number }[], renewalDate: string, scale = 1): Forecast {
  const trend = fitTrend(points)
  const renewalIdx = Math.max(monthIndex(renewalDate.slice(0, 7)), trend.lastIdx + 1)
  const months: Forecast['months'] = []
  const z = 1.2816
  const end = renewalIdx + 11
  for (let idx = trend.lastIdx + 1; idx <= end; idx++) {
    const h = idx - trend.lastIdx
    const mu = Math.log(Math.max(1e-9, trend.last * scale)) + Math.log(1 + trend.growth) * h
    const sd = trend.sigma * Math.sqrt(h)
    months.push({ idx, mid: Math.exp(mu), low: Math.exp(mu - z * sd), high: Math.exp(mu + z * sd) })
  }
  const yr = months.filter(m => m.idx >= renewalIdx)
  const sorted = [...points].sort((a, b) => a.idx - b.idx).slice(-12)
  const trailingYear = sorted.length >= 12 ? sorted.reduce((a, p) => a + p.value, 0) : (trend.last * 12)
  return {
    trend, months, renewalIdx, trailingYear,
    year: {
      mid: yr.reduce((a, m) => a + m.mid, 0),
      low: yr.reduce((a, m) => a + m.low, 0),
      high: yr.reduce((a, m) => a + m.high, 0),
    },
  }
}

// ---------- commit recommendation ----------

function erf(x: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(x))
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x)
  return x >= 0 ? y : -y
}
const phi = (x: number) => 0.5 * (1 + erf(x / Math.SQRT2))

export interface CommitRec {
  dim: DimId
  current: number
  recommended: number
  /** Expected billable usage per month over the renewal year (median). */
  expected: number
  quantile: number
  annualDelta: number
}

/**
 * Newsvendor rule: commit up to the usage level you exceed with probability annual/onDemand.
 * Monthly billable usage over the renewal year is modelled as lognormal around the per-dimension trend.
 */
export function recommendCommits(history: Snapshot[], s: Settings, currentUsage?: UsageRow[]): CommitRec[] {
  const out: CommitRec[] = []
  const sorted = [...history].sort((a, b) => monthIndex(a.month) - monthIndex(b.month))
  const latest = sorted[sorted.length - 1]
  if (!latest) return out
  const nowTotals = sumByDim(currentUsage ?? latest.usage)
  const nowLines = computeLines(nowTotals, s)
  const histLines = sorted.map(h => ({ idx: monthIndex(h.month), lines: computeLines(sumByDim(h.usage), s) }))
  const renewalIdx = Math.max(monthIndex(s.renewalDate.slice(0, 7)), monthIndex(latest.month) + 1)
  for (const line of nowLines) {
    const d = DIM[line.dim]
    const r = rateFor(line.dim, s)
    const points = histLines.map(h => ({ idx: h.idx, value: h.lines.find(l => l.dim === line.dim)?.billable ?? 0 }))
    const trend = fitTrend(points)
    const base = line.billable
    const current = s.commits[line.dim] ?? 0
    const ratio = r.onDemand > 0 ? r.annual / r.onDemand : 1
    let recommended = 0
    const mus: number[] = []
    for (let k = 0; k < 12; k++) {
      const h = renewalIdx + k - monthIndex(latest.month)
      mus.push(Math.log(Math.max(1e-9, base)) + Math.log(1 + trend.growth) * h)
    }
    const sd = Math.max(0.03, trend.sigma)
    const target = 1 - ratio
    if (base > 0 && ratio < 1) {
      const F = (c: number) => mean(mus.map(mu => phi((Math.log(c) - mu) / sd)))
      let lo = 1e-6, hi = Math.exp(Math.max(...mus) + 6 * sd)
      for (let i = 0; i < 80; i++) { const m = Math.sqrt(lo * hi); if (F(m) < target) lo = m; else hi = m }
      recommended = roundCommit(lo, d.block)
    }
    const expected = Math.exp(mean(mus))
    const cost = (c: number) => 12 * (c / d.block) * r.annual + mus.reduce((a, mu) => a + expectedOverage(mu, sd, c) / d.block * r.onDemand, 0)
    out.push({ dim: line.dim, current, recommended, expected, quantile: target, annualDelta: cost(recommended) - cost(current) })
  }
  return out
}

/** E[max(0, X - c)] for lognormal X ~ LN(mu, sd). */
function expectedOverage(mu: number, sd: number, c: number): number {
  if (c <= 0) return Math.exp(mu + sd * sd / 2)
  const d1 = (mu + sd * sd - Math.log(c)) / sd
  const d2 = d1 - sd
  return Math.exp(mu + sd * sd / 2) * phi(d1) - c * phi(d2)
}

function roundCommit(x: number, block: number): number {
  if (block > 1) return Math.floor(x / block) * block
  return Math.floor(x)
}
