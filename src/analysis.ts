import { useMemo } from 'react'
import { applyLevers, computeBill, costByArea, forecast, monthIndex, recommendCommits, teamOf, type Area, type Bill, type Forecast, type LeverResult, type Snapshot, type CommitRec } from './engine/model.ts'
import { apmView, cardinalityExplosions, growthByDim, logIndexValue, reconcile, type ApmView, type Explosion, type Growth, type IndexValue, type Reconciliation } from './engine/drivers.ts'
import { sortedSnapshots, type Project } from './store.ts'

export interface Analysis {
  history: Snapshot[]
  snap: Snapshot
  prev?: Snapshot
  bill: Bill
  bills: { month: string; bill: Bill }[]
  fc: Forecast
  planFc: Forecast
  levers: LeverResult
  explosions: Explosion[]
  indexes: IndexValue[]
  apm: ApmView | null
  growth: Growth[]
  commits: CommitRec[]
  recon: Reconciliation | null
  realized: Realized | null
}

export interface Realized { planMonth: string; month: string; rows: { area: Area; planned: number; realized: number }[] }

/** Everything the workspace shows for one project, as of a selected month. */
export function analyse(p: Project, month?: string): Analysis | null {
  const all = sortedSnapshots(p)
  if (!all.length) return null
  const snap = all.find(s => s.month === month) ?? all[all.length - 1]
  const history = all.filter(s => s.month <= snap.month)
  const prev = history[history.length - 2]
  const s = p.settings
  const bills = history.map(h => ({ month: h.month, bill: computeBill(h.usage, s) }))
  const bill = bills[bills.length - 1].bill
  const points = bills.map(b => ({ idx: monthIndex(b.month), value: b.bill.total }))
  const fc = forecast(points, s.renewalDate)
  const levers = applyLevers(snap, s, p.levers, history)
  const planFc = forecast(points, s.renewalDate, bill.total > 0 ? levers.afterTotal / bill.total : 1)
  return {
    history, snap, prev, bill, bills, fc, planFc, levers,
    explosions: cardinalityExplosions(snap, prev, s, bill),
    indexes: logIndexValue(snap, s),
    apm: apmView(bill),
    growth: growthByDim(history, s),
    commits: recommendCommits(history, s, levers.usageAfter),
    recon: reconcile(snap, s),
    realized: realizedFor(all, snap, p),
  }
}

/** Planned vs realized: the latest earlier snapshot with an adopted plan, measured against this month. */
function realizedFor(all: Snapshot[], snap: Snapshot, p: Project): Realized | null {
  const planned = all.filter(s => s.plan && s.month < snap.month).at(-1)
  if (!planned?.plan) return null
  const now = costByArea(computeBill(snap.usage, p.settings))
  const areas: Area[] = ['logs', 'metrics', 'apm', 'commit']
  return {
    planMonth: planned.month,
    month: snap.month,
    rows: areas.map(area => ({
      area,
      planned: planned.plan!.actions.filter(a => a.area === area).reduce((x, a) => x + a.monthlySavings, 0),
      realized: planned.plan!.baselineByArea[area] - now[area],
    })).filter(r => r.planned !== 0 || Math.abs(r.realized) > 1),
  }
}

export function useAnalysis(p: Project | undefined, month?: string): Analysis | null {
  return useMemo(() => (p ? analyse(p, month) : null), [p, month])
}

/** Where unattributed spend comes from: grouped by the tags the rows do carry. */
export function unattributedSources(a: Analysis, p: Project): { label: string; dim: string; cost: number }[] {
  const out = new Map<string, { label: string; dim: string; cost: number }>()
  for (const line of a.bill.lines) {
    const rows = a.snap.usage.filter(r => r.dim === line.dim)
    const pos = rows.reduce((x, r) => x + Math.max(0, r.qty), 0)
    if (pos <= 0) continue
    for (const r of rows) {
      if (teamOf(r.tags, p.settings) !== null) continue
      const label = Object.entries(r.tags).map(([k, v]) => `${k}:${v}`).join(' ') || '(no tags)'
      const key = label + '|' + line.dim
      const e = out.get(key) ?? { label, dim: line.dim, cost: 0 }
      e.cost += line.cost * Math.max(0, r.qty) / pos
      out.set(key, e)
    }
  }
  return [...out.values()].sort((x, y) => y.cost - x.cost)
}
