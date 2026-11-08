import { useSyncExternalStore } from 'react'
import { defaultSettings, noLevers, type Levers, type Settings, type Snapshot } from './engine/model.ts'
import { SAMPLE_NAME, sampleSettings, sampleSnapshots } from './engine/sample.ts'

export interface Project {
  id: string
  name: string
  createdAt: string
  updatedAt: string
  settings: Settings
  snapshots: Snapshot[]
  levers: Levers
  sample?: boolean
}

// ---------- IndexedDB (two object stores, promise wrapper) ----------

const DB = 'bill-audit'
let dbp: Promise<IDBDatabase> | null = null
function db(): Promise<IDBDatabase> {
  return (dbp ??= new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1)
    r.onupgradeneeded = () => {
      r.result.createObjectStore('projects', { keyPath: 'id' })
      r.result.createObjectStore('meta')
    }
    r.onsuccess = () => res(r.result)
    r.onerror = () => rej(r.error)
  }))
}
async function tx<T>(store: 'projects' | 'meta', mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const d = await db()
  return new Promise((res, rej) => {
    const t = d.transaction(store, mode)
    const req = fn(t.objectStore(store))
    t.oncomplete = () => res(req.result)
    t.onerror = () => rej(t.error)
  })
}
export const meta = {
  get: <T,>(k: string) => tx<T>('meta', 'readonly', s => s.get(k) as IDBRequest<T>),
  set: (k: string, v: unknown) => tx('meta', 'readwrite', s => s.put(v, k)),
}

// ---------- in-memory store ----------

let projects: Project[] = []
let loaded = false
const subs = new Set<() => void>()
const emit = () => { projects = [...projects]; subs.forEach(f => f()) }
let onChange: (p: Project | null, deletedId?: string) => void = () => {}
export function setChangeHook(f: typeof onChange) { onChange = f }

export async function loadProjects(): Promise<void> {
  try {
    projects = (await tx<Project[]>('projects', 'readonly', s => s.getAll() as IDBRequest<Project[]>)).map(migrate)
  } catch {
    projects = []
  }
  loaded = true
  emit()
}

function migrate(p: Project): Project {
  return { ...p, settings: { ...defaultSettings(), ...p.settings }, levers: { ...noLevers(), ...p.levers }, snapshots: p.snapshots ?? [] }
}

export function useProjects(): { projects: Project[]; loaded: boolean } {
  const list = useSyncExternalStore(f => { subs.add(f); return () => subs.delete(f) }, () => projects)
  return { projects: list, loaded }
}

export function allProjects(): Project[] {
  return projects
}

export function getProject(id: string): Project | undefined {
  return projects.find(p => p.id === id)
}

export const uid = () => crypto.randomUUID()

/** Persists a project. `touch` = false keeps updatedAt (used when applying cloud copies). */
export async function putProject(p: Project, touch = true): Promise<Project> {
  const next = touch ? { ...p, updatedAt: new Date().toISOString() } : p
  const i = projects.findIndex(x => x.id === p.id)
  if (i >= 0) projects[i] = next
  else projects.push(next)
  emit()
  await tx('projects', 'readwrite', s => s.put(next))
  if (touch) onChange(next)
  return next
}

export async function updateProject(id: string, fn: (p: Project) => Project): Promise<void> {
  const p = getProject(id)
  if (p) await putProject(fn(p))
}

/** Removes a project and returns an undo function that restores it exactly. */
export async function deleteProject(id: string): Promise<() => Promise<void>> {
  const p = getProject(id)
  projects = projects.filter(x => x.id !== id)
  emit()
  await tx('projects', 'readwrite', s => s.delete(id))
  onChange(null, id)
  return async () => { if (p) await putProject(p) }
}

export async function clearLocal(): Promise<void> {
  projects = []
  emit()
  await tx('projects', 'readwrite', s => s.clear())
}

export function newProject(name: string): Project {
  const now = new Date().toISOString()
  return { id: uid(), name, createdAt: now, updatedAt: now, settings: defaultSettings(), snapshots: [], levers: noLevers() }
}

export function sampleProject(): Project {
  const p = newProject(SAMPLE_NAME)
  // A starting plan so every tab has something to show; the visitor can reset it.
  const levers: Levers = {
    ...noLevers(),
    logIdx: { debug: { exclude: 0.9, preDrop: 0.5, flex: false, flexDays: 90 }, audit: { exclude: 0, preDrop: 0, flex: true, flexDays: 365 } },
    metricDrop: { 'checkout.cart.latency': ['cart_id'] },
    apmIngestKeep: 0.72,
  }
  return { ...p, sample: true, settings: sampleSettings(), snapshots: sampleSnapshots(), levers }
}

export function latest(p: Project): Snapshot | undefined {
  return [...p.snapshots].sort((a, b) => a.month.localeCompare(b.month)).at(-1)
}

export function sortedSnapshots(p: Project): Snapshot[] {
  return [...p.snapshots].sort((a, b) => a.month.localeCompare(b.month))
}
