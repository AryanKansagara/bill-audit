import { DIM } from './prices.ts'
import { cardinalityAfter, pct, type Bill, type LogIndexRow, type Levers, type MetricRow, type Snapshot } from './model.ts'

const tfName = (s: string) => s.toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '').replace(/^(\d)/, '_$1') || 'index'
const hcl = (s: string) => JSON.stringify(s)
const money = (n: number) => '$' + Math.round(n).toLocaleString('en-US')

function changedIndexes(snap: Snapshot, lv: Levers): { ix: LogIndexRow; l: Levers['logIdx'][string] }[] {
  return snap.logIndexes
    .map(ix => ({ ix, l: lv.logIdx[ix.index] }))
    .filter(({ ix, l }) => l && (l.exclude > 0 || l.flex || (l.retention && l.retention !== ix.retention)))
}

/** Request bodies for PUT /api/v1/logs/config/indexes/{name}. */
export function logsIndexJson(snap: Snapshot, lv: Levers): string {
  const out = changedIndexes(snap, lv).map(({ ix, l }) => {
    const body: Record<string, unknown> = {
      filter: { query: ix.query },
      num_retention_days: l.retention ?? ix.retention,
      exclusion_filters: l.exclude > 0 ? [{ name: `Sample out ${pct(l.exclude)} (bill audit)`, is_enabled: true, filter: { query: '*', sample_rate: round(l.exclude, 4) } }] : [],
    }
    if (l.flex) body.num_flex_logs_retention_days = l.flexDays
    return { index: ix.index, method: 'PUT', path: `/api/v1/logs/config/indexes/${encodeURIComponent(ix.index)}`, body }
  })
  return JSON.stringify(out, null, 2)
}

export function logsIndexTerraform(snap: Snapshot, lv: Levers): string {
  const blocks = changedIndexes(snap, lv).map(({ ix, l }) => {
    const lines = [
      `resource "datadog_logs_index" ${hcl(tfName(ix.index))} {`,
      `  name = ${hcl(ix.index)}`,
      `  filter {`,
      `    query = ${hcl(ix.query)}`,
      `  }`,
    ]
    if (l.flex) {
      lines.push(`  # Flex Tier only: also turn off the Standard Tier for this index under Logs > Indexes > storage tiers.`)
      lines.push(`  # Logs in Flex are searchable but no longer feed monitors or Watchdog.`)
      lines.push(`  retention_days      = ${l.retention ?? ix.retention}`)
      lines.push(`  flex_retention_days = ${l.flexDays}`)
    } else lines.push(`  retention_days = ${l.retention ?? ix.retention}`)
    if (l.exclude > 0) {
      lines.push(
        `  exclusion_filter {`,
        `    name       = ${hcl(`Sample out ${pct(l.exclude)} (bill audit)`)}`,
        `    is_enabled = true`,
        `    filter {`,
        `      query       = "*"`,
        `      sample_rate = ${round(l.exclude, 4)}`,
        `    }`,
        `  }`,
      )
    }
    lines.push(`}`)
    return lines.join('\n')
  })
  return blocks.length ? header('Log index changes') + blocks.join('\n\n') + '\n' : '# No index changes selected.\n'
}

export function metricTagTerraform(snap: Snapshot, lv: Levers): string {
  const blocks = snap.metrics.filter(m => lv.metricDrop[m.metric]?.length).map(m => metricBlock(m, lv.metricDrop[m.metric]))
  return blocks.length ? header('Metrics without Limits tag allowlists') + blocks.join('\n\n') + '\n' : '# No metric tag changes selected.\n'
}

function metricBlock(m: MetricRow, drop: string[]): string {
  const keep = m.tags.map(t => t.key).filter(k => !drop.includes(k))
  const after = cardinalityAfter(m, drop)
  const lines = [
    `# ${m.metric}: about ${Math.round(m.avg).toLocaleString('en-US')} → at most ${Math.round(after).toLocaleString('en-US')} indexed timeseries.`,
    `# Dropped from queries: ${drop.join(', ')}. Ingested volume is still billed at the ingested rate.`,
    `resource "datadog_metric_tag_configuration" ${hcl(tfName(m.metric))} {`,
    `  metric_name = ${hcl(m.metric)}`,
    `  metric_type = ${hcl(m.type)}`,
    `  tags        = [${keep.map(hcl).join(', ')}]`,
  ]
  if (m.type === 'distribution') lines.push(`  include_percentiles = false`)
  lines.push(`}`)
  return lines.join('\n')
}

/** Request bodies for POST /api/v2/metrics/{metric_name}/tags. */
export function metricTagJson(snap: Snapshot, lv: Levers): string {
  const out = snap.metrics.filter(m => lv.metricDrop[m.metric]?.length).map(m => ({
    method: 'POST',
    path: `/api/v2/metrics/${encodeURIComponent(m.metric)}/tags`,
    body: {
      data: {
        type: 'manage_tags', id: m.metric,
        attributes: { metric_type: m.type, tags: m.tags.map(t => t.key).filter(k => !lv.metricDrop[m.metric].includes(k)), ...(m.type === 'distribution' ? { include_percentiles: false } : {}) },
      },
    },
  }))
  return JSON.stringify(out, null, 2)
}

/**
 * Converts a simple Datadog log query (space-separated AND of key:value terms, optional "-" negation,
 * trailing * wildcards) into a VRL condition. Returns null when the query uses anything richer.
 */
export function queryToVrl(q: string): string | null {
  const s = q.trim()
  if (s === '' || s === '*') return 'true'
  if (/[()"]|\bOR\b|\bAND\b|\bNOT\b/.test(s)) return null
  const parts: string[] = []
  for (const term of s.split(/\s+/)) {
    const neg = term.startsWith('-')
    const t = neg ? term.slice(1) : term
    const m = t.match(/^(@?[\w.-]+):(.+)$/)
    if (!m) return null
    const path = '.' + m[1].replace(/^@/, '').split('.').map(p => /^[a-z_][a-z0-9_]*$/i.test(p) ? p : JSON.stringify(p)).join('.')
    const val = m[2]
    let expr: string
    if (val === '*') expr = `exists(${path})`
    else if (val.endsWith('*') && !val.slice(0, -1).includes('*')) expr = `starts_with((to_string(${path}) ?? ""), ${JSON.stringify(val.slice(0, -1))})`
    else if (val.includes('*')) return null
    else expr = `(to_string(${path}) ?? "") == ${JSON.stringify(val)}`
    parts.push(neg ? `!(${expr})` : `(${expr})`)
  }
  return parts.join(' && ')
}

/** Vector pipeline between the Datadog Agent and Datadog that drops or samples logs before they are ingested. */
export function vectorConfig(snap: Snapshot, lv: Levers): string {
  const rules = snap.logIndexes.map(ix => ({ ix, p: lv.logIdx[ix.index]?.preDrop ?? 0 })).filter(r => r.p > 0)
  const out: string[] = [
    '# Vector pipeline: Datadog Agent -> Vector -> Datadog.',
    '# Point the Agent at Vector with DD_OBSERVABILITY_PIPELINES_WORKER_LOGS_ENABLED=true and',
    '# DD_OBSERVABILITY_PIPELINES_WORKER_LOGS_URL=http://<vector-host>:8282',
    '# (or vector.logs.enabled / vector.logs.url in datadog.yaml).',
    '',
    'sources:',
    '  datadog_agent:',
    '    type: datadog_agent',
    '    address: 0.0.0.0:8282',
    '    multiple_outputs: true',
    '',
  ]
  let input = 'datadog_agent.logs'
  if (!rules.length) {
    out.push('# No pre-ingestion drops selected: this pipeline passes logs straight through.', '')
  } else out.push('transforms:')
  for (const { ix, p } of rules) {
    const cond = queryToVrl(ix.query)
    const id = tfName(ix.index)
    const note = `  # ${ix.index} (${ix.query}): ${p >= 1 ? 'drop all' : `keep about ${pct(1 - p)}`}`
    if (cond === null) {
      out.push(note, `  # The index query could not be translated automatically. Replace "false" with a VRL condition.`)
    } else out.push(note)
    const c = cond ?? 'false'
    if (p >= 1) {
      out.push(`  drop_${id}:`, `    type: filter`, `    inputs: [${input}]`, `    condition: '!(${c})'`, '')
      input = `drop_${id}`
    } else {
      const rate = Math.max(2, Math.round(1 / (1 - p)))
      out.push(
        `  sample_${id}:`,
        `    type: sample`,
        `    inputs: [${input}]`,
        `    rate: ${rate}  # keeps 1 in ${rate}`,
        `    exclude: '!(${c})'  # only matching logs are sampled; everything else passes`,
        '',
      )
      input = `sample_${id}`
    }
  }
  out.push(
    'sinks:',
    '  datadog:',
    '    type: datadog_logs',
    `    inputs: [${input}]`,
    '    default_api_key: ${DD_API_KEY}',
    '    site: ${DD_SITE:-datadoghq.com}',
    '    compression: gzip',
  )
  return out.join('\n') + '\n'
}

export function chargebackCsv(bill: Bill, month: string): string {
  const rows = [['month', 'team', 'product', 'cost_usd']]
  for (const t of bill.byTeam) for (const [d, c] of Object.entries(t.byDim)) rows.push([month, t.team, DIM[d as keyof typeof DIM].label, c!.toFixed(2)])
  rows.push([month, '(unattributed)', 'all', bill.unattributed.toFixed(2)])
  return rows.map(r => r.map(v => /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v).join(',')).join('\n') + '\n'
}

function header(title: string): string {
  return `# ${title}\n# Review before applying: names and queries come from your import.\n\n`
}

function round(x: number, d: number): number {
  const f = 10 ** d
  return Math.round(x * f) / f
}

export { money }
