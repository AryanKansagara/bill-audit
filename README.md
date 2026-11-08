# Bill Audit

See where your Datadog money goes, by product and team, and generate the changes that cut it.

Built for the platform or SRE lead heading into a renewal: the bill is usage-based across a dozen dimensions, the cost data is hard to get at, and the renewal quote can arrive at close to twice last year's. Bill Audit turns the usage exports you already have into an attributed bill, a forecast to the renewal date, and config you can review and apply.

Live: https://bill-audit.vercel.app

## Features

- **Import** Usage Attribution CSVs (monthly or hourly), usage-attribution JSON (monthly or hourly) and estimated-cost JSON from the API, plus optional custom-metric and log-index breakdowns. Format detection, editable column mapping, and a validation report with line numbers.
- **Cost model** usage × rate with commitments vs on-demand, 99th-percentile high-water-mark host billing, pooled allotments (custom metrics, containers, ingested and indexed spans, profiled containers), Flex storage. List prices are dated with sources and can be overridden with contract rates and commit levels.
- **Attribution** by team tag plus glob rules, with unattributed spend called out and traced to its tags.
- **Drivers** biggest and fastest-growing lines, cardinality explosions by tag, log indexes priced against how often they are queried, APM ingestion and indexing against allotments.
- **Forecast** to the renewal year with an 80% range; median month-over-month growth so one-off jumps are not compounded.
- **Levers** with live savings: exclusion filters, pre-ingest drops, retention, Flex, Metrics without Limits allowlists, APM sampling, and newsvendor commit sizing.
- **Artifacts** `datadog_logs_index` and `datadog_metric_tag_configuration` Terraform, the matching API payloads, a Vector pipeline, a chargeback CSV, and a printable renewal brief.
- **Workspace** multiple projects in IndexedDB, monthly snapshots, month-to-month compare, planned vs realized savings. Optional email sign-in syncs projects across devices.

Everything runs in the browser. No Datadog keys, no uploads.

## Run locally

```sh
npm install
npm run dev     # http://localhost:5173
npm test        # engine tests
npm run build
```

Cloud sync reads `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` from `.env` (public values; data is protected by row-level security). Without them the app runs in local mode.

Built by Aryan Kansagara. Independent project, not affiliated with Datadog.
