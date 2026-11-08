import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { monthName, qty, usd, usdShort } from './ui.tsx'
import { monthLabel } from './engine/model.ts'

/** Stable color per team: assigned alphabetically across the project, never by rank. */
export function teamColors(teams: string[]): Map<string, string> {
  const sorted = [...new Set(teams)].sort()
  return new Map(sorted.map((t, i) => [t, i < 8 ? `var(--series-${i + 1})` : 'var(--series-other)']))
}

// ---------- waterfall ----------

export interface WStep { key: string; label: string; value: number; hint?: string }

export function Waterfall({ start, startLabel, steps, endLabel, height = 260, compact }: { start: number; startLabel: string; steps: WStep[]; endLabel: string; height?: number; compact?: boolean }) {
  const end = start - steps.reduce((a, s) => a + s.value, 0)
  const max = Math.max(start, end, 1) * 1.08
  const [hover, setHover] = useState<string | null>(null)
  let running = start
  const cols: { key: string; label: string; bottom: number; top: number; kind: 'total' | 'save' | 'add' | 'end'; value: number; hint?: string }[] = [
    { key: 'start', label: startLabel, bottom: 0, top: start, kind: 'total', value: start },
  ]
  for (const s of steps) {
    const next = running - s.value
    cols.push({ key: s.key, label: s.label, bottom: Math.min(running, next), top: Math.max(running, next), kind: s.value >= 0 ? 'save' : 'add', value: s.value, hint: s.hint })
    running = next
  }
  cols.push({ key: 'end', label: endLabel, bottom: 0, top: end, kind: 'end', value: end })
  return (
    <div className={`wf ${compact ? 'compact' : ''}`} style={{ height }} role="img" aria-label={`${startLabel} ${usd(start)}, ${steps.length} changes, ${endLabel} ${usd(end)}`}>
      <div className="wf-grid" aria-hidden="true">
        {[0.25, 0.5, 0.75, 1].map(g => <span key={g} style={{ bottom: `${g * 100 / 1.08}%` }}><em>{usdShort(max / 1.08 * g)}</em></span>)}
      </div>
      <div className="wf-cols">
        {cols.map((c, i) => (
          <div key={c.key} className={`wf-col ${c.kind} ${hover === c.key ? 'hover' : ''}`} onMouseEnter={() => setHover(c.key)} onMouseLeave={() => setHover(null)}>
            <div className="wf-track">
              {i > 0 && <span className="wf-link" style={{ bottom: `${(c.kind === 'end' ? c.top : c.kind === 'save' ? c.top : c.bottom) / max * 100}%` }} />}
              <div className="wf-bar" style={{ bottom: `${c.bottom / max * 100}%`, height: `${Math.max(0.4, (c.top - c.bottom) / max * 100)}%` }}>
                <span className="wf-val">{c.kind === 'save' ? '−' + usdShort(c.value) : c.kind === 'add' ? '+' + usdShort(-c.value) : usdShort(c.value)}</span>
              </div>
            </div>
            <div className="wf-label" title={c.label}>{c.label}</div>
            {hover === c.key && c.hint && <div className="tip wf-tip">{c.hint}</div>}
          </div>
        ))}
      </div>
    </div>
  )
}

// ---------- horizontal bars ----------

export interface HBar { key: string; label: ReactNode; value: number; segments?: { value: number; cls: string; title: string }[]; color?: string; sub?: ReactNode; aside?: ReactNode }

export function HBars({ rows, max, format = usd }: { rows: HBar[]; max?: number; format?: (n: number) => string }) {
  const m = max ?? Math.max(1, ...rows.map(r => r.value))
  return (
    <ul className="hbars">
      {rows.map(r => (
        <li key={r.key}>
          <div className="hb-head">
            <span className="hb-label">{r.color && <i className="swatch" style={{ background: r.color }} />}{r.label}</span>
            <span className="hb-val num">{format(r.value)}{r.aside}</span>
          </div>
          <div className="hb-track">
            {(r.segments ?? [{ value: r.value, cls: '', title: format(r.value) }]).map((s, i) => (
              <span key={i} className={`hb-seg ${s.cls}`} title={s.title} style={{ width: `${Math.max(0, s.value) / m * 100}%`, background: r.color && !s.cls ? r.color : undefined }} />
            ))}
          </div>
          {r.sub && <div className="hb-sub">{r.sub}</div>}
        </li>
      ))}
    </ul>
  )
}

// ---------- trend + forecast ----------

export interface TrendPoint { idx: number; value: number }
export interface Band { idx: number; mid: number; low: number; high: number }

export function TrendChart({ actual, forecast, plan, renewalIdx, height = 240 }: { actual: TrendPoint[]; forecast: Band[]; plan?: Band[]; renewalIdx: number; height?: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const [hi, setHi] = useState<number | null>(null)
  const [W, setW] = useState(720)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, Math.round(e.contentRect.width))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const H = height, P = { l: 52, r: 12, t: 14, b: 26 }
  const all = [...actual.map(a => a.idx), ...forecast.map(f => f.idx)]
  const x0 = Math.min(...all), x1 = Math.max(...all)
  const ymax = Math.max(1, ...actual.map(a => a.value), ...forecast.map(f => f.high)) * 1.05
  const x = (i: number) => P.l + (x1 === x0 ? 0.5 : (i - x0) / (x1 - x0)) * (W - P.l - P.r)
  const y = (v: number) => P.t + (1 - v / ymax) * (H - P.t - P.b)
  const lastA = actual[actual.length - 1]
  const fc = lastA ? [{ idx: lastA.idx, mid: lastA.value, low: lastA.value, high: lastA.value }, ...forecast] : forecast
  const pl = plan && lastA ? [{ idx: lastA.idx, mid: lastA.value, low: lastA.value, high: lastA.value }, ...plan] : plan
  const line = (pts: { idx: number; v: number }[]) => pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.idx).toFixed(1)},${y(p.v).toFixed(1)}`).join('')
  const band = `${line(fc.map(f => ({ idx: f.idx, v: f.high })))}L${fc.slice().reverse().map(f => `${x(f.idx).toFixed(1)},${y(f.low).toFixed(1)}`).join('L')}Z`
  const ticks = useMemo(() => [0.25, 0.5, 0.75, 1].map(g => ymax / 1.05 * g), [ymax])
  const step = Math.max(1, Math.ceil((x1 - x0) / Math.max(2, Math.floor(W / 110))))
  const onMove = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect()
    const px = (e.clientX - r.left) / r.width * W
    const i = Math.round(x0 + (px - P.l) / (W - P.l - P.r) * (x1 - x0))
    setHi(Math.max(x0, Math.min(x1, i)))
  }
  const hA = actual.find(a => a.idx === hi), hF = forecast.find(f => f.idx === hi), hP = plan?.find(f => f.idx === hi)
  return (
    <div className="trend" ref={ref} onPointerMove={onMove} onPointerLeave={() => setHi(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Monthly bill, actual and forecast to the end of the renewal year">
        {ticks.map(t => <g key={t}><line x1={P.l} x2={W - P.r} y1={y(t)} y2={y(t)} className="grid" /><text x={P.l - 8} y={y(t) + 4} className="axis" textAnchor="end">{usdShort(t)}</text></g>)}
        <line x1={P.l} x2={W - P.r} y1={y(0)} y2={y(0)} className="base" />
        {renewalIdx >= x0 && renewalIdx <= x1 && <g><rect x={x(renewalIdx)} y={P.t} width={W - P.r - x(renewalIdx)} height={H - P.t - P.b} className="renewal-zone" /><text x={x(renewalIdx) + 6} y={P.t + 12} className="axis strong">Renewal year</text></g>}
        <path d={band} className="band" />
        <path d={line(fc.map(f => ({ idx: f.idx, v: f.mid })))} className="fc-line" />
        {pl && <path d={line(pl.map(f => ({ idx: f.idx, v: f.mid })))} className="plan-line" />}
        <path d={line(actual.map(a => ({ idx: a.idx, v: a.value })))} className="act-line" />
        {actual.map(a => <circle key={a.idx} cx={x(a.idx)} cy={y(a.value)} r={4} className="act-dot" />)}
        {Array.from({ length: x1 - x0 + 1 }, (_, k) => x0 + k).filter(i => (i - x0) % step === 0).map(i => <text key={i} x={x(i)} y={H - 6} textAnchor="middle" className="axis">{monthName(monthLabel(i)).replace(' 20', " '")}</text>)}
        {hi !== null && <line x1={x(hi)} x2={x(hi)} y1={P.t} y2={H - P.b} className="cross" />}
      </svg>
      {hi !== null && (hA || hF) && (
        <div className="tip trend-tip" style={{ left: `${x(hi) / W * 100}%` }}>
          <b>{monthName(monthLabel(hi), true)}</b>
          {hA && <div><i className="key act" /> Actual <span className="num">{usd(hA.value)}</span></div>}
          {hF && <div><i className="key fc" /> Forecast <span className="num">{usd(hF.mid)}</span></div>}
          {hF && <div className="muted">80% range {usdShort(hF.low)} to {usdShort(hF.high)}</div>}
          {hP && <div><i className="key plan" /> With plan <span className="num">{usd(hP.mid)}</span></div>}
        </div>
      )}
      <div className="legend">
        <span><i className="key act" /> Actual</span>
        <span><i className="key fc" /> Forecast (80% range shaded)</span>
        {plan && <span><i className="key plan" /> With savings plan</span>}
      </div>
    </div>
  )
}

// ---------- stacked months by team ----------

export function StackedMonths({ months, colors }: { months: { month: string; parts: { key: string; value: number }[] }[]; colors: Map<string, string> }) {
  const [hi, setHi] = useState<string | null>(null)
  const max = Math.max(1, ...months.map(m => m.parts.reduce((a, p) => a + p.value, 0)))
  const keys = [...new Set(months.flatMap(m => m.parts.map(p => p.key)))]
  return (
    <div className="stacked">
      <div className="st-cols">
        {months.map(m => {
          const total = m.parts.reduce((a, p) => a + p.value, 0)
          return (
            <div key={m.month} className="st-col" onMouseEnter={() => setHi(m.month)} onMouseLeave={() => setHi(null)}>
              <div className="st-track">
                <div className="st-bar" style={{ height: `${total / max * 100}%` }}>
                  {m.parts.map(p => <span key={p.key} style={{ flexGrow: p.value, background: colors.get(p.key) ?? 'var(--series-other)' }} />)}
                </div>
              </div>
              <div className="st-label">{monthName(m.month).split(' ')[0]}</div>
              {hi === m.month && (
                <div className="tip st-tip">
                  <b>{monthName(m.month, true)} · {usd(total)}</b>
                  {[...m.parts].sort((a, b) => b.value - a.value).map(p => <div key={p.key}><i className="swatch" style={{ background: colors.get(p.key) ?? 'var(--series-other)' }} /> {p.key} <span className="num">{usd(p.value)}</span></div>)}
                </div>
              )}
            </div>
          )
        })}
      </div>
      <div className="legend">
        {keys.map(k => <span key={k}><i className="swatch" style={{ background: colors.get(k) ?? 'var(--series-other)' }} /> {k}</span>)}
      </div>
    </div>
  )
}

export function Meter({ value, max, label }: { value: number; max: number; label: string }) {
  const p = Math.min(1, value / Math.max(1, max))
  return (
    <div className="meter" role="meter" aria-valuenow={value} aria-valuemax={max} aria-label={label}>
      <span style={{ width: `${p * 100}%` }} />
      {value > max && <em style={{ left: `${max / value * 100}%` }} />}
      <small>{qty(value)} / {qty(max)}</small>
    </div>
  )
}
