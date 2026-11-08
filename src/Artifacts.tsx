import { useMemo, useState } from 'react'
import { CopyButton, Icon, Link, download } from './ui.tsx'
import type { Project } from './store.ts'
import type { Analysis } from './analysis.ts'
import { chargebackCsv, logsIndexJson, logsIndexTerraform, metricTagJson, metricTagTerraform, vectorConfig } from './engine/artifacts.ts'

interface Art { id: string; file: string; title: string; desc: string; text: string; type: string; empty: boolean }

export function Artifacts({ p, a }: { p: Project; a: Analysis }) {
  const lv = p.levers
  const arts = useMemo<Art[]>(() => {
    const hasIdx = Object.keys(lv.logIdx).length > 0
    const hasMetric = Object.values(lv.metricDrop).some(d => d.length)
    const hasPre = Object.values(lv.logIdx).some(l => l.preDrop > 0)
    return [
      { id: 'logs-tf', file: 'datadog_logs_index.tf', title: 'Log indexes (Terraform)', desc: 'datadog_logs_index blocks with exclusion filters, retention and Flex retention.', text: logsIndexTerraform(a.snap, lv), type: 'text/plain', empty: !hasIdx },
      { id: 'logs-json', file: 'logs_indexes.json', title: 'Log indexes (API)', desc: 'Request bodies for PUT /api/v1/logs/config/indexes/{name}.', text: logsIndexJson(a.snap, lv), type: 'application/json', empty: !hasIdx },
      { id: 'metrics-tf', file: 'datadog_metric_tag_configuration.tf', title: 'Tag allowlists (Terraform)', desc: 'Metrics without Limits configs that keep only the tags you query.', text: metricTagTerraform(a.snap, lv), type: 'text/plain', empty: !hasMetric },
      { id: 'metrics-json', file: 'metric_tag_configs.json', title: 'Tag allowlists (API)', desc: 'Request bodies for POST /api/v2/metrics/{metric_name}/tags.', text: metricTagJson(a.snap, lv), type: 'application/json', empty: !hasMetric },
      { id: 'vector', file: 'vector.yaml', title: 'Vector pipeline', desc: 'Drops or samples noisy logs between the Agent and Datadog, so they are never ingested.', text: vectorConfig(a.snap, lv), type: 'text/yaml', empty: !hasPre },
      { id: 'chargeback', file: `chargeback-${a.snap.month}.csv`, title: 'Chargeback CSV', desc: 'Cost per team and product for this month, unattributed included.', text: chargebackCsv(a.bill, a.snap.month), type: 'text/csv', empty: false },
    ]
  }, [a, lv])
  const [sel, setSel] = useState(arts.find(x => !x.empty)?.id ?? 'chargeback')
  const cur = arts.find(x => x.id === sel)!
  return (
    <div className="artifacts">
      <aside className="art-list" role="tablist" aria-label="Artifacts">
        {arts.map(x => (
          <button key={x.id} role="tab" aria-selected={sel === x.id} className={`art-item ${sel === x.id ? 'on' : ''} ${x.empty ? 'dim' : ''}`} onClick={() => setSel(x.id)}>
            <Icon name="file" />
            <span><b>{x.title}</b><small>{x.file}</small></span>
            {!x.empty && <i className="ready" aria-label="has changes" />}
          </button>
        ))}
        <Link to={`/app/p/${p.id}/brief`} className="art-item art-brief"><Icon name="print" /><span><b>Renewal brief</b><small>print or save as PDF</small></span></Link>
      </aside>
      <section className="card art-view">
        <div className="card-head">
          <div><h2>{cur.title}</h2><p className="muted small">{cur.desc}</p></div>
          <div className="row">
            <CopyButton text={cur.text} />
            <button className="btn btn-primary btn-sm" onClick={() => download(cur.file, cur.text, cur.type)}><Icon name="download" /> Download</button>
          </div>
        </div>
        {cur.empty && <p className="note">No lever touches this yet. <Link to={`/app/p/${p.id}/levers`}>Set levers</Link> and it fills in.</p>}
        <pre className="code tall"><code>{cur.text}</code></pre>
      </section>
    </div>
  )
}
