import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { api, tokens, errMsg } from './api'
import { keepIfSame } from './lib'

const Ctx = createContext(null)
export const useApp = () => useContext(Ctx)

/* Top-bar configuration: pages call useTopBar({ back, center, right }) */
export function useTopBar(cfg, deps = []) {
  const { setTop } = useApp()
  useEffect(() => { setTop(cfg || {}); return () => setTop({}) }, deps) // eslint-disable-line
}

/* The last known profile is kept on this device so the app can draw straight away while it is re-checked in the background. */
const USER_KEY = 'opio.user'
const cachedUser = () => { try { return tokens.get() ? JSON.parse(localStorage.getItem(USER_KEY) || 'null') : null } catch { return null } }

/* Data already fetched is shown instantly on the next visit and refreshed quietly behind it. */
const cache = new Map()
export const clearFetchCache = () => cache.clear()
export async function prefetch(path) { try { const r = await api.get(path); cache.set(path, r.data) } catch { /* the page will fetch it itself */ } }

export function AppProvider({ children }) {
  const [user, setUser] = useState(cachedUser)
  const [ready, setReady] = useState(() => !tokens.get() || !!cachedUser())
  const [top, setTop] = useState({})
  const [toastMsg, setToastMsg] = useState('')
  const [dialog, setDialog] = useState(null)      // confirm / ask dialogs
  const [viewer, setViewer] = useState(null)      // link shown in the OPIOW viewer
  const [drawer, setDrawer] = useState(false)
  const [settings, setSettings] = useState(false) // false | 'interests' | 'blocked'
  const [editProfile, setEditProfile] = useState(false)
  const [photoEdit, setPhotoEdit] = useState(false)
  const [tick, setTick] = useState(0)             // bump to refresh badges / lists
  const [counts, setCounts] = useState({ messages: 0, requests: 0 }) // Inbox badge numbers
  const tt = useRef()

  const loadCounts = useCallback(async () => {
    try { const { data } = await api.get('/inbox/counts/'); setCounts(data) } catch { /* ignore */ }
  }, [])
  useEffect(() => {
    if (!user) return
    loadCounts()
    const t = setInterval(() => { if (!document.hidden) loadCounts() }, 10000)
    return () => clearInterval(t)
  }, [user?.id, tick, loadCounts]) // eslint-disable-line

  const toast = useCallback((m) => {
    try { navigator.vibrate?.(10) } catch { /* not supported */ }
    setToastMsg(m); clearTimeout(tt.current); tt.current = setTimeout(() => setToastMsg(''), 2600)
  }, [])

  const loadMe = useCallback(async () => {
    try { const { data } = await api.get('/me/'); setUser(data) } catch { setUser(null) }
  }, [])

  useEffect(() => {
    (async () => { if (tokens.get()) await loadMe(); setReady(true) })()
    const out = () => { clearFetchCache(); setUser(null) }
    window.addEventListener('opio:logout', out)
    return () => window.removeEventListener('opio:logout', out)
  }, [loadMe])

  useEffect(() => { try { if (user) localStorage.setItem(USER_KEY, JSON.stringify(user)); else localStorage.removeItem(USER_KEY) } catch { /* private mode */ } }, [user])
  const login = (data) => { clearFetchCache(); tokens.set({ access: data.access, refresh: data.refresh }); setUser(data.user) }
  const logout = () => { clearFetchCache(); tokens.clear(); setUser(null); setDrawer(false) }
  const patchMe = async (patch) => {
    try { const { data } = await api.patch('/me/', patch); setUser(data); return data }
    catch (e) { toast(errMsg(e)); throw e }
  }

  // promise-based confirm & input dialogs
  const confirm = useCallback((o) => new Promise((res) => setDialog({ type: 'confirm', ...o, res })), [])
  const ask = useCallback((o) => new Promise((res) => setDialog({ type: 'ask', ...o, res })), [])

  const value = useMemo(() => ({
    user, ready, setUser, login, logout, patchMe, loadMe, top, setTop, toast, toastMsg, confirm, ask, dialog, setDialog,
    viewer, setViewer, drawer, setDrawer, settings, setSettings, editProfile, setEditProfile, photoEdit, setPhotoEdit,
    tick, refresh: () => setTick((t) => t + 1), counts, loadCounts,
  }), [user, ready, top, toastMsg, dialog, viewer, drawer, settings, editProfile, photoEdit, tick, counts]) // eslint-disable-line

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

/* fetch helper hook with reload. Shows what it already has at once (loading is only true the very first time). */
export function useFetch(path, deps = [], opts = {}) {
  const [data, setData] = useState(() => (path && cache.has(path) ? cache.get(path) : opts.initial ?? null))
  const [loading, setLoading] = useState(() => !!path && !cache.has(path))
  const [error, setError] = useState(null)
  const load = useCallback(async () => {
    if (!path) return   // a null path means "don't fetch"
    // keep the old object when nothing changed, so polled refreshes don't re-render the page
    try { const r = await api.get(path, opts.config); cache.set(path, r.data); setData((prev) => keepIfSame(prev, r.data)); setError(null) }
    catch (e) { setError(e) }
    finally { setLoading(false) }
  }, [path]) // eslint-disable-line
  useEffect(() => {
    if (!path) { setData(opts.initial ?? null); setLoading(false); return }
    if (cache.has(path)) { setData((prev) => keepIfSame(prev, cache.get(path))); setLoading(false) }
    else { setData(opts.initial ?? null); setLoading(true) }
    load()
  }, [load, ...deps]) // eslint-disable-line
  // opts.poll = ms: refresh in the background while the tab is visible, and right away when you come back to it
  const poll = opts.poll
  useEffect(() => {
    if (!poll) return
    const tick = () => { if (!document.hidden) load() }
    const t = setInterval(tick, poll)
    document.addEventListener('visibilitychange', tick)
    window.addEventListener('focus', tick)
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', tick); window.removeEventListener('focus', tick) }
  }, [load, poll])
  return { data, setData, loading, error, reload: load }
}
