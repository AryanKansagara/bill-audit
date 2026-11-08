import { useEffect, useState, useSyncExternalStore, type ReactNode, type MouseEvent } from 'react'

// ---------- router ----------

const routeSubs = new Set<() => void>()
window.addEventListener('popstate', () => routeSubs.forEach(f => f()))
export function navigate(to: string, replace = false) {
  if (to === location.pathname + location.search) return
  history[replace ? 'replaceState' : 'pushState'](null, '', to)
  routeSubs.forEach(f => f())
  if (!to.includes('#')) window.scrollTo(0, 0)
}
export function usePath(): string {
  return useSyncExternalStore(f => { routeSubs.add(f); return () => routeSubs.delete(f) }, () => location.pathname)
}

export function Link({ to, children, className, onClick, ...rest }: { to: string; children: ReactNode; className?: string; onClick?: () => void; 'aria-current'?: 'page' | undefined; title?: string }) {
  const go = (e: MouseEvent) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
    e.preventDefault()
    onClick?.()
    navigate(to)
  }
  return <a href={to} className={className} onClick={go} {...rest}>{children}</a>
}

// ---------- theme ----------

export type Mode = 'light' | 'dark'
const modeSubs = new Set<() => void>()
export function useMode(): Mode {
  return useSyncExternalStore(f => { modeSubs.add(f); return () => modeSubs.delete(f) }, () => (document.documentElement.dataset.themeMode as Mode) || 'light')
}
export function setMode(m: Mode) {
  document.documentElement.dataset.themeMode = m
  localStorage.setItem('themeMode', m)
  modeSubs.forEach(f => f())
}
export function ThemeToggle() {
  const mode = useMode()
  const next = mode === 'dark' ? 'light' : 'dark'
  return (
    <button className="icon-btn" onClick={() => setMode(next)} aria-label={`Switch to ${next} mode`} title={`Switch to ${next} mode (T)`}>
      {mode === 'dark' ? <Icon name="sun" /> : <Icon name="moon" />}
    </button>
  )
}

// ---------- toasts ----------

export interface Toast { id: number; text: string; kind?: 'ok' | 'error'; action?: { label: string; run: () => void } }
let toasts: Toast[] = []
const toastSubs = new Set<() => void>()
let tid = 0
export function toast(text: string, opts: Omit<Toast, 'id' | 'text'> = {}) {
  const t = { id: ++tid, text, ...opts }
  toasts = [...toasts, t]
  toastSubs.forEach(f => f())
  setTimeout(() => dismiss(t.id), opts.action ? 8000 : 4000)
}
function dismiss(id: number) {
  toasts = toasts.filter(t => t.id !== id)
  toastSubs.forEach(f => f())
}
export function Toasts() {
  const list = useSyncExternalStore(f => { toastSubs.add(f); return () => toastSubs.delete(f) }, () => toasts)
  return (
    <div className="toasts" role="status" aria-live="polite">
      {list.map(t => (
        <div key={t.id} className={`toast ${t.kind ?? ''}`}>
          <span>{t.text}</span>
          {t.action && <button className="toast-action" onClick={() => { t.action!.run(); dismiss(t.id) }}>{t.action.label}</button>}
          <button className="toast-x" aria-label="Dismiss" onClick={() => dismiss(t.id)}>×</button>
        </div>
      ))}
    </div>
  )
}

// ---------- format ----------

export const usd = (n: number, digits = 0) => (n < 0 ? '−' : '') + '$' + Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: digits })
export function usdShort(n: number): string {
  const a = Math.abs(n), s = n < 0 ? '−' : ''
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(a >= 1e7 ? 1 : 2)}M`
  if (a >= 1e4) return `${s}$${(a / 1e3).toFixed(0)}k`
  if (a >= 1e3) return `${s}$${(a / 1e3).toFixed(1)}k`
  return `${s}$${a.toFixed(0)}`
}
export function qty(n: number): string {
  const a = Math.abs(n)
  if (a >= 1e9) return (n / 1e9).toFixed(a >= 1e10 ? 1 : 2) + 'B'
  if (a >= 1e6) return (n / 1e6).toFixed(a >= 1e7 ? 1 : 2) + 'M'
  if (a >= 1e4) return (n / 1e3).toFixed(0) + 'k'
  if (a >= 1e3) return (n / 1e3).toFixed(1) + 'k'
  return n.toFixed(a < 10 && a % 1 ? 1 : 0)
}
export const pctFmt = (x: number, d = 0) => `${(x * 100).toFixed(d)}%`
export function monthName(m: string, long = false): string {
  const [y, mo] = m.split('-').map(Number)
  return new Date(Date.UTC(y, mo - 1, 1)).toLocaleDateString('en-US', { month: long ? 'long' : 'short', year: 'numeric', timeZone: 'UTC' })
}

// ---------- files ----------

export function download(name: string, text: string, type = 'text/plain') {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false)
  return (
    <button className="btn btn-ghost btn-sm" onClick={async () => {
      try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500) } catch { toast('Copy failed: select the text and copy manually.', { kind: 'error' }) }
    }}>
      <Icon name={done ? 'check' : 'copy'} /> {done ? 'Copied' : label}
    </button>
  )
}

// ---------- small pieces ----------

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', k)
    const prev = document.activeElement as HTMLElement | null
    return () => { window.removeEventListener('keydown', k); prev?.focus?.() }
  }, [onClose])
  return (
    <div className="modal-bg" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" aria-label="Close" onClick={onClose} autoFocus><Icon name="x" /></button>
        </div>
        {children}
      </div>
    </div>
  )
}

const PATHS: Record<string, string> = {
  sun: 'M12 4V2m0 20v-2m8-8h2M2 12h2m13.66-5.66 1.41-1.41M4.93 19.07l1.41-1.41m0-11.32L4.93 4.93m14.14 14.14-1.41-1.41M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10z',
  moon: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z',
  copy: 'M9 9h10v10H9zM5 15V5h10',
  check: 'M5 12l5 5L20 7',
  x: 'M6 6l12 12M18 6 6 18',
  download: 'M12 3v12m0 0-5-5m5 5 5-5M4 21h16',
  upload: 'M12 21V9m0 0-5 5m5-5 5 5M4 3h16',
  plus: 'M12 5v14M5 12h14',
  trash: 'M4 7h16M10 11v6m4-6v6M6 7l1 13h10l1-13M9 7V4h6v3',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm-8 9a8 8 0 0 1 16 0',
  cloud: 'M7 18h10a4 4 0 0 0 .5-7.97A6 6 0 0 0 6 9.5 4.5 4.5 0 0 0 7 18z',
  alert: 'M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
  arrow: 'M5 12h14m-6-6 6 6-6 6',
  file: 'M14 3H6v18h12V7zM14 3v4h4',
  print: 'M6 9V3h12v6M6 18H4v-7h16v7h-2M8 14h8v7H8z',
  sliders: 'M4 6h10m4 0h2M4 12h4m4 0h8M4 18h12m4 0h0M14 4v4M8 10v4M16 16v4',
  menu: 'M4 6h16M4 12h16M4 18h16',
  flame: 'M12 22a7 7 0 0 0 7-7c0-4-3-6-4-9-1 2-2 3-4 3 0-2-1-4-2-6-1 4-4 7-4 12a7 7 0 0 0 7 7z',
  trend: 'M3 17l6-6 4 4 8-8m0 0h-6m6 0v6',
  logs: 'M4 5h16M4 10h16M4 15h10M4 20h7',
  metric: 'M4 20V10m6 10V4m6 16v-7m6 7v-11',
  trace: 'M4 6h8m-4 6h10m-6 6h8',
  lock: 'M6 11h12v10H6zM8 11V7a4 4 0 0 1 8 0v4',
  keyboard: 'M3 7h18v10H3zM7 11h.01M11 11h.01M15 11h.01M8 14h8',
}
export function Icon({ name, size = 16 }: { name: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="ico">
      <path d={PATHS[name]} />
    </svg>
  )
}

export function Monogram({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" className="mono">
      <rect width="32" height="32" rx="6" fill="var(--purple)" />
      <text x="16" y="21.5" textAnchor="middle" fontFamily="Noto Sans, sans-serif" fontWeight="800" fontSize="14" fill="#fff">BA</text>
    </svg>
  )
}

export function useMedia(q: string): boolean {
  const [m, setM] = useState(() => matchMedia(q).matches)
  useEffect(() => {
    const mq = matchMedia(q)
    const f = () => setM(mq.matches)
    mq.addEventListener('change', f)
    return () => mq.removeEventListener('change', f)
  }, [q])
  return m
}

/** Animates a number toward its target; jumps straight there with reduced motion. */
export function useTween(target: number, ms = 600): number {
  const [v, setV] = useState(target)
  const reduce = useMedia('(prefers-reduced-motion: reduce)')
  useEffect(() => {
    if (reduce) { setV(target); return }
    let raf = 0
    const from = v, t0 = performance.now()
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / ms)
      const e = 1 - Math.pow(1 - k, 3)
      setV(from + (target - from) * e)
      if (k < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, reduce])
  return v
}
