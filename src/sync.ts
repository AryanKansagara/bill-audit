import { useSyncExternalStore } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { allProjects, getProject, meta, putProject, setChangeHook, type Project } from './store.ts'

export const APP_ID = 'bill-audit'
const URL = import.meta.env.VITE_SUPABASE_URL as string | undefined
const KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined
const MAX_BYTES = 3_500_000

export type SyncState = 'signed-out' | 'syncing' | 'synced' | 'offline' | 'error'
interface Status { state: SyncState; email: string | null; message: string; at: string | null; skipped: string[] }

let status: Status = { state: 'signed-out', email: null, message: '', at: null, skipped: [] }
const subs = new Set<() => void>()
function set(p: Partial<Status>) { status = { ...status, ...p }; subs.forEach(f => f()) }
export function useSync(): Status {
  return useSyncExternalStore(f => { subs.add(f); return () => subs.delete(f) }, () => status)
}

let clientP: Promise<SupabaseClient> | null = null
/** Loaded on demand so signed-out visitors never download the client. */
function client(): Promise<SupabaseClient> {
  if (!URL || !KEY) return Promise.reject(new Error('Cloud sync is not configured for this build.'))
  return (clientP ??= import('@supabase/supabase-js').then(m => m.createClient(URL, KEY, { auth: { persistSession: true, autoRefreshToken: true } })))
}

/** A stored session exists if supabase-js left its token in localStorage. */
function hasStoredSession(): boolean {
  try { return Object.keys(localStorage).some(k => k.startsWith('sb-') && k.endsWith('-auth-token')) } catch { return false }
}

export async function initSync(): Promise<void> {
  setChangeHook((p, deletedId) => {
    if (status.state === 'signed-out') return
    if (p) schedulePush(p.id)
    if (deletedId) void removeRemote(deletedId)
  })
  window.addEventListener('online', () => { if (status.email) void syncAll() })
  if (!hasStoredSession()) return
  try {
    const c = await client()
    const { data } = await c.auth.getSession()
    if (data.session) { set({ email: data.session.user.email ?? null }); await syncAll() }
  } catch (e) {
    set({ state: 'offline', message: errMsg(e) })
  }
}

function errMsg(e: unknown): string {
  const m = e instanceof Error ? e.message : typeof e === 'object' && e && 'message' in e ? String((e as { message: unknown }).message) : String(e)
  return /fetch|network|Failed to/i.test(m) ? 'Cloud unreachable. Working locally; changes sync when it is back.' : m
}

function toRow(p: Project) {
  const { id, name, updatedAt, ...rest } = p
  return { id, app: APP_ID, name, updated_at: updatedAt, data: { ...rest, updatedAt } }
}

function fromRow(r: { id: string; name: string; data: any; updated_at: string }): Project {
  return { ...r.data, id: r.id, name: r.name, updatedAt: r.data?.updatedAt ?? r.updated_at }
}

function tooBig(p: Project): boolean {
  return new Blob([JSON.stringify(toRow(p).data)]).size > MAX_BYTES
}

export async function syncAll(): Promise<void> {
  if (!navigator.onLine) { set({ state: 'offline', message: 'Offline. Changes are saved on this device.' }); return }
  set({ state: 'syncing', message: '' })
  try {
    const c = await client()
    const tomb = (await meta.get<string[]>('tombstones')) ?? []
    if (tomb.length) {
      const { error } = await c.from('projects').delete().in('id', tomb)
      if (error) throw error
      await meta.set('tombstones', [])
    }
    const { data, error } = await c.from('projects').select('id,name,data,updated_at').eq('app', APP_ID)
    if (error) throw error
    const remote = new Map((data ?? []).map(r => [r.id as string, fromRow(r as any)]))
    for (const r of remote.values()) {
      const l = getProject(r.id)
      if (!l || r.updatedAt > l.updatedAt) await putProject(r, false)
    }
    const skipped: string[] = []
    const local = allProjects()
    const push = local.filter(p => { const r = remote.get(p.id); return !r || p.updatedAt > r.updatedAt })
    const ok = push.filter(p => { if (tooBig(p)) { skipped.push(p.name); return false } return true })
    if (ok.length) {
      const { error: e2 } = await c.from('projects').upsert(ok.map(toRow))
      if (e2) throw e2
    }
    set({ state: 'synced', at: new Date().toISOString(), skipped, message: skipped.length ? `${skipped.length} project(s) over 3.5 MB stay on this device.` : '' })
  } catch (e) {
    set({ state: navigator.onLine ? 'error' : 'offline', message: errMsg(e) })
  }
}

const timers = new Map<string, number>()
function schedulePush(id: string) {
  clearTimeout(timers.get(id))
  timers.set(id, window.setTimeout(() => void pushOne(id), 1200))
}

async function pushOne(id: string) {
  const p = getProject(id)
  if (!p) return
  if (tooBig(p)) { set({ message: `"${p.name}" is over 3.5 MB and stays on this device.` }); return }
  set({ state: 'syncing' })
  try {
    const c = await client()
    const { error } = await c.from('projects').upsert(toRow(p))
    if (error) throw error
    set({ state: 'synced', at: new Date().toISOString(), message: '' })
  } catch (e) {
    set({ state: navigator.onLine ? 'error' : 'offline', message: errMsg(e) })
  }
}

async function removeRemote(id: string) {
  try {
    const c = await client()
    const { error } = await c.from('projects').delete().eq('id', id)
    if (error) throw error
  } catch {
    const t = (await meta.get<string[]>('tombstones')) ?? []
    await meta.set('tombstones', [...new Set([...t, id])])
  }
}

export async function signUp(email: string, password: string): Promise<void> {
  const c = await client()
  const { data, error } = await c.auth.signUp({ email, password })
  if (error) throw error
  if (!data.session) throw new Error('Account created, but no session was returned. Try signing in.')
  set({ email: data.session.user.email ?? email })
  await syncAll()
}

export async function signIn(email: string, password: string): Promise<void> {
  const c = await client()
  const { data, error } = await c.auth.signInWithPassword({ email, password })
  if (error) throw error
  set({ email: data.user.email ?? email })
  await syncAll()
}

export async function signOut(): Promise<void> {
  const c = await client()
  await c.auth.signOut()
  set({ state: 'signed-out', email: null, message: '', at: null })
}

export async function deleteCloudData(): Promise<void> {
  const c = await client()
  const { error } = await c.from('projects').delete().eq('app', APP_ID)
  if (error) throw error
  set({ state: 'synced', message: 'Cloud copies deleted. Local projects are untouched; they upload again on the next change.' })
}

export async function deleteAccount(): Promise<void> {
  const c = await client()
  const { error } = await c.rpc('delete_my_account')
  if (error) throw error
  await c.auth.signOut()
  set({ state: 'signed-out', email: null, message: 'Account deleted. Local projects are still on this device.', at: null })
}

