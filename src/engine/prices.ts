// Datadog public list prices, US sites (US1/US3/US5).
// Captured 2026-11-07 from https://www.datadoghq.com/pricing/list/ and the billing docs linked per line.
// "annual" is the billed-annually (committed) list rate; "onDemand" is the on-demand list rate.
// Contract rates almost always differ: every value here can be overridden per project.

export const PRICES_AS_OF = '2026-11-07'
export const PRICE_SOURCE = 'https://www.datadoghq.com/pricing/list/'

export type DimId =
  | 'infra_host'
  | 'container'
  | 'custom_metric'
  | 'ingested_custom_metric'
  | 'apm_host'
  | 'apm_ingested_gb'
  | 'indexed_spans'
  | 'profiled_host'
  | 'profiled_container'
  | 'dbm_host'
  | 'logs_ingested_gb'
  | 'logs_indexed_3d'
  | 'logs_indexed_7d'
  | 'logs_indexed_15d'
  | 'logs_indexed_30d'
  | 'flex_stored'
  | 'rum_measure'
  | 'rum_investigate'
  | 'session_replay'
  | 'synthetics_api'
  | 'synthetics_browser'

export type Family = 'Infrastructure' | 'Metrics' | 'APM' | 'Logs' | 'RUM' | 'Synthetics' | 'Profiling' | 'Database'

/** How the monthly billable quantity is derived from hourly readings. */
export type Metering = 'p99' | 'average' | 'sum'

export interface Dim {
  id: DimId
  label: string
  family: Family
  /** Unit of one priced block, e.g. "host", "100 metrics", "1M events". */
  unit: string
  /** Raw quantity per priced block (100 for custom metrics, 1e6 for indexed events). Quantities are stored raw. */
  block: number
  /** Raw-unit label for quantities. */
  rawUnit: string
  metering: Metering
  annual: number
  onDemand: number
  /** Allotment granted per unit of another dimension, by plan tier. */
  allotment?: { per: DimId; pro: number; enterprise: number }
  source: string
  note?: string
}

const BILLING = 'https://docs.datadoghq.com/account_management/billing/pricing/'
const CM = 'https://docs.datadoghq.com/account_management/billing/custom_metrics/'
const CONT = 'https://docs.datadoghq.com/account_management/billing/containers/'
const APM = 'https://docs.datadoghq.com/account_management/billing/apm_tracing_profiler/'
const FLEX = 'https://docs.datadoghq.com/logs/log_configuration/flex_logs/'

export const DIMS: Dim[] = [
  { id: 'infra_host', label: 'Infrastructure hosts', family: 'Infrastructure', unit: 'host', block: 1, rawUnit: 'hosts', metering: 'p99', annual: 23, onDemand: 27, source: BILLING, note: 'Enterprise tier. Pro is $15 annual / $18 on-demand. Billed on the high-water mark of the lower 99% of hourly counts.' },
  { id: 'container', label: 'Containers', family: 'Infrastructure', unit: 'container', block: 1, rawUnit: 'containers', metering: 'average', annual: 1, onDemand: 1.46, allotment: { per: 'infra_host', pro: 5, enterprise: 10 }, source: CONT, note: 'On-demand is $0.002 per container hour (about $1.46 per month). Allotment is pooled across the account.' },
  { id: 'custom_metric', label: 'Custom metrics (indexed)', family: 'Metrics', unit: '100 metrics', block: 100, rawUnit: 'metrics', metering: 'average', annual: 5, onDemand: 5, allotment: { per: 'infra_host', pro: 100, enterprise: 200 }, source: CM, note: 'Monthly average of distinct timeseries per hour. Allotment is pooled across hosts.' },
  { id: 'ingested_custom_metric', label: 'Custom metrics (ingested, MwL)', family: 'Metrics', unit: '100 metrics', block: 100, rawUnit: 'metrics', metering: 'average', annual: 0.1, onDemand: 0.1, allotment: { per: 'infra_host', pro: 100, enterprise: 200 }, source: CM, note: 'Only billed for metrics configured with Metrics without Limits.' },
  { id: 'apm_host', label: 'APM hosts', family: 'APM', unit: 'host', block: 1, rawUnit: 'hosts', metering: 'p99', annual: 31, onDemand: 36, source: APM, note: 'APM Pro is $35, APM Enterprise $40 (annual).' },
  { id: 'apm_ingested_gb', label: 'APM ingested spans', family: 'APM', unit: 'GB', block: 1, rawUnit: 'GB', metering: 'sum', annual: 0.1, onDemand: 0.1, allotment: { per: 'apm_host', pro: 150, enterprise: 150 }, source: APM },
  { id: 'indexed_spans', label: 'APM indexed spans (15-day)', family: 'APM', unit: '1M spans', block: 1e6, rawUnit: 'spans', metering: 'sum', annual: 1.7, onDemand: 2.55, allotment: { per: 'apm_host', pro: 1e6, enterprise: 1e6 }, source: APM },
  { id: 'profiled_host', label: 'Profiled hosts', family: 'Profiling', unit: 'host', block: 1, rawUnit: 'hosts', metering: 'p99', annual: 19, onDemand: 23, source: APM },
  { id: 'profiled_container', label: 'Profiled containers', family: 'Profiling', unit: 'container', block: 1, rawUnit: 'containers', metering: 'average', annual: 2, onDemand: 2.92, allotment: { per: 'profiled_host', pro: 4, enterprise: 4 }, source: APM, note: 'On-demand is $0.004 per container hour.' },
  { id: 'dbm_host', label: 'Database Monitoring hosts', family: 'Database', unit: 'host', block: 1, rawUnit: 'hosts', metering: 'p99', annual: 70, onDemand: 84, source: BILLING },
  { id: 'logs_ingested_gb', label: 'Logs ingested', family: 'Logs', unit: 'GB', block: 1, rawUnit: 'GB', metering: 'sum', annual: 0.1, onDemand: 0.1, source: BILLING },
  { id: 'logs_indexed_3d', label: 'Logs indexed (3-day)', family: 'Logs', unit: '1M events', block: 1e6, rawUnit: 'events', metering: 'sum', annual: 1.06, onDemand: 1.59, source: BILLING },
  { id: 'logs_indexed_7d', label: 'Logs indexed (7-day)', family: 'Logs', unit: '1M events', block: 1e6, rawUnit: 'events', metering: 'sum', annual: 1.27, onDemand: 1.91, source: BILLING },
  { id: 'logs_indexed_15d', label: 'Logs indexed (15-day)', family: 'Logs', unit: '1M events', block: 1e6, rawUnit: 'events', metering: 'sum', annual: 1.7, onDemand: 2.55, source: BILLING },
  { id: 'logs_indexed_30d', label: 'Logs indexed (30-day)', family: 'Logs', unit: '1M events', block: 1e6, rawUnit: 'events', metering: 'sum', annual: 2.5, onDemand: 3.75, source: BILLING },
  { id: 'flex_stored', label: 'Flex Logs storage', family: 'Logs', unit: '1M events', block: 1e6, rawUnit: 'events', metering: 'sum', annual: 0.05, onDemand: 0.075, source: FLEX, note: 'Storage only. Scalable Flex compute (XS and up) is a flat monthly fee on your contract; add it as an override.' },
  { id: 'rum_measure', label: 'RUM Measure sessions', family: 'RUM', unit: '1K sessions', block: 1000, rawUnit: 'sessions', metering: 'sum', annual: 0.15, onDemand: 0.22, source: BILLING },
  { id: 'rum_investigate', label: 'RUM Investigate sessions', family: 'RUM', unit: '1K sessions', block: 1000, rawUnit: 'sessions', metering: 'sum', annual: 3, onDemand: 4.5, source: BILLING },
  { id: 'session_replay', label: 'Session Replay', family: 'RUM', unit: '1K sessions', block: 1000, rawUnit: 'sessions', metering: 'sum', annual: 2.5, onDemand: 3.6, source: BILLING },
  { id: 'synthetics_api', label: 'Synthetic API test runs', family: 'Synthetics', unit: '10K runs', block: 10000, rawUnit: 'runs', metering: 'sum', annual: 5, onDemand: 7.2, source: BILLING },
  { id: 'synthetics_browser', label: 'Synthetic browser test runs', family: 'Synthetics', unit: '1K runs', block: 1000, rawUnit: 'runs', metering: 'sum', annual: 12, onDemand: 18, source: BILLING },
]

export const DIM: Record<DimId, Dim> = Object.fromEntries(DIMS.map(d => [d.id, d])) as Record<DimId, Dim>

/** Pro-tier host prices, used when a project is set to the Pro plan. */
export const PRO_HOST = { annual: 15, onDemand: 18 }

export const LOG_RETENTION_DIM: Record<number, DimId> = { 3: 'logs_indexed_3d', 7: 'logs_indexed_7d', 15: 'logs_indexed_15d', 30: 'logs_indexed_30d' }
export const RETENTIONS = [3, 7, 15, 30]

export function retentionDim(days: number): DimId {
  const r = RETENTIONS.find(x => x >= days) ?? 30
  return LOG_RETENTION_DIM[r]
}

/**
 * Aliases used to map column names and product names in Datadog exports onto dimensions.
 * Keys are normalized: lowercase, non-alphanumerics collapsed to "_".
 */
export const ALIASES: Record<string, DimId> = {
  infra_host: 'infra_host', infra_hosts: 'infra_host', infra_host_usage: 'infra_host', hosts: 'infra_host', infra_host_top99p: 'infra_host', host_count: 'infra_host',
  container: 'container', containers: 'container', container_usage: 'container', container_excl_agent_usage: 'container', container_avg: 'container',
  custom_timeseries_usage: 'custom_metric', custom_timeseries: 'custom_metric', custom_metrics: 'custom_metric', custom_metric: 'custom_metric', timeseries: 'custom_metric', num_custom_timeseries: 'custom_metric', custom_ts_avg: 'custom_metric',
  custom_ingested_timeseries_usage: 'ingested_custom_metric', ingested_custom_metrics: 'ingested_custom_metric', custom_ingested_timeseries: 'ingested_custom_metric', num_custom_input_timeseries: 'ingested_custom_metric',
  apm_host_usage: 'apm_host', apm_host: 'apm_host', apm_hosts: 'apm_host', apm_host_top99p: 'apm_host',
  ingested_spans_bytes_usage: 'apm_ingested_gb', ingested_spans_bytes: 'apm_ingested_gb', apm_ingested_bytes: 'apm_ingested_gb', ingested_spans_gb: 'apm_ingested_gb', apm_ingested_gb: 'apm_ingested_gb', ingested_spans: 'apm_ingested_gb',
  indexed_spans_usage: 'indexed_spans', estimated_indexed_spans_usage: 'indexed_spans', indexed_spans: 'indexed_spans', apm_indexed_spans: 'indexed_spans', indexed_events_count: 'indexed_spans',
  profiled_host_usage: 'profiled_host', profiled_host: 'profiled_host', profiled_hosts: 'profiled_host', profiling_host_top99p: 'profiled_host',
  profiled_container_usage: 'profiled_container', profiled_container: 'profiled_container', profiled_containers: 'profiled_container',
  dbm_hosts_usage: 'dbm_host', dbm_hosts: 'dbm_host', dbm_host: 'dbm_host', dbm_host_top99p: 'dbm_host',
  ingested_logs_bytes_usage: 'logs_ingested_gb', ingested_logs_bytes: 'logs_ingested_gb', logs_ingested: 'logs_ingested_gb', logs_ingested_gb: 'logs_ingested_gb', ingested_events_bytes: 'logs_ingested_gb', logs_ingestion: 'logs_ingested_gb',
  logs_indexed_3day: 'logs_indexed_3d', logs_indexed_3d: 'logs_indexed_3d', logs_indexed_3day_count: 'logs_indexed_3d',
  logs_indexed_7day: 'logs_indexed_7d', logs_indexed_7d: 'logs_indexed_7d', logs_indexed_7day_count: 'logs_indexed_7d',
  logs_indexed_15day: 'logs_indexed_15d', logs_indexed_15d: 'logs_indexed_15d', logs_indexed_15day_count: 'logs_indexed_15d', logs_indexed: 'logs_indexed_15d', indexed_logs: 'logs_indexed_15d', logs_indexed_events: 'logs_indexed_15d', indexed_events: 'logs_indexed_15d', logs_indexed_custom_retention_usage: 'logs_indexed_15d',
  logs_indexed_30day: 'logs_indexed_30d', logs_indexed_30d: 'logs_indexed_30d', logs_indexed_30day_count: 'logs_indexed_30d',
  flex_stored_logs_usage: 'flex_stored', flex_stored_logs: 'flex_stored', flex_logs: 'flex_stored', flex_stored: 'flex_stored', flex_logs_storage: 'flex_stored',
  rum_browser_mobile_sessions_usage: 'rum_measure', rum_measure: 'rum_measure', rum_sessions: 'rum_measure', rum_ingested_usage: 'rum_measure', rum_ingested: 'rum_measure',
  rum_investigate_usage: 'rum_investigate', rum_investigate: 'rum_investigate', rum_indexed_sessions: 'rum_investigate',
  rum_replay_sessions_usage: 'session_replay', session_replay: 'session_replay', rum_session_replay_add_on_usage: 'session_replay', replay_sessions: 'session_replay',
  api_usage: 'synthetics_api', synthetics_api: 'synthetics_api', synthetics_api_tests: 'synthetics_api', synthetics_check_calls_count: 'synthetics_api', api_test_runs: 'synthetics_api',
  browser_usage: 'synthetics_browser', synthetics_browser: 'synthetics_browser', synthetics_browser_check_calls_count: 'synthetics_browser', browser_test_runs: 'synthetics_browser',
}

export function normKey(s: string): string {
  return s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
}

export function aliasDim(name: string): DimId | undefined {
  const k = normKey(name)
  if (ALIASES[k]) return ALIASES[k]
  if (k.endsWith('_usage') && ALIASES[k.slice(0, -6)]) return ALIASES[k.slice(0, -6)]
  return undefined
}

/** Quantities in byte-denominated exports arrive in bytes; convert to GB (decimal, as Datadog bills). */
export const BYTE_DIMS: DimId[] = ['apm_ingested_gb', 'logs_ingested_gb']
