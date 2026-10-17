import { useEffect, useState } from 'react'
import { api, errMsg, unlockStore } from './api'

/* Ask for a PIN and exchange it for a signed unlock token. Resolves true when unlocked. */
export async function unlockWithPin({ kind, target, ask, toast, title = 'Enter PIN' }) {
  const r = await ask({
    title, sub: 'This is locked. Enter your 4-digit PIN.', password: true, numeric: true, max: 4, ok: 'Unlock',
    validate: async (pin) => {
      if (!/^\d{4}$/.test(pin)) return 'Use exactly 4 digits.'
      try { const { data } = await api.post('/locks/verify/', { kind, target: String(target), pin }); unlockStore.set(kind, target, data.token); return null }
      catch (e) { return errMsg(e) }
    },
  })
  if (!r) return false
  toast?.('Unlocked')
  return true
}

export const when = (iso) => {
  if (!iso) return ''
  const d = new Date(iso)
  const t = new Date()
  return d.toDateString() === t.toDateString() ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : d.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

/* Set a PIN lock (asks twice) or remove it (asks for the current PIN). Resolves to the new locked state, or null if cancelled. */
export async function toggleLock({ kind, target, locked, ask, toast }) {
  if (!locked) {
    const r = await ask({
      title: 'Set a 4-digit PIN', sub: 'Only someone with the PIN can open this. Don’t forget it.', password: true, numeric: true, max: 4, confirm: true, ok: 'Lock',
      validate: async (a, b) => {
        if (!/^\d{4}$/.test(a)) return 'Use exactly 4 digits.'
        if (a !== b) return 'The PINs do not match.'
        try { const { data } = await api.post('/locks/', { kind, target: String(target), pin: a }); unlockStore.set(kind, target, data.token); return null }
        catch (e) { return errMsg(e) }
      },
    })
    if (r) { toast('Locked'); return true }
    return null
  }
  const r = await ask({
    title: 'Remove lock', sub: 'Enter the PIN to remove the lock.', password: true, numeric: true, max: 4, ok: 'Remove lock',
    validate: async (pin) => {
      try { await api.delete('/locks/', { data: { kind, target: String(target), pin } }); unlockStore.clear(kind, target); return null }
      catch (e) { return errMsg(e) }
    },
  })
  if (r) { toast('Lock removed'); return false }
  return null
}

/* Keep the previous object when a refetch returned identical data, so nothing re-renders */
export const keepIfSame = (prev, next) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next)

/* Keep only the first `max` words; add `mark` ("....." unless told otherwise) when something was cut off */
export const clipWords = (text, max, mark = ' .....') => {
  const words = (text || '').trim().split(/\s+/).filter(Boolean)
  return words.length > max ? `${words.slice(0, max).join(' ')}${mark}` : words.join(' ')
}

/* Live "Available / Taken" check for a username (kind "username") or a My Links page name (kind "page").
   `own` is the name you already have, which always counts as free. Returns { ok, taken, msg } (msg is '' while there is nothing to say). */
export function useNameCheck(kind, name, own = '', id = '') {
  const [res, setRes] = useState({ ok: null, msg: '' })
  const v = (name || '').trim().toLowerCase().replace(/^@/, '')
  useEffect(() => {
    if (!v || v === (own || '').toLowerCase()) { setRes({ ok: null, msg: '' }); return }
    let stop = false
    const t = setTimeout(async () => {
      try {
        const { data } = await api.get('/check-name/', { params: { kind, name: v, id: id || undefined } })
        if (!stop) setRes({ ok: data.available, msg: data.detail })
      } catch { if (!stop) setRes({ ok: null, msg: '' }) }
    }, 300)
    return () => { stop = true; clearTimeout(t) }
  }, [kind, v, own, id])
  return { ...res, taken: res.ok === false }
}

/* The link view nobody has chosen yet: the compact list on phones, the larger view on bigger screens */
export const defaultView = () => (typeof window !== 'undefined' && window.matchMedia?.('(max-width: 720px)').matches ? 'list' : 'square')
