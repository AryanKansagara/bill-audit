import { useEffect } from 'react'
import { Footer, Header, Page } from './Shell.tsx'
import { CopyButton, Icon, download } from './ui.tsx'
import { DIMS, PRICES_AS_OF, PRICE_SOURCE } from './engine/prices.ts'
import { EXAMPLES } from './examples.ts'

const TOC = [
  ['start', 'What to export'],
  ['attribution', 'Usage Attribution CSV'],
  ['api', 'Usage and cost API'],
  ['metrics', 'Custom metrics breakdown'],
  ['logs', 'Log volume by index'],
  ['formats', 'File formats'],
  ['model', 'How the bill is modelled'],
  ['pricing', 'Price assumptions'],
  ['privacy', 'Data and privacy'],
]

function Code({ children }: { children: string }) {
  return <div className="code-block"><pre className="code"><code>{children}</code></pre><CopyButton text={children} /></div>
}

const API_ATTR = `# Monthly usage attribution by tag (Pro and Enterprise; Usage Read permission)
curl -sG "https://api.datadoghq.com/api/v1/usage/monthly-attribution" \\
  -H "DD-API-KEY: $DD_API_KEY" -H "DD-APPLICATION-KEY: $DD_APP_KEY" \\
  --data-urlencode "start_month=2026-05-01T00:00:00Z" \\
  --data-urlencode "fields=*" > monthly_attribution.json
# If the response has metadata.pagination.next_record_id, repeat with next_record_id=<value>
# and import each page.`

const API_HOURLY = `# Hourly usage attribution for one product (up to two months per call)
curl -sG "https://api.datadoghq.com/api/v1/usage/hourly-attribution" \\
  -H "DD-API-KEY: $DD_API_KEY" -H "DD-APPLICATION-KEY: $DD_APP_KEY" \\
  --data-urlencode "start_hr=2026-10-01T00" \\
  --data-urlencode "end_hr=2026-11-01T00" \\
  --data-urlencode "usage_type=infra_host_usage" > hourly_infra_hosts.json`

const API_COST = `# Estimated cost for the account (parent org), month to date or a past month
curl -sG "https://api.datadoghq.com/api/v2/usage/estimated_cost" \\
  -H "DD-API-KEY: $DD_API_KEY" -H "DD-APPLICATION-KEY: $DD_APP_KEY" \\
  --data-urlencode "start_month=2026-10" \\
  --data-urlencode "view=summary" > estimated_cost.json`

const API_UNQUERIED = `# Custom metrics nobody queried in the last 30 days (set queries_30d to 0 for these)
curl -sG "https://api.datadoghq.com/api/v2/metrics" \\
  -H "DD-API-KEY: $DD_API_KEY" -H "DD-APPLICATION-KEY: $DD_APP_KEY" \\
  --data-urlencode "filter[configured]=false" \\
  --data-urlencode "filter[queried]=false" \\
  --data-urlencode "window[seconds]=2592000"`

const LOG_QUERY = `sum:datadog.estimated_usage.logs.ingested_events{datadog_is_excluded:false} by {datadog_index}.as_count()
sum:datadog.estimated_usage.logs.ingested_bytes{*} by {datadog_index}.as_count()`

export function Docs() {
  useEffect(() => {
    const id = location.hash.slice(1)
    if (id) requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView())
  }, [])
  return (
    <>
      <Header />
      <Page className="docs">
        <div className="docs-in">
          <aside className="docs-toc">
            <p className="eyebrow">Docs</p>
            <nav aria-label="On this page">{TOC.map(([id, t]) => <a key={id} href={`#${id}`}>{t}</a>)}</nav>
          </aside>
          <article className="prose">
            <h1>Getting your data out of Datadog</h1>
            <p className="lede">Bill Audit works from files you export yourself. You need the Usage Read permission (Datadog Admins have it), and Billing Read for cost data. Nothing here needs an API key in the browser: run the commands on your machine and import the output.</p>

            <h2 id="start">What to export</h2>
            <table className="tbl">
              <thead><tr><th>Input</th><th>Required?</th><th>What it unlocks</th></tr></thead>
              <tbody>
                <tr><td>Usage Attribution, monthly CSV or JSON (one or more months)</td><td>Yes, or the hourly version</td><td>Bill by product and team, trends, forecast, commit sizing</td></tr>
                <tr><td>Hourly Usage Attribution CSV or JSON</td><td>Optional</td><td>Exact 99th-percentile host billing from hourly counts</td></tr>
                <tr><td>Estimated cost JSON</td><td>Optional</td><td>A check of the model against Datadog's own estimate</td></tr>
                <tr><td>Custom metrics with tag cardinality</td><td>Optional</td><td>Cardinality explosions and Metrics without Limits allowlists</td></tr>
                <tr><td>Log volume by index</td><td>Optional</td><td>Index value ranking, exclusion filters, Flex moves, Vector config</td></tr>
              </tbody>
            </table>
            <div className="examples-dl">
              <span>Example files (synthetic):</span>
              {EXAMPLES.map(x => <button key={x.name} className="chip btn-chip" onClick={() => download(x.name, x.build(), x.name.endsWith('.json') ? 'application/json' : 'text/csv')}><Icon name="download" size={12} /> {x.name}</button>)}
            </div>

            <h2 id="attribution">Usage Attribution CSV (in the app)</h2>
            <ol>
              <li>In Datadog, open <b>Plan &amp; Usage</b> and select the <b>Usage Attribution</b> tab.</li>
              <li>If no tags are set, click <b>Edit Tags</b> and choose up to three tag keys. Use <code>team</code> first, then <code>service</code> and <code>env</code>. The first report takes about 24 hours; reports are not backfilled for tags you add later.</li>
              <li>Pick a month in the time selector and click <b>Download as CSV</b>. Repeat for each month you want trends for (six or more makes the forecast tighter).</li>
              <li>Drop the files on <b>Import</b>. Columns ending in <code>_usage</code> map to billing dimensions, <code>_percentage</code> columns are ignored, and the remaining text columns become tags. Byte columns are converted to GB (decimal, as Datadog bills).</li>
            </ol>
            <p>Cells with <code>&lt;empty&gt;</code> mean the resource had the tag with no value; blank cells mean it was not tagged. Both count as unattributed unless a rule under <b>Rates &amp; teams</b> claims them. Pipe-separated values (<code>a | b</code>) are attributed to the first value.</p>

            <h2 id="api">Usage and cost API</h2>
            <p>Usage data lags by up to 72 hours and is kept for 15 months. Use the API host for your site (<code>api.us3.datadoghq.com</code>, <code>api.datadoghq.eu</code> and so on).</p>
            <Code>{API_ATTR}</Code>
            <Code>{API_HOURLY}</Code>
            <p>Hourly files are metered the way Datadog bills: host products take the high-water mark after dropping the top 1% of hours, containers and custom metrics take the monthly average, and volumes are summed. Each tag's share of that billable number follows its share of the hours.</p>
            <Code>{API_COST}</Code>
            <p>The estimated-cost response (<code>data[].attributes.charges[]</code> with <code>product_name</code>, <code>charge_type</code> and <code>cost</code>) is attached to its month and compared with the modelled bill on the Overview. A gap over 10% usually means contract rates or commitments are not set yet.</p>

            <h2 id="metrics">Custom metrics breakdown</h2>
            <ol>
              <li><b>Plan &amp; Usage → Usage → Custom Metrics</b>: the Top Custom Metrics table downloads as CSV with the average and maximum timeseries per hour for each metric name.</li>
              <li>For the biggest metrics, open <b>Metrics → Summary</b>, select the metric, and note the number of values for each tag key in the Tags panel. That is the tag cardinality.</li>
              <li>Add the columns below and import. Optionally mark metrics nobody queries:</li>
            </ol>
            <Code>{API_UNQUERIED}</Code>
            <p>Columns: <code>metric_name</code>, <code>type</code> (count, gauge, rate, distribution), <code>avg_per_hour</code>, <code>tags</code> as <code>key:cardinality</code> pairs separated by spaces, optional <code>team</code> and <code>queries_30d</code>.</p>

            <h2 id="logs">Log volume by index</h2>
            <p>Graph these estimated-usage metrics over the month in a Notebook or the Metrics Explorer, set the time frame to the billing month, and export the table (or read the totals off the Logs tab of <b>Plan &amp; Usage → Usage</b>):</p>
            <Code>{LOG_QUERY}</Code>
            <p>Columns: <code>index</code>, <code>query</code> (the index filter, used in generated configs), <code>team</code>, <code>events_m</code> (millions of indexed events) or <code>events</code>, <code>ingested_gb</code>, <code>retention_days</code>, optional <code>queries_30d</code> (searches, monitors and dashboard queries against the index; Audit Trail log-search events are a good source) and <code>flex</code>.</p>

            <h2 id="formats">File formats the importer detects</h2>
            <table className="tbl">
              <thead><tr><th>Format</th><th>Detected by</th></tr></thead>
              <tbody>
                <tr><td>Monthly Usage Attribution CSV/TSV</td><td>A <code>month</code> column and <code>*_usage</code> columns</td></tr>
                <tr><td>Hourly Usage Attribution CSV/TSV</td><td>An <code>hour</code> column with several timestamps per month; single-product files with <code>total_usage</code> ask which product</td></tr>
                <tr><td>Usage trends CSV (no tags)</td><td>A date column plus product columns</td></tr>
                <tr><td>Monthly or hourly usage attribution JSON</td><td><code>usage[].values</code> or <code>usage[].usage_type</code></td></tr>
                <tr><td>Estimated cost JSON</td><td><code>data[].attributes.charges</code></td></tr>
                <tr><td>Custom metrics / log index CSV</td><td>A metric-name column with a timeseries column / an index column with a volume column</td></tr>
              </tbody>
            </table>
            <p>Every column can be remapped before import. The validation report lists problems by line and column; rows with unreadable dates or numbers are skipped, never guessed.</p>

            <h2 id="model">How the bill is modelled</h2>
            <ul>
              <li><b>Hosts</b> (infrastructure, APM, profiler, DBM): the high-water mark of the lower 99% of hourly counts. Monthly exports already carry this number.</li>
              <li><b>Containers and custom metrics</b>: the monthly average per hour. Allotments (5 or 10 containers, 100 or 200 custom metrics per host on Pro or Enterprise) are pooled across the account.</li>
              <li><b>APM</b>: each APM host includes 150 GB of ingested spans and 1M indexed spans, pooled. The docs' worked example (5 hosts, 30M indexed spans, 900 GB ingested = $212.50) is a unit test.</li>
              <li><b>Logs</b>: ingestion per GB plus indexing per million events at the index's retention. Flex storage is billed on events stored, so a 90-day Flex index holds about three months of volume.</li>
              <li><b>Metrics without Limits</b>: a configured metric pays for ingested timeseries (cheap) plus indexed timeseries (the expensive part). After dropping tags, indexed timeseries are estimated as at most the product of the remaining tags' cardinalities.</li>
              <li><b>Commitments</b>: committed quantity is paid at the committed rate whether used or not; usage beyond allotment and commitment is billed on demand. Unused commitment is shown as waste.</li>
              <li><b>Forecast</b>: monthly growth is the median month-over-month change, so a one-off jump moves the level without compounding. The 80% range widens with the square root of the horizon.</li>
              <li><b>Commit sizing</b>: for each dimension, the commitment is the usage level exceeded with probability equal to committed rate / on-demand rate (the newsvendor rule), using a lognormal around the trend for each month of the renewal year.</li>
            </ul>

            <h2 id="pricing">Price assumptions</h2>
            <p>Public list prices for US sites, captured <b>{PRICES_AS_OF}</b> from <a href={PRICE_SOURCE} target="_blank" rel="noreferrer">datadoghq.com/pricing/list</a> and the billing docs. Your contract almost certainly differs: override rates and commitments per project under <b>Rates &amp; teams</b>.</p>
            <div className="table-wrap">
              <table className="tbl compact">
                <thead><tr><th>Dimension</th><th>Unit</th><th className="r">Annual</th><th className="r">On-demand</th><th>Allotment</th><th>Source</th></tr></thead>
                <tbody>
                  {DIMS.map(d => (
                    <tr key={d.id}>
                      <td>{d.label}{d.note && <small className="block muted">{d.note}</small>}</td>
                      <td>{d.unit}</td>
                      <td className="r num">${d.annual}</td>
                      <td className="r num">${d.onDemand}</td>
                      <td className="small">{d.allotment ? `${d.allotment.pro.toLocaleString()} (Pro) / ${d.allotment.enterprise.toLocaleString()} (Ent) per ${d.allotment.per.replace('_', ' ')}` : '—'}</td>
                      <td><a href={d.source} target="_blank" rel="noreferrer">docs</a></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <h2 id="privacy">Data and privacy</h2>
            <p>Files are parsed in your browser. Projects are stored in this browser's IndexedDB. If you create an account, project settings, column mappings and the parsed monthly snapshots sync to the cloud so you can open them on another device; raw files never leave the device, and projects over 3.5 MB stay local. You can export everything as JSON, delete your cloud data, or delete your account from the account menu at any time.</p>
          </article>
        </div>
      </Page>
      <Footer />
    </>
  )
}
