import { aliasDim, DIM, normKey, type DimId } from './prices.ts'
import { meterMonthly, type LogIndexRow, type MetricRow, type MetricType, type ReportedCharge, type TagCard, type UsageRow } from './model.ts'

// ---------- CSV ----------

export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, '')
  const firstLine = src.slice(0, src.indexOf('\n') >>> 0)
  const delim = (firstLine.match(/\t/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? '\t' : ','
  const rows: string[][] = []
  let row: string[] = [], cell = '', q = false
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (q) {
      if (c === '"') { if (src[i + 1] === '"') { cell += '"'; i++ } else q = false }
      else cell += c
    } else if (c === '"' && cell === '') q = true
    else if (c === delim) { row.push(cell); cell = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++
      row.push(cell); rows.push(row); row = []; cell = ''
    } else cell += c
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row) }
  return rows.filter(r => r.some(c => c.trim() !== ''))
}

export function toNumber(v: string | number | undefined | null): number | null {
  if (v === undefined || v === null) return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  const s = v.trim().replace(/[$,\s]/g, '')
  if (s === '') return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

// ---------- detection & mapping ----------

export type Format = 'usage-csv' | 'usage-json' | 'cost-json' | 'metrics-csv' | 'logs-csv' | 'unknown'

export type Role =
  | { kind: 'ignore' }
  | { kind: 'time' }
  | { kind: 'tag'; key: string }
  | { kind: 'dim'; dim: DimId; scale: number }
  | { kind: 'field'; field: string }

export interface Column { header: string; role: Role; sample: string }

export interface Issue { line: number; column?: string; severity: 'error' | 'warning'; message: string }

export interface Detection {
  format: Format
  label: string
  columns: Column[]
  /** For single-product hourly attribution files ("total_usage"), the product the user must pick. */
  needsProduct: boolean
  confidence: number
}

const META = new Set(['public_id', 'org_name', 'org', 'organization', 'region', 'tag_config_source', 'updated_at', 'account_name', 'account_public_id', 'id', 'type'])
const TIME = new Set(['month', 'hour', 'date', 'day', 'timestamp', 'time', 'period', 'billing_month', 'start_date'])

const METRIC_FIELDS: Record<string, string> = {
  metric: 'metric', metric_name: 'metric', name: 'metric',
  avg: 'avg', avg_hourly: 'avg', average: 'avg', avg_per_hour: 'avg', average_custom_metrics_per_hour: 'avg', avg_custom_metrics_per_hour: 'avg', timeseries: 'avg', cardinality: 'avg', num_timeseries: 'avg', avg_count: 'avg',
  type: 'type', metric_type: 'type',
  tags: 'tags', tag_cardinality: 'tags', tag_keys: 'tags',
  team: 'team', owner: 'team',
  queries: 'queries', queries_30d: 'queries', query_count: 'queries', last_30d_queries: 'queries',
}
const LOG_FIELDS: Record<string, string> = {
  index: 'index', index_name: 'index', log_index: 'index',
  query: 'query', filter: 'query', filter_query: 'query',
  team: 'team', owner: 'team', service: 'service',
  events: 'events', indexed_events: 'events', event_count: 'events', events_indexed: 'events', logs_indexed: 'events',
  events_m: 'events_m', events_millions: 'events_m', indexed_events_m: 'events_m', millions_of_events: 'events_m',
  gb: 'gb', ingested_gb: 'gb', bytes: 'bytes', ingested_bytes: 'bytes',
  retention: 'retention', retention_days: 'retention', num_retention_days: 'retention',
  queries: 'queries', queries_30d: 'queries', query_count: 'queries',
  flex: 'flex', tier: 'flex',
}

function dimRole(header: string): Role | null {
  const k = normKey(header)
  if (k.endsWith('_percentage') || k.endsWith('_pct')) return null
  const dim = aliasDim(header)
  if (!dim) return null
  const scale = k.includes('bytes') ? 1e-9 : 1
  return { kind: 'dim', dim, scale }
}

export function detect(text: string): Detection {
  const t = text.trim()
  if (t.startsWith('{') || t.startsWith('[')) {
    try {
      const j = JSON.parse(t)
      if (Array.isArray(j?.data) && j.data.some((d: any) => d?.attributes?.charges)) return { format: 'cost-json', label: 'Estimated cost (API JSON)', columns: [], needsProduct: false, confidence: 1 }
      if (Array.isArray(j?.usage) && j.usage.some((u: any) => u?.hour && u?.usage_type)) return { format: 'usage-json', label: 'Hourly usage attribution (API JSON)', columns: [], needsProduct: false, confidence: 1 }
      if (Array.isArray(j?.usage) && j.usage.some((u: any) => u?.values)) return { format: 'usage-json', label: 'Monthly usage attribution (API JSON)', columns: [], needsProduct: false, confidence: 1 }
      if (Array.isArray(j?.data) && j.data.some((d: any) => d?.attributes?.values)) return { format: 'usage-json', label: 'Monthly cost or usage attribution (API JSON)', columns: [], needsProduct: false, confidence: 0.8 }
    } catch { /* fall through to unknown */ }
    return { format: 'unknown', label: 'Unrecognised JSON', columns: [], needsProduct: false, confidence: 0 }
  }
  const rows = parseCsv(t)
  if (rows.length < 2) return { format: 'unknown', label: 'Needs a header row and at least one data row', columns: [], needsProduct: false, confidence: 0 }
  const header = rows[0]
  const keys = header.map(normKey)
  const sample = (i: number) => rows.slice(1, 6).map(r => r[i] ?? '').find(v => v.trim() !== '') ?? ''

  if (keys.some(k => METRIC_FIELDS[k] === 'metric') && keys.some(k => METRIC_FIELDS[k] === 'avg') && !keys.some(k => LOG_FIELDS[k] === 'index')) {
    return {
      format: 'metrics-csv', label: 'Custom metrics breakdown', needsProduct: false, confidence: 0.9,
      columns: header.map((h, i) => ({ header: h, sample: sample(i), role: METRIC_FIELDS[keys[i]] ? { kind: 'field', field: METRIC_FIELDS[keys[i]] } : { kind: 'ignore' } })),
    }
  }
  if (keys.some(k => LOG_FIELDS[k] === 'index') && keys.some(k => ['events', 'events_m', 'gb', 'bytes'].includes(LOG_FIELDS[k]))) {
    return {
      format: 'logs-csv', label: 'Log volume by index', needsProduct: false, confidence: 0.9,
      columns: header.map((h, i) => ({ header: h, sample: sample(i), role: LOG_FIELDS[keys[i]] ? { kind: 'field', field: LOG_FIELDS[keys[i]] } : { kind: 'ignore' } })),
    }
  }

  let needsProduct = false
  const columns: Column[] = header.map((h, i) => {
    const k = keys[i]
    if (TIME.has(k)) return { header: h, sample: sample(i), role: { kind: 'time' } }
    if (META.has(k)) return { header: h, sample: sample(i), role: { kind: 'ignore' } }
    if (k === 'total_usage' || k === 'usage' || k === 'value' || k === 'quantity') {
      needsProduct = true
      return { header: h, sample: sample(i), role: { kind: 'dim', dim: 'infra_host', scale: 1 } }
    }
    const d = dimRole(h)
    if (d) return { header: h, sample: sample(i), role: d }
    if (k.endsWith('_percentage') || k.endsWith('_pct')) return { header: h, sample: sample(i), role: { kind: 'ignore' } }
    const numeric = rows.slice(1, 20).every(r => (r[i] ?? '').trim() === '' || toNumber(r[i]) !== null)
    return { header: h, sample: sample(i), role: numeric ? { kind: 'ignore' } : { kind: 'tag', key: k } }
  })
  const dims = columns.filter(c => c.role.kind === 'dim').length
  if (!dims) return { format: 'unknown', label: 'No usage columns recognised. Map them below.', columns, needsProduct: false, confidence: 0.2 }
  const hourly = keys.includes('hour') || keys.includes('timestamp')
  const tagged = columns.some(c => c.role.kind === 'tag')
  const label = `${hourly ? 'Hourly' : 'Monthly'} usage${tagged ? ' attribution by tag' : ''} (CSV)`
  return { format: 'usage-csv', label, columns, needsProduct, confidence: needsProduct ? 0.7 : 0.95 }
}

// ---------- building ----------

export interface ImportResult {
  format: Format
  /** Usage rows per billing month (YYYY-MM). */
  months: Record<string, UsageRow[]>
  metrics: MetricRow[]
  logIndexes: LogIndexRow[]
  reported: Record<string, ReportedCharge[]>
  issues: Issue[]
  rowsRead: number
  rowsUsed: number
  /** Partial months (hourly files) with fewer than ~28 days of hours. */
  partial: string[]
}

const empty = (format: Format): ImportResult => ({ format, months: {}, metrics: [], logIndexes: [], reported: {}, issues: [], rowsRead: 0, rowsUsed: 0, partial: [] })

export function monthOf(v: string): string | null {
  const s = v.trim()
  let m = s.match(/^(\d{4})-(\d{1,2})/)
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}`
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/)
  if (m) return `${m[3]}-${m[1].padStart(2, '0')}`
  const d = new Date(s)
  if (!isNaN(d.getTime())) return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
  return null
}

export function build(text: string, det: Detection, fallbackMonth: string): ImportResult {
  if (det.format === 'cost-json') return buildCost(text, fallbackMonth)
  if (det.format === 'usage-json') return buildUsageJson(text, fallbackMonth)
  if (det.format === 'metrics-csv') return buildMetrics(text, det)
  if (det.format === 'logs-csv') return buildLogs(text, det)
  return buildUsageCsv(text, det, fallbackMonth)
}

function buildUsageCsv(text: string, det: Detection, fallbackMonth: string): ImportResult {
  const res = empty('usage-csv')
  const rows = parseCsv(text)
  const header = rows[0]
  const cols = det.columns
  const timeIdx = cols.findIndex(c => c.role.kind === 'time')
  // A file is a time series when some month holds more than one distinct timestamp (hourly or daily rows).
  const seen = new Map<string, Set<string>>()
  if (timeIdx >= 0) for (const r of rows.slice(1)) {
    const m = monthOf(r[timeIdx] ?? '')
    if (m) (seen.get(m) ?? seen.set(m, new Set()).get(m)!).add((r[timeIdx] ?? '').trim())
  }
  const hourly = [...seen.values()].some(s => s.size > 1)
  // month -> dim -> comboKey -> {tags, perHour}
  type Acc = { tags: Record<string, string>; byHour: Map<string, number> }
  const acc = new Map<string, Map<DimId, Map<string, Acc>>>()
  const hoursPerMonth = new Map<string, Set<string>>()
  res.rowsRead = rows.length - 1
  if (!cols.some(c => c.role.kind === 'dim')) res.issues.push({ line: 1, severity: 'error', message: 'No column is mapped to a billing dimension.' })
  if (timeIdx < 0) res.issues.push({ line: 1, severity: 'warning', message: `No month or hour column; all rows assigned to ${fallbackMonth}.` })

  for (let li = 1; li < rows.length; li++) {
    const r = rows[li]
    const lineNo = li + 1
    if (r.length !== header.length) res.issues.push({ line: lineNo, severity: 'warning', message: `Expected ${header.length} columns, found ${r.length}.` })
    let month = fallbackMonth
    let hourKey = 'm'
    if (timeIdx >= 0) {
      const m = monthOf(r[timeIdx] ?? '')
      if (!m) { res.issues.push({ line: lineNo, column: header[timeIdx], severity: 'error', message: `Can't read a date from "${r[timeIdx] ?? ''}". Row skipped.` }); continue }
      month = m
      if (hourly) hourKey = (r[timeIdx] ?? '').trim()
    }
    const tags: Record<string, string> = {}
    cols.forEach((c, i) => { if (c.role.kind === 'tag' && (r[i] ?? '').trim() !== '') tags[c.role.key] = r[i].trim() })
    const combo = JSON.stringify(Object.entries(tags).sort())
    let used = false
    cols.forEach((c, i) => {
      if (c.role.kind !== 'dim') return
      const raw = r[i] ?? ''
      if (raw.trim() === '') return
      const n = toNumber(raw)
      if (n === null) { res.issues.push({ line: lineNo, column: c.header, severity: 'error', message: `"${raw}" is not a number.` }); return }
      if (n < 0) { res.issues.push({ line: lineNo, column: c.header, severity: 'error', message: 'Negative usage. Value skipped.' }); return }
      const q = n * c.role.scale
      const byDim = acc.get(month) ?? new Map()
      acc.set(month, byDim)
      const byCombo = byDim.get(c.role.dim) ?? new Map()
      byDim.set(c.role.dim, byCombo)
      const a: Acc = byCombo.get(combo) ?? { tags, byHour: new Map() }
      byCombo.set(combo, a)
      a.byHour.set(hourKey, (a.byHour.get(hourKey) ?? 0) + q)
      used = true
    })
    if (used) {
      res.rowsUsed++
      const hs = hoursPerMonth.get(month) ?? new Set()
      hs.add(hourKey)
      hoursPerMonth.set(month, hs)
    }
  }

  for (const [month, byDim] of acc) {
    const hours = [...(hoursPerMonth.get(month) ?? [])]
    if (hourly && new Set(hours.map(h => h.slice(0, 10))).size < 28) res.partial.push(month)
    const out: UsageRow[] = []
    for (const [dim, byCombo] of byDim) {
      if (!hourly) {
        for (const a of byCombo.values()) out.push({ dim, qty: a.byHour.get('m') ?? 0, tags: a.tags })
        continue
      }
      // Meter the account total, then share it by each tag combination's hour-weighted usage.
      const totals = hours.map(h => [...byCombo.values()].reduce((s, a) => s + (a.byHour.get(h) ?? 0), 0))
      const billable = meterMonthly(dim, totals)
      const grand = totals.reduce((a, b) => a + b, 0)
      for (const a of byCombo.values()) {
        const mine = [...a.byHour.values()].reduce((x, y) => x + y, 0)
        out.push({ dim, qty: grand > 0 ? billable * (mine / grand) : 0, tags: a.tags })
      }
    }
    res.months[month] = out
  }
  return res
}

/** Hourly attribution JSON (one usage_type per record) is reshaped to a CSV and metered like the hourly export. */
function hourlyJsonToCsv(items: any[]): string {
  const tagKeys = [...new Set(items.flatMap(u => Object.keys(u?.tags ?? {}).map(normKey)))]
  const types = [...new Set(items.map(u => String(u.usage_type)))]
  const rows = new Map<string, string[]>()
  for (const u of items) {
    const tags = Object.fromEntries(Object.entries(u?.tags ?? {}).map(([k, v]) => [normKey(k), (Array.isArray(v) ? v : [v]).filter(x => x != null).join(' | ')]))
    const key = u.hour + '|' + JSON.stringify(tags)
    const row = rows.get(key) ?? [String(u.hour), ...tagKeys.map(k => tags[k] ?? ''), ...types.map(() => '')]
    row[1 + tagKeys.length + types.indexOf(String(u.usage_type))] = String(u.total_usage_sum ?? '')
    rows.set(key, row)
  }
  const esc = (v: string) => /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
  return [['hour', ...tagKeys, ...types], ...rows.values()].map(r => r.map(esc).join(',')).join('\n')
}

function buildUsageJson(text: string, fallbackMonth: string): ImportResult {
  const j = JSON.parse(text)
  if (Array.isArray(j.usage) && j.usage.some((u: any) => u?.hour && u?.usage_type)) {
    const csv = hourlyJsonToCsv(j.usage)
    const res = buildUsageCsv(csv, detect(csv), fallbackMonth)
    return { ...res, format: 'usage-json', rowsRead: j.usage.length }
  }
  const res = empty('usage-json')
  const items: any[] = Array.isArray(j.usage) ? j.usage : (j.data ?? []).map((d: any) => d.attributes)
  res.rowsRead = items.length
  items.forEach((u, i) => {
    const month = monthOf(String(u?.month ?? u?.date ?? '')) ?? fallbackMonth
    const tags: Record<string, string> = {}
    for (const [k, v] of Object.entries(u?.tags ?? {})) {
      const vals = Array.isArray(v) ? v : [v]
      if (vals.length && vals[0] != null) tags[normKey(k)] = vals.map(String).join(' | ')
    }
    let used = false
    for (const [k, v] of Object.entries(u?.values ?? {})) {
      const role = dimRole(k)
      if (!role || role.kind !== 'dim') continue
      const n = toNumber(v as any)
      if (n === null) continue
      if (n < 0) { res.issues.push({ line: i + 1, column: k, severity: 'error', message: 'Negative usage skipped.' }); continue }
      ;(res.months[month] ??= []).push({ dim: role.dim, qty: n * role.scale, tags })
      used = true
    }
    if (used) res.rowsUsed++
    else res.issues.push({ line: i + 1, severity: 'warning', message: 'Record has no recognised usage values.' })
  })
  return res
}

function buildCost(text: string, fallbackMonth: string): ImportResult {
  const res = empty('cost-json')
  const j = JSON.parse(text)
  const items: any[] = j.data ?? []
  res.rowsRead = items.length
  items.forEach((d, i) => {
    const a = d?.attributes ?? {}
    const month = monthOf(String(a.date ?? '')) ?? fallbackMonth
    const charges: any[] = a.charges ?? []
    if (!charges.length) res.issues.push({ line: i + 1, severity: 'warning', message: 'Entry has no charges.' })
    for (const c of charges) {
      const cost = toNumber(c?.cost)
      if (cost === null) { res.issues.push({ line: i + 1, column: 'cost', severity: 'error', message: `Charge for ${c?.product_name ?? '?'} has no numeric cost.` }); continue }
      ;(res.reported[month] ??= []).push({ product: String(c.product_name ?? 'unknown'), chargeType: String(c.charge_type ?? 'total'), cost })
    }
    res.rowsUsed++
  })
  return res
}

/** "env:3 service:40" or "env(3);service(40)" or "env=3|service=40". Bare keys get cardinality 1. */
export function parseTagCards(s: string): TagCard[] {
  return s.split(/[;,|\s]+/).map(p => p.trim()).filter(Boolean).map(p => {
    const m = p.match(/^([^:=(]+)[:=(]\s*(\d[\d_]*)\)?$/)
    return m ? { key: m[1].trim(), card: Number(m[2].replace(/_/g, '')) } : { key: p, card: 1 }
  })
}

function fieldIdx(det: Detection, field: string): number {
  return det.columns.findIndex(c => c.role.kind === 'field' && c.role.field === field)
}

function buildMetrics(text: string, det: Detection): ImportResult {
  const res = empty('metrics-csv')
  const rows = parseCsv(text)
  const [mi, ai, ti, gi, tei, qi] = ['metric', 'avg', 'type', 'tags', 'team', 'queries'].map(f => fieldIdx(det, f))
  res.rowsRead = rows.length - 1
  const types: MetricType[] = ['count', 'gauge', 'rate', 'distribution']
  for (let li = 1; li < rows.length; li++) {
    const r = rows[li], line = li + 1
    const metric = (r[mi] ?? '').trim()
    if (!metric) { res.issues.push({ line, severity: 'error', message: 'Missing metric name.' }); continue }
    const avg = toNumber(r[ai])
    if (avg === null || avg < 0) { res.issues.push({ line, column: rows[0][ai], severity: 'error', message: `"${r[ai] ?? ''}" is not a valid timeseries count.` }); continue }
    const rawType = (ti >= 0 ? r[ti] ?? '' : '').trim().toLowerCase()
    const type = (types.find(t => rawType.startsWith(t)) ?? 'gauge') as MetricType
    if (ti >= 0 && rawType && !types.some(t => rawType.startsWith(t))) res.issues.push({ line, column: rows[0][ti], severity: 'warning', message: `Unknown type "${rawType}", treated as gauge.` })
    const q = qi >= 0 ? toNumber(r[qi]) : null
    res.metrics.push({ metric, avg, type, tags: gi >= 0 ? parseTagCards(r[gi] ?? '') : [], team: tei >= 0 && r[tei]?.trim() ? r[tei].trim() : undefined, queries30d: q })
    res.rowsUsed++
  }
  if (gi < 0) res.issues.push({ line: 1, severity: 'warning', message: 'No tag cardinality column: explosions are detected from growth only.' })
  return res
}

function buildLogs(text: string, det: Detection): ImportResult {
  const res = empty('logs-csv')
  const rows = parseCsv(text)
  const f = (n: string) => fieldIdx(det, n)
  const [ii, qi, tei, si, ei, emi, gi, bi, ri, qqi, fi] = ['index', 'query', 'team', 'service', 'events', 'events_m', 'gb', 'bytes', 'retention', 'queries', 'flex'].map(f)
  res.rowsRead = rows.length - 1
  const byIndex = new Map<string, LogIndexRow>()
  for (let li = 1; li < rows.length; li++) {
    const r = rows[li], line = li + 1
    const index = (r[ii] ?? '').trim()
    if (!index) { res.issues.push({ line, severity: 'error', message: 'Missing index name.' }); continue }
    let events = ei >= 0 ? toNumber(r[ei]) : null
    if (events === null && emi >= 0) { const m = toNumber(r[emi]); events = m === null ? null : m * 1e6 }
    let gb = gi >= 0 ? toNumber(r[gi]) : null
    if (gb === null && bi >= 0) { const b = toNumber(r[bi]); gb = b === null ? null : b / 1e9 }
    if (events === null && gb === null) { res.issues.push({ line, severity: 'error', message: 'Needs an event count or a GB volume.' }); continue }
    if (events === null) { events = (gb ?? 0) * 1e9 / 1000; res.issues.push({ line, severity: 'warning', message: 'No event count: estimated at 1 KB per event.' }) }
    if (gb === null) gb = events * 1000 / 1e9
    const retention = ri >= 0 ? toNumber(r[ri]) ?? 15 : 15
    if (ri < 0 || toNumber(r[ri]) === null) res.issues.push({ line, severity: 'warning', message: 'No retention: assumed 15 days.' })
    const flexRaw = fi >= 0 ? (r[fi] ?? '').trim().toLowerCase() : ''
    const team = tei >= 0 && r[tei]?.trim() ? r[tei].trim() : undefined
    const query = qi >= 0 && r[qi]?.trim() ? r[qi].trim() : si >= 0 && r[si]?.trim() ? `service:${r[si].trim()}` : '*'
    const prev = byIndex.get(index)
    if (prev) { prev.events += events; prev.gb += gb; continue }
    byIndex.set(index, { index, query, team, events, gb, retention, queries30d: qqi >= 0 ? toNumber(r[qqi]) : null, flex: ['true', 'yes', 'flex', '1'].includes(flexRaw) })
    res.rowsUsed++
  }
  res.logIndexes = [...byIndex.values()]
  return res
}

export const DIM_OPTIONS = Object.values(DIM).map(d => ({ id: d.id, label: d.label }))
