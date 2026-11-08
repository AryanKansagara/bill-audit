import type { DimId } from './prices.ts'
import { defaultSettings, type LogIndexRow, type MetricRow, type Settings, type Snapshot, type UsageRow } from './model.ts'

// Synthetic data: a fictional mid-size company. Every number here is invented.

const MONTHS = ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10']

interface TeamSpec { team: string; service: string; hosts: number; containers: number; apm: number; metrics: number; ingestGb: number; spans: number; rum?: number; profiled?: number; dbm?: number }

const TEAMS: TeamSpec[] = [
  { team: 'platform', service: 'ingress', hosts: 70, containers: 1200, apm: 22, metrics: 9000, ingestGb: 6200, spans: 60e6, profiled: 6 },
  { team: 'checkout', service: 'checkout-api', hosts: 42, containers: 520, apm: 30, metrics: 5200, ingestGb: 2100, spans: 140e6, rum: 1, profiled: 10 },
  { team: 'payments', service: 'pay-gateway', hosts: 38, containers: 430, apm: 26, metrics: 4800, ingestGb: 1900, spans: 120e6, profiled: 8, dbm: 5 },
  { team: 'search', service: 'search-api', hosts: 36, containers: 380, apm: 20, metrics: 3600, ingestGb: 1500, spans: 90e6, profiled: 6 },
  { team: 'data', service: 'etl-runner', hosts: 48, containers: 610, apm: 14, metrics: 4100, ingestGb: 2600, spans: 40e6, dbm: 5 },
  { team: 'mobile-api', service: 'mobile-bff', hosts: 24, containers: 300, apm: 18, metrics: 2200, ingestGb: 1100, spans: 80e6, rum: 1 },
  { team: 'identity', service: 'auth', hosts: 18, containers: 200, apm: 12, metrics: 1600, ingestGb: 1400, spans: 45e6, profiled: 4, dbm: 2 },
  { team: 'growth', service: 'experiments', hosts: 7, containers: 90, apm: 6, metrics: 900, ingestGb: 300, spans: 15e6, rum: 1 },
]

// Hosts nobody tagged with a team. Some carry a service tag a rule can map; the rest stay unattributed.
const UNTAGGED: { tags: Record<string, string>; hosts: number; containers: number }[] = [
  { tags: { service: 'pay-ledger' }, hosts: 8, containers: 90 },
  { tags: { kube_namespace: 'search-indexer' }, hosts: 6, containers: 80 },
  { tags: { host_group: 'legacy-batch' }, hosts: 14, containers: 160 },
]

function growth(m: number, rate = 0.022): number {
  return Math.pow(1 + rate, m - (MONTHS.length - 1))
}

/** Tiny deterministic jitter so months are not perfectly smooth. */
function wobble(m: number, k: number): number {
  return 1 + 0.012 * Math.sin(m * 1.7 + k * 0.9)
}

function metricsFor(m: number): MetricRow[] {
  const g = growth(m, 0.03)
  const explosion = m >= 4
  const cart: MetricRow = {
    metric: 'checkout.cart.latency', type: 'distribution', team: 'checkout', queries30d: 41,
    avg: explosion ? (m === 4 ? 96000 : 184000) : 4300 * g,
    tags: explosion
      ? [{ key: 'env', card: 3 }, { key: 'service', card: 4 }, { key: 'region', card: 3 }, { key: 'endpoint', card: 12 }, { key: 'cart_id', card: 15800 }]
      : [{ key: 'env', card: 3 }, { key: 'service', card: 4 }, { key: 'region', card: 3 }, { key: 'endpoint', card: 12 }],
  }
  return [
    cart,
    { metric: 'payments.txn.amount', type: 'gauge', team: 'payments', queries30d: 12, avg: 21000 * g, tags: [{ key: 'env', card: 3 }, { key: 'service', card: 6 }, { key: 'currency', card: 14 }, { key: 'merchant_id', card: 1200 }] },
    { metric: 'search.query.duration', type: 'distribution', team: 'search', queries30d: 2, avg: 12800 * g, tags: [{ key: 'env', card: 3 }, { key: 'shard', card: 24 }, { key: 'query_hash', card: 3100 }] },
    { metric: 'kube.custom.pod_cpu', type: 'gauge', team: 'platform', queries30d: 64, avg: 9500 * g, tags: [{ key: 'cluster', card: 4 }, { key: 'kube_namespace', card: 40 }, { key: 'pod_name', card: 2100 }] },
    { metric: 'etl.rows.processed', type: 'count', team: 'data', queries30d: 9, avg: 6200 * g, tags: [{ key: 'dataset', card: 60 }, { key: 'job_id', card: 800 }] },
    { metric: 'api.request.count', type: 'count', team: 'platform', queries30d: 220, avg: 4800 * g, tags: [{ key: 'service', card: 20 }, { key: 'endpoint', card: 120 }, { key: 'status', card: 8 }] },
    { metric: 'mobile.app.launch_ms', type: 'distribution', team: 'mobile-api', queries30d: 30, avg: 3100 * g, tags: [{ key: 'platform', card: 2 }, { key: 'app_version', card: 85 }, { key: 'device_model', card: 140 }] },
    { metric: 'auth.login.attempts', type: 'count', team: 'identity', queries30d: 55, avg: 1400 * g, tags: [{ key: 'method', card: 5 }, { key: 'result', card: 4 }, { key: 'client_id', card: 90 }] },
    { metric: 'growth.experiment.exposure', type: 'count', team: 'growth', queries30d: 0, avg: 2600 * g, tags: [{ key: 'experiment', card: 40 }, { key: 'variant', card: 4 }, { key: 'user_segment', card: 16 }] },
    { metric: 'queue.consumer.lag', type: 'gauge', team: 'data', queries30d: 18, avg: 980 * g, tags: [{ key: 'topic', card: 70 }, { key: 'partition', card: 14 }] },
  ]
}

function indexesFor(m: number): LogIndexRow[] {
  const g = growth(m, 0.028)
  const debugG = growth(m, 0.07)
  return [
    { index: 'debug', query: 'status:debug', team: 'platform', events: 3.4e9 * debugG, gb: 4760 * debugG, retention: 15, queries30d: 3 },
    { index: 'checkout', query: 'service:checkout* -status:debug', team: 'checkout', events: 1.1e9 * g, gb: 1540 * g, retention: 15, queries30d: 410 },
    { index: 'platform', query: 'team:platform -status:debug', team: 'platform', events: 1.0e9 * g, gb: 1400 * g, retention: 15, queries30d: 260 },
    { index: 'payments', query: 'service:pay-* -status:debug', team: 'payments', events: 0.9e9 * g, gb: 1260 * g, retention: 15, queries30d: 340 },
    { index: 'search', query: 'service:search* -status:debug', team: 'search', events: 0.8e9 * g, gb: 1120 * g, retention: 15, queries30d: 120 },
    { index: 'mobile', query: 'service:mobile-bff -status:debug', team: 'mobile-api', events: 0.6e9 * g, gb: 840 * g, retention: 15, queries30d: 95 },
    { index: 'access', query: 'source:nginx', team: 'platform', events: 1.4e9 * g, gb: 1680 * g, retention: 7, queries30d: 18 },
    { index: 'audit', query: 'source:audit', team: 'identity', events: 0.6e9 * g, gb: 600 * g, retention: 30, queries30d: 6 },
  ]
}

function usageFor(m: number, metrics: MetricRow[], idx: LogIndexRow[]): UsageRow[] {
  const rows: UsageRow[] = []
  const push = (dim: DimId, qty: number, tags: Record<string, string>) => { if (qty > 0) rows.push({ dim, qty, tags }) }
  const hostG = growth(m, 0.012)
  TEAMS.forEach((t, k) => {
    const tags = { team: t.team, service: t.service }
    const w = wobble(m, k)
    push('infra_host', Math.round(t.hosts * hostG * w), tags)
    push('container', Math.round(t.containers * growth(m, 0.03) * w), tags)
    push('apm_host', Math.round(t.apm * hostG * w), tags)
    push('apm_ingested_gb', t.spans / 1e6 * 52 * growth(m, 0.035) * w, tags)
    push('indexed_spans', t.spans * growth(m, 0.035) * w, tags)
    const tracked = metrics.filter(x => x.team === t.team).reduce((a, x) => a + x.avg, 0)
    push('custom_metric', t.metrics * growth(m, 0.025) * w + tracked, tags)
    if (t.profiled) { push('profiled_host', t.profiled, tags); push('profiled_container', t.profiled * 6, tags) }
    if (t.dbm) push('dbm_host', t.dbm, tags)
    if (t.rum) {
      push('rum_measure', 730000 * growth(m, 0.04), tags)
      push('rum_investigate', 60000 * growth(m, 0.04), tags)
      push('session_replay', 20000 * growth(m, 0.04), tags)
    }
  })
  UNTAGGED.forEach((u, k) => {
    push('infra_host', Math.round(u.hosts * hostG * wobble(m, k + 9)), u.tags)
    push('container', Math.round(u.containers * growth(m, 0.03)), u.tags)
    push('custom_metric', 1300 * growth(m, 0.025), u.tags)
  })
  // Synthetic tests are created in the UI and rarely carry a team tag.
  push('synthetics_api', 1.8e6 * wobble(m, 3), { synthetics: 'true' })
  push('synthetics_browser', 41000 * wobble(m, 4), { synthetics: 'true' })
  for (const ix of idx) {
    const tags = { team: ix.team!, index: ix.index }
    push(ix.retention === 7 ? 'logs_indexed_7d' : ix.retention === 30 ? 'logs_indexed_30d' : 'logs_indexed_15d', ix.events, tags)
    push('logs_ingested_gb', ix.gb, tags)
  }
  // Logs excluded by existing filters are still ingested; part of that stream has no team tag.
  push('logs_ingested_gb', 3100 * growth(m, 0.03), { source: 'kubernetes' })
  return rows
}

export const SAMPLE_NAME = 'Sample: Northwind Freight (synthetic)'

export function sampleSettings(): Settings {
  return {
    ...defaultSettings(),
    tier: 'enterprise',
    renewalDate: '2027-02-01',
    rates: { custom_metric: { annual: 4, onDemand: 5 } },
    commits: { infra_host: 420, apm_host: 150, logs_indexed_15d: 4e9, container: 500 },
    teamTag: 'team',
    rules: [
      { key: 'service', pattern: 'pay-*', team: 'payments' },
      { key: 'kube_namespace', pattern: 'search*', team: 'search' },
    ],
    flexComputeMonthly: 0,
  }
}

export function sampleSnapshots(): Snapshot[] {
  return MONTHS.map((month, m) => {
    const metrics = metricsFor(m)
    const logIndexes = indexesFor(m)
    return {
      id: `sample-${month}`,
      month,
      createdAt: `${month}-28T12:00:00.000Z`,
      source: 'Synthetic sample',
      usage: usageFor(m, metrics, logIndexes),
      metrics,
      logIndexes,
    }
  })
}
