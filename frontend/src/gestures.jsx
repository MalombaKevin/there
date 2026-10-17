import { useEffect, useRef, useState } from 'react'

/* Little touches: a light vibration on phones, a confetti burst, pull-to-refresh and swipe-between-tabs. */
export const haptic = (ms = 12) => { try { navigator.vibrate?.(ms) } catch { /* not supported */ } }

export function burst() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return
  const colors = ['#e2542b', '#1f6feb', '#f4b400', '#0a9396', '#9d7dff']
  const wrap = document.createElement('div')
  wrap.className = 'confetti'
  for (let i = 0; i < 28; i++) {
    const s = document.createElement('span')
    s.style.setProperty('--x', `${(Math.random() - 0.5) * 320}px`)
    s.style.setProperty('--y', `${-120 - Math.random() * 220}px`)
    s.style.setProperty('--r', `${Math.random() * 720 - 360}deg`)
    s.style.background = colors[i % colors.length]
    s.style.animationDelay = `${Math.random() * 0.12}s`
    wrap.appendChild(s)
  }
  document.body.appendChild(wrap)
  setTimeout(() => wrap.remove(), 1400)
}

/* Drag down at the top of the page (touch screens) to reload. Returns what the spinner needs. */
export function usePullToRefresh(onRefresh) {
  const [pull, setPull] = useState(0)
  const [busy, setBusy] = useState(false)
  const cb = useRef(onRefresh)
  cb.current = onRefresh
  useEffect(() => {
    if (!matchMedia('(pointer: coarse)').matches) return
    let y0 = null
    let dist = 0
    const start = (e) => { y0 = window.scrollY <= 0 && !document.querySelector('.modal.on') && e.touches.length === 1 ? e.touches[0].clientY : null; dist = 0 }
    const move = (e) => {
      if (y0 == null) return
      const d = e.touches[0].clientY - y0
      if (d > 0 && window.scrollY <= 0) { dist = Math.min(d * 0.5, 90); setPull(dist) } else { dist = 0; setPull(0) }
    }
    const end = async () => {
      if (y0 == null) return
      y0 = null
      if (dist >= 60) { setBusy(true); setPull(48); haptic(15); try { await cb.current() } catch { /* ignore */ } setBusy(false) }
      setPull(0); dist = 0
    }
    addEventListener('touchstart', start, { passive: true })
    addEventListener('touchmove', move, { passive: true })
    addEventListener('touchend', end)
    return () => { removeEventListener('touchstart', start); removeEventListener('touchmove', move); removeEventListener('touchend', end) }
  }, [])
  return { pull, busy }
}

export function PullIndicator({ pull, busy }) {
  if (!pull && !busy) return null
  return (
    <div className="ptr" style={{ transform: `translate(-50%, ${pull}px)`, opacity: Math.min(1, pull / 50) }} aria-hidden="true">
      <span className={busy ? 'spin' : ''} style={{ transform: busy ? undefined : `rotate(${pull * 4}deg)` }}>↻</span>
    </div>
  )
}

/* Swipe left / right on empty parts of the page (not on cards, inputs or popups) */
export function useSwipeTabs(onLeft, onRight) {
  const l = useRef(onLeft)
  const r = useRef(onRight)
  l.current = onLeft
  r.current = onRight
  useEffect(() => {
    if (!matchMedia('(pointer: coarse)').matches) return
    let sx = 0, sy = 0, t0 = 0, ok = false
    const start = (e) => {
      const el = e.target
      ok = e.touches.length === 1 && !el.closest?.('.shop, .modal, input, textarea, .cmenu, .combo, #pvModal, .bnav, .top')
      sx = e.touches[0].clientX; sy = e.touches[0].clientY; t0 = Date.now()
    }
    const end = (e) => {
      if (!ok) return
      const dx = e.changedTouches[0].clientX - sx
      const dy = e.changedTouches[0].clientY - sy
      if (Date.now() - t0 < 700 && Math.abs(dx) > 90 && Math.abs(dy) < 50) (dx < 0 ? l.current : r.current)?.()
    }
    addEventListener('touchstart', start, { passive: true })
    addEventListener('touchend', end)
    return () => { removeEventListener('touchstart', start); removeEventListener('touchend', end) }
  }, [])
}
