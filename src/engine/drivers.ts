import { DIM, retentionDim, type DimId } from './prices.ts'
import { computeBill, computeLines, monthIndex, rateFor, sumByDim, type Bill, type LogIndexRow, type Settings, type Snapshot } from './model.ts'

export interface Growth { dim: DimId; first: number; last: number; months: number; monthly: number; delta: number }

/** Month-over-month compound growth of each line's cost between the first and latest snapshot. */
export function growthByDim(history: Snapshot[], s: Settings): Growth[] {
  const h = [...history].sort((a, b) => monthIndex(a.month) - monthIndex(b.month))
  if (h.length < 2) return []
  const a = h[0], b = h[h.length - 1]
  const months = monthIndex(b.month) - monthIndex(a.month)
  const la = computeLines(sumByDim(a.usage), s), lb = computeLines(sumByDim(b.usage), s)
  return lb.map(l => {
    const first = la.find(x => x.dim === l.dim)?.cost ?? 0
    const monthly = first > 0 && months > 0 ? Math.pow(l.cost / first, 1 / months) - 1 : l.cost > 0 ? Infinity : 0
    return { dim: l.dim, first, last: l.cost, months, monthly, delta: l.cost - first }
  }).filter(g => g.last > 0).sort((x, y) => y.delta - x.delta)
}

const UNBOUNDED = /(^|_)(user|customer|account|session|request|trace|span|order|cart|pod|container|host_?id|ip|url|path|uuid|id|email|query|sha|commit|build|job|run|timestamp)(_|$)|_id$/i

export function looksUnbounded(key: string): boolean {
  return UNBOUNDED.test(key)
}

export interface Explosion {
  metric: string
  avg: number
  share: number
  monthlyCost: number
  culprits: { key: string; card: number }[]
  keep: string[]
  growth: number | null
  queries30d: number | null | undefined
  team?: string
}

/**
 * Metrics whose timeseries count is driven by a high-cardinality tag.
 * Cost is the marginal cost: what removing those timeseries would save at the current overage rate.
 */
export function cardinalityExplosions(snap: Snapshot, prev: Snapshot | undefined, s: Settings, bill: Bill): Explosion[] {
  const total = snap.metrics.reduce((a, m) => a + m.avg, 0) || 1
  const line = bill.lines.find(l => l.dim === 'custom_metric')
  const rate = line ? line.marginalRate : rateFor('custom_metric', s).onDemand / 100
  const out: Explosion[] = []
  for (const m of snap.metrics) {
    const culprits = m.tags.filter(t => t.card >= 200 || (t.card >= 50 && looksUnbounded(t.key))).sort((a, b) => b.card - a.card)
    const before = prev?.metrics.find(p => p.metric === m.metric)
    const growth = before && before.avg > 0 ? m.avg / before.avg - 1 : null
    const share = m.avg / total
    if (!culprits.length && !(growth !== null && growth > 1 && share > 0.02)) continue
    if (m.avg < 1000) continue
    out.push({
      metric: m.metric, avg: m.avg, share, monthlyCost: m.avg * rate,
      culprits, keep: m.tags.filter(t => !culprits.includes(t)).map(t => t.key),
      growth, queries30d: m.queries30d, team: m.team,
    })
  }
  return out.sort((a, b) => b.avg - a.avg)
}

export interface IndexValue {
  index: string
  team?: string
  events: number
  retention: number
  monthlyCost: number
  queries30d: number | null | undefined
  costPerQuery: number | null
  verdict: 'low' | 'ok' | 'unknown'
  reason: string
}

/** Cost of each log index against how often anyone reads it. */
export function logIndexValue(snap: Snapshot, s: Settings): IndexValue[] {
  const logsSpend = snap.logIndexes.reduce((a, ix) => a + indexCost(ix, s), 0) || 1
  return snap.logIndexes.map(ix => {
    const monthlyCost = indexCost(ix, s)
    const q = ix.queries30d
    const costPerQuery = q ? monthlyCost / q : null
    const debugish = /debug|trace|verbose|access|health/i.test(ix.index + ' ' + ix.query)
    let verdict: IndexValue['verdict'] = 'ok'
    let reason = 'Queried often enough for its cost.'
    if (q == null) {
      verdict = debugish && monthlyCost / logsSpend > 0.05 ? 'low' : 'unknown'
      reason = debugish ? 'No query data, and it looks like debug or access noise.' : 'No query data. Add query counts to judge value.'
    } else if (monthlyCost / logsSpend > 0.03 && (q <= 10 || (costPerQuery ?? 0) > 200)) {
      verdict = 'low'
      reason = q === 0 ? 'Nobody queried it in 30 days.' : `${q} queries in 30 days: about $${Math.round(costPerQuery!)} per query.`
    }
    return { index: ix.index, team: ix.team, events: ix.events, retention: ix.retention, monthlyCost, queries30d: q, costPerQuery, verdict, reason }
  }).sort((a, b) => b.monthlyCost - a.monthlyCost)
}

/** Standalone indexing cost of one index at the overage rate for its retention (ingest excluded). */
export function indexCost(ix: LogIndexRow, s: Settings): number {
  if (ix.flex) return (ix.events * (ix.retention / 30) / 1e6) * rateFor('flex_stored', s).onDemand
  const dim = retentionDim(ix.retention)
  const r = rateFor(dim, s).onDemand
  return (ix.events / DIM[dim].block) * r
}

export interface ApmView {
  hosts: number
  ingestedGb: number
  ingestAllotment: number
  ingestOverageCost: number
  indexedSpans: number
  indexAllotment: number
  indexOverageCost: number
  /** Ingestion keep-rate that would fit the allotment. */
  keepToFit: number | null
  spansPerGb: number
}

export function apmView(bill: Bill): ApmView | null {
  const get = (d: DimId) => bill.lines.find(l => l.dim === d)
  const ing = get('apm_ingested_gb'), idx = get('indexed_spans'), hosts = get('apm_host')
  if (!ing && !idx) return null
  return {
    hosts: hosts?.qty ?? 0,
    ingestedGb: ing?.qty ?? 0,
    ingestAllotment: ing?.allotment ?? 0,
    ingestOverageCost: ing?.cost ?? 0,
    indexedSpans: idx?.qty ?? 0,
    indexAllotment: idx?.allotment ?? 0,
    indexOverageCost: idx?.cost ?? 0,
    keepToFit: ing && ing.qty > ing.allotment ? ing.allotment / ing.qty : null,
    spansPerGb: ing && ing.qty ? (idx?.qty ?? 0) / ing.qty : 0,
  }
}

export interface Reconciliation { modelled: number; reported: number; diff: number; diffPct: number }

/** Compares the modelled bill with the estimated-cost export, when one was imported. */
export function reconcile(snap: Snapshot, s: Settings): Reconciliation | null {
  if (!snap.reported?.length) return null
  const rows = snap.reported
  const hasTotal = rows.some(r => r.chargeType === 'total')
  const reported = rows.filter(r => (hasTotal ? r.chargeType === 'total' : true)).reduce((a, r) => a + r.cost, 0)
  const modelled = computeBill(snap.usage, s).total
  return { modelled, reported, diff: modelled - reported, diffPct: reported ? (modelled - reported) / reported : 0 }
}
