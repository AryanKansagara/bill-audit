import { useMemo, useRef, useState } from 'react'
import { Icon, Link, monthName, qty, toast } from './ui.tsx'
import { newProject, putProject, sortedSnapshots, uid, type Project } from './store.ts'
import { build, detect, DIM_OPTIONS, type Column, type Detection, type Role } from './engine/importer.ts'
import { DIM, type DimId } from './engine/prices.ts'
import type { Snapshot } from './engine/model.ts'
import { EXAMPLES } from './examples.ts'

const MAX_FILE = 50 * 1024 * 1024

export function ImportFlow({ project, onDone }: { project?: Project; onDone: (id: string) => void }) {
  const [text, setText] = useState('')
  const [fileName, setFileName] = useState('')
  const [det, setDet] = useState<Detection | null>(null)
  const [product, setProduct] = useState<DimId>('infra_host')
  const [target, setTarget] = useState('')
  const [name, setName] = useState('My Datadog account')
  const [drag, setDrag] = useState(false)
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const thisMonth = new Date().toISOString().slice(0, 7)
  const existing = project ? sortedSnapshots(project) : []

  const load = (t: string, file = '') => {
    setText(t)
    setFileName(file)
    const d = t.trim() ? detect(t) : null
    setDet(d)
    setTarget(existing.at(-1)?.month ?? thisMonth)
  }
  const onFile = async (f: File | undefined) => {
    if (!f) return
    if (f.size > MAX_FILE) { toast('That file is over 50 MB. Export a narrower date range or fewer tags.', { kind: 'error' }); return }
    setBusy(true)
    try { load(await f.text(), f.name) } finally { setBusy(false) }
  }
  const effective = useMemo<Detection | null>(() => {
    if (!det) return null
    if (!det.needsProduct) return det
    return { ...det, columns: det.columns.map(c => c.role.kind === 'dim' && ['total_usage', 'usage', 'value', 'quantity'].includes(c.header.trim().toLowerCase()) ? { ...c, role: { kind: 'dim', dim: product, scale: 1 } as Role } : c) }
  }, [det, product])
  const result = useMemo(() => {
    if (!effective || effective.format === 'unknown' && !effective.columns.some(c => c.role.kind === 'dim')) return null
    try { return build(text, effective.format === 'unknown' ? { ...effective, format: 'usage-csv' } : effective, target || thisMonth) } catch (e) { return { error: e instanceof Error ? e.message : String(e) } }
  }, [effective, text, target, thisMonth])
  const setRole = (i: number, role: Role) => setDet(d => d && ({ ...d, columns: d.columns.map((c, j) => j === i ? { ...c, role } : c) }))

  const isUsage = effective && (effective.format === 'usage-csv' || effective.format === 'usage-json' || effective.format === 'unknown')
  const r = result && !('error' in result) ? result : null
  const months = r ? Object.keys(r.months).sort() : []
  const errors = r?.issues.filter(i => i.severity === 'error').length ?? 0
  const canImport = !!r && (isUsage ? months.length > 0 : effective?.format === 'cost-json' ? Object.keys(r.reported).length > 0 : (r.metrics.length + r.logIndexes.length) > 0)

  const commit = async () => {
    if (!r || !effective) return
    const base = project ?? newProject(name.trim() || 'My Datadog account')
    let snaps = [...base.snapshots]
    const upsert = (month: string, patch: (s: Snapshot) => Snapshot) => {
      const i = snaps.findIndex(s => s.month === month)
      const s0: Snapshot = i >= 0 ? snaps[i] : { id: uid(), month, createdAt: new Date().toISOString(), source: '', usage: [], metrics: [], logIndexes: [] }
      const s1 = patch(s0)
      if (i >= 0) snaps[i] = s1
      else snaps = [...snaps, s1]
    }
    const src = fileName || 'Pasted data'
    if (isUsage) for (const m of months) upsert(m, s => ({ ...s, usage: r.months[m], source: `${src} (${effective.label})`, createdAt: new Date().toISOString() }))
    else if (effective.format === 'cost-json') for (const [m, rows] of Object.entries(r.reported)) upsert(m, s => ({ ...s, reported: rows, source: s.source || src }))
    else if (effective.format === 'metrics-csv') upsert(target, s => ({ ...s, metrics: r.metrics, source: s.source || src }))
    else if (effective.format === 'logs-csv') upsert(target, s => ({ ...s, logIndexes: r.logIndexes, source: s.source || src }))
    const saved = await putProject({ ...base, snapshots: snaps })
    toast(isUsage ? `Imported ${months.length} month${months.length === 1 ? '' : 's'} of usage` : `Attached ${effective.label.toLowerCase()} to ${monthName(target, true)}`)
    setText(''); setDet(null)
    onDone(saved.id)
  }

  return (
    <div className="import">
      <ol className="imp-steps" aria-label="Import steps">
        <li className={!det ? 'on' : 'done'}>1 · Source</li>
        <li className={det && !canImport ? 'on' : det ? 'done' : ''}>2 · Map columns</li>
        <li className={canImport ? 'on' : ''}>3 · Validate and import</li>
      </ol>

      <section className="card">
        <div
          className={`drop ${drag ? 'drag' : ''}`}
          onDragOver={e => { e.preventDefault(); setDrag(true) }}
          onDragLeave={() => setDrag(false)}
          onDrop={e => { e.preventDefault(); setDrag(false); void onFile(e.dataTransfer.files[0]) }}
        >
          <Icon name="upload" size={28} />
          <p><b>Drop a CSV, TSV or JSON export</b> or <button className="btn btn-link" onClick={() => inputRef.current?.click()}>choose a file</button></p>
          <p className="muted small">Usage Attribution (monthly or hourly), usage-attribution or estimated-cost API JSON, custom-metric or log-index breakdowns. Files are read in this browser and not uploaded.</p>
          <input ref={inputRef} type="file" accept=".csv,.tsv,.json,.txt" hidden onChange={e => void onFile(e.target.files?.[0])} />
        </div>
        <details className="paste">
          <summary>Or paste data</summary>
          <textarea aria-label="Paste export data" rows={6} placeholder="month,team,service,infra_host_usage,…" value={text} onChange={e => load(e.target.value)} />
        </details>
        <div className="examples">
          <span className="muted small">Example files:</span>
          {EXAMPLES.map(x => <button key={x.name} className="chip btn-chip" onClick={() => load(x.build(), x.name)}>{x.label}</button>)}
          <Link to="/docs" className="small">Where do I get these?</Link>
        </div>
        {busy && <p className="muted">Reading file…</p>}
      </section>

      {det && (
        <section className="card">
          <div className="card-head">
            <h2>Detected: {effective?.label}</h2>
            <span className={`conf ${det.confidence >= 0.9 ? 'hi' : det.confidence >= 0.6 ? 'mid' : 'lo'}`}>{det.confidence >= 0.9 ? 'High confidence' : det.confidence >= 0.6 ? 'Check the mapping' : 'Needs mapping'}</span>
          </div>
          {fileName && <p className="muted small">{fileName}</p>}
          {det.needsProduct && (
            <label className="field inline">This file has one <code>total_usage</code> column. Which product is it?
              <select value={product} onChange={e => setProduct(e.target.value as DimId)}>{DIM_OPTIONS.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}</select>
            </label>
          )}
          {det.columns.length > 0 && <MappingTable cols={det.columns} format={det.format} onChange={setRole} />}
        </section>
      )}

      {det && result && 'error' in result && <section className="card err-card" role="alert"><b>Could not read this file:</b> {result.error}</section>}

      {r && effective && (
        <section className="card">
          <div className="card-head"><h2>Validation report</h2><span className={`conf ${errors ? 'lo' : 'hi'}`}>{errors ? `${errors} error${errors === 1 ? '' : 's'}` : 'No errors'}</span></div>
          <div className="val-stats">
            <div><small>Rows read</small><b className="num">{r.rowsRead}</b></div>
            <div><small>Rows used</small><b className="num">{r.rowsUsed}</b></div>
            {isUsage && <div><small>Months</small><b>{months.map(m => monthName(m)).join(', ') || '—'}</b></div>}
            {effective.format === 'metrics-csv' && <div><small>Metrics</small><b className="num">{r.metrics.length}</b></div>}
            {effective.format === 'logs-csv' && <div><small>Indexes</small><b className="num">{r.logIndexes.length}</b></div>}
            {effective.format === 'cost-json' && <div><small>Charges</small><b className="num">{Object.values(r.reported).flat().length}</b></div>}
          </div>
          {r.partial.length > 0 && <p className="note">Partial month{r.partial.length > 1 ? 's' : ''}: {r.partial.map(m => monthName(m)).join(', ')}. Averages and the 99th percentile use only the hours present; volumes are month-to-date.</p>}
          {isUsage && months.some(m => existing.some(s => s.month === m)) && <p className="note">Existing usage for {months.filter(m => existing.some(s => s.month === m)).map(m => monthName(m)).join(', ')} will be replaced. Breakdowns and plans on those months are kept.</p>}
          {r.issues.length > 0 && (
            <div className="issues">
              <table className="tbl compact">
                <thead><tr><th>Line</th><th>Column</th><th>Issue</th></tr></thead>
                <tbody>{r.issues.slice(0, 50).map((i, k) => <tr key={k} className={i.severity}><td className="num">{i.line}</td><td>{i.column ?? '—'}</td><td><span className={`sev ${i.severity}`}>{i.severity}</span> {i.message}</td></tr>)}</tbody>
              </table>
              {r.issues.length > 50 && <p className="muted small">and {r.issues.length - 50} more.</p>}
            </div>
          )}
          {isUsage && months.length > 0 && <Preview rows={r.months[months[months.length - 1]]} />}
          {!isUsage && effective.format !== 'cost-json' && (
            <label className="field inline">Attach to month
              <input type="month" value={target} onChange={e => setTarget(e.target.value)} />
              {existing.length > 0 && !existing.some(s => s.month === target) && <small className="muted">No usage for this month yet: a new snapshot will be created.</small>}
            </label>
          )}
          {!project && <label className="field inline">Project name<input value={name} onChange={e => setName(e.target.value)} /></label>}
          <div className="row-end">
            <button className="btn btn-ghost" onClick={() => { setText(''); setDet(null) }}>Start over</button>
            <button className="btn btn-primary" disabled={!canImport} onClick={commit}>{isUsage ? `Import ${months.length} month${months.length === 1 ? '' : 's'}` : 'Import breakdown'}</button>
          </div>
          <p className="muted small">Only the parsed usage is saved. The raw file stays out of storage and sync.</p>
        </section>
      )}
    </div>
  )
}

function MappingTable({ cols, format, onChange }: { cols: Column[]; format: Detection['format']; onChange: (i: number, r: Role) => void }) {
  const fieldMode = format === 'metrics-csv' || format === 'logs-csv'
  const fields = format === 'metrics-csv' ? ['metric', 'avg', 'type', 'tags', 'team', 'queries'] : ['index', 'query', 'team', 'service', 'events', 'events_m', 'gb', 'bytes', 'retention', 'queries', 'flex']
  const value = (r: Role) => r.kind === 'dim' ? `dim:${r.dim}` : r.kind === 'tag' ? 'tag' : r.kind === 'field' ? `field:${r.field}` : r.kind
  return (
    <div className="table-wrap">
      <table className="tbl compact map">
        <thead><tr><th>Column</th><th>Sample</th><th>Maps to</th></tr></thead>
        <tbody>
          {cols.map((c, i) => (
            <tr key={i} className={c.role.kind === 'ignore' ? 'dim' : ''}>
              <td><code>{c.header}</code></td>
              <td className="muted small trunc">{c.sample}</td>
              <td>
                <select aria-label={`Mapping for ${c.header}`} value={value(c.role)} onChange={e => {
                  const v = e.target.value
                  if (v === 'ignore') onChange(i, { kind: 'ignore' })
                  else if (v === 'time') onChange(i, { kind: 'time' })
                  else if (v === 'tag') onChange(i, { kind: 'tag', key: c.header.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_') })
                  else if (v.startsWith('dim:')) onChange(i, { kind: 'dim', dim: v.slice(4) as DimId, scale: /bytes/i.test(c.header) ? 1e-9 : 1 })
                  else if (v.startsWith('field:')) onChange(i, { kind: 'field', field: v.slice(6) })
                }}>
                  <option value="ignore">Ignore</option>
                  {fieldMode ? fields.map(f => <option key={f} value={`field:${f}`}>{f}</option>) : (
                    <>
                      <option value="time">Month / hour</option>
                      <option value="tag">Tag (team, service…)</option>
                      <optgroup label="Billing dimension">{DIM_OPTIONS.map(o => <option key={o.id} value={`dim:${o.id}`}>{o.label}</option>)}</optgroup>
                    </>
                  )}
                </select>
                {c.role.kind === 'dim' && c.role.scale !== 1 && <small className="muted"> bytes → GB</small>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Preview({ rows }: { rows: { dim: DimId; qty: number; tags: Record<string, string> }[] }) {
  const byDim = new Map<DimId, number>()
  for (const r of rows) byDim.set(r.dim, (byDim.get(r.dim) ?? 0) + r.qty)
  return (
    <div className="preview">
      <small className="muted">Billable quantities for the latest month</small>
      <ul className="chips">{[...byDim].map(([d, q]) => <li key={d} className="chip">{DIM[d].label}: <b className="num">{qty(q)}</b> {DIM[d].rawUnit}</li>)}</ul>
    </div>
  )
}
