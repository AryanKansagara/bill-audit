import { sampleSettings, sampleSnapshots } from './engine/sample.ts'
import { computeBill } from './engine/model.ts'
import type { DimId } from './engine/prices.ts'

// Example export files built from the synthetic sample, in the column names Datadog uses.

const COL: Partial<Record<DimId, { col: string; scale: number }>> = {
  infra_host: { col: 'infra_host_usage', scale: 1 },
  container: { col: 'container_usage', scale: 1 },
  custom_metric: { col: 'custom_timeseries_usage', scale: 1 },
  apm_host: { col: 'apm_host_usage', scale: 1 },
  apm_ingested_gb: { col: 'ingested_spans_bytes_usage', scale: 1e9 },
  indexed_spans: { col: 'indexed_spans_usage', scale: 1 },
  profiled_host: { col: 'profiled_host_usage', scale: 1 },
  profiled_container: { col: 'profiled_container_usage', scale: 1 },
  dbm_host: { col: 'dbm_hosts_usage', scale: 1 },
  logs_ingested_gb: { col: 'ingested_logs_bytes_usage', scale: 1e9 },
  logs_indexed_7d: { col: 'logs_indexed_7day_usage', scale: 1 },
  logs_indexed_15d: { col: 'logs_indexed_15day_usage', scale: 1 },
  logs_indexed_30d: { col: 'logs_indexed_30day_usage', scale: 1 },
  rum_measure: { col: 'rum_browser_mobile_sessions_usage', scale: 1 },
  rum_investigate: { col: 'rum_investigate_usage', scale: 1 },
  session_replay: { col: 'rum_replay_sessions_usage', scale: 1 },
  synthetics_api: { col: 'api_usage', scale: 1 },
  synthetics_browser: { col: 'browser_usage', scale: 1 },
}

function csv(rows: (string | number)[][]): string {
  return rows.map(r => r.map(v => typeof v === 'string' && /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : String(v)).join(',')).join('\n') + '\n'
}

export function monthlyAttributionCsv(): string {
  const snaps = sampleSnapshots()
  const tagKeys = ['team', 'service', 'kube_namespace', 'host_group']
  const dims = Object.keys(COL) as DimId[]
  const out: (string | number)[][] = [['public_id', 'month', ...tagKeys, ...dims.map(d => COL[d]!.col)]]
  for (const s of snaps) {
    const combos = new Map<string, { tags: Record<string, string>; v: Partial<Record<DimId, number>> }>()
    for (const r of s.usage) {
      const tags = Object.fromEntries(tagKeys.map(k => [k, r.tags[k] ?? '']))
      const key = JSON.stringify(tags)
      const e = combos.get(key) ?? { tags, v: {} }
      e.v[r.dim] = (e.v[r.dim] ?? 0) + r.qty
      combos.set(key, e)
    }
    for (const { tags, v } of combos.values()) {
      out.push(['abc123', s.month, ...tagKeys.map(k => tags[k]), ...dims.map(d => v[d] === undefined ? '' : Math.round(v[d]! * COL[d]!.scale))])
    }
  }
  return csv(out)
}

export function hourlyHostsCsv(): string {
  const s = sampleSnapshots().at(-1)!
  const rows: (string | number)[][] = [['public_id', 'hour', 'team', 'service', 'total_usage']]
  const hosts = s.usage.filter(r => r.dim === 'infra_host')
  for (let h = 0; h < 31 * 24; h++) {
    const day = 1 + Math.floor(h / 24), hr = h % 24
    const ts = `2026-10-${String(day).padStart(2, '0')} ${String(hr).padStart(2, '0')}:00:00`
    // Daytime autoscaling plus a short deploy spike on the 14th.
    const scale = 0.82 + 0.18 * Math.max(0, Math.sin((hr - 6) / 24 * Math.PI * 2)) + (day === 14 && hr >= 10 && hr < 13 ? 0.6 : 0)
    for (const r of hosts) rows.push(['abc123', ts, r.tags.team ?? '', r.tags.service ?? '', Math.round(r.qty * scale)])
  }
  return csv(rows)
}

export function metricsCsv(): string {
  const s = sampleSnapshots().at(-1)!
  return csv([
    ['metric_name', 'type', 'avg_per_hour', 'tags', 'team', 'queries_30d'],
    ...s.metrics.map(m => [m.metric, m.type, Math.round(m.avg), m.tags.map(t => `${t.key}:${t.card}`).join(' '), m.team ?? '', m.queries30d ?? '']),
  ])
}

export function logsCsv(): string {
  const s = sampleSnapshots().at(-1)!
  return csv([
    ['index', 'query', 'team', 'events_m', 'ingested_gb', 'retention_days', 'queries_30d'],
    ...s.logIndexes.map(i => [i.index, i.query, i.team ?? '', Math.round(i.events / 1e6), Math.round(i.gb), i.retention, i.queries30d ?? '']),
  ])
}

const PRODUCT: Partial<Record<DimId, string>> = { infra_host: 'infra_host', container: 'infra_container', custom_metric: 'timeseries', apm_host: 'apm_host', apm_ingested_gb: 'ingested_spans', indexed_spans: 'indexed_spans', logs_ingested_gb: 'logs_ingested', logs_indexed_7d: 'logs_indexed_7day', logs_indexed_15d: 'logs_indexed_15day', logs_indexed_30d: 'logs_indexed_30day' }

export function estimatedCostJson(): string {
  const s = sampleSnapshots().at(-1)!
  const b = computeBill(s.usage, sampleSettings())
  const charges = b.lines.flatMap(l => {
    const product = PRODUCT[l.dim] ?? l.dim
    // Contract rates differ from list: the example is 4% under the model, as a real estimate might be.
    const k = 0.96
    return [
      { product_name: product, charge_type: 'committed', cost: +(l.committedCost * k).toFixed(2) },
      { product_name: product, charge_type: 'on_demand', cost: +(l.overageCost * k).toFixed(2) },
      { product_name: product, charge_type: 'total', cost: +(l.cost * k).toFixed(2) },
    ]
  })
  return JSON.stringify({ data: [{ id: 'abc123', type: 'cost_by_org', attributes: { org_name: 'Northwind Freight (synthetic)', public_id: 'abc123', region: 'us', date: `${s.month}-01T00:00:00Z`, total_cost: +(b.total * 0.96).toFixed(2), charges } }] }, null, 2)
}

export const EXAMPLES = [
  { name: 'usage_attribution_monthly.csv', label: 'Monthly attribution CSV', build: monthlyAttributionCsv },
  { name: 'usage_attribution_hourly_infra_hosts.csv', label: 'Hourly hosts CSV', build: hourlyHostsCsv },
  { name: 'estimated_cost.json', label: 'Estimated cost JSON', build: estimatedCostJson },
  { name: 'top_custom_metrics.csv', label: 'Custom metrics breakdown', build: metricsCsv },
  { name: 'log_volume_by_index.csv', label: 'Log volume by index', build: logsCsv },
]
