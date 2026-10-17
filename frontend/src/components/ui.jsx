import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { useApp } from '../context'
import { fav, hostOf } from '../api'
import { FolderBig, Search, X } from '../icons'

/* Google profile pictures come as tiny 96px thumbnails; ask for a bigger square crop so they stay sharp in every size. */
export const sharpPhoto = (url) => (/googleusercontent\.com\//.test(url) ? url.replace(/=s\d+(-c)?$/, '=s512-c') : url)

/* A profile circle. On its own it opens that person's profile; inside a button or link it leaves the click to that button
   (so rows that open a chat or pick someone keep doing their own thing). `plain` turns the click off. */
export function Avatar({ u, big, className = '', onClick, style, plain }) {
  const nav = useNavigate()
  const [bad, setBad] = useState(false)
  const initial = ((u?.nickname || u?.name || u?.username || '?')[0] || '?').toUpperCase()
  const linkable = !onClick && !plain && !!u?.username
  const go = linkable ? (e) => { if (e.currentTarget.closest('button, a')) return; e.stopPropagation(); nav(`/u/${u.username}`) } : onClick
  const av = (
    <div className={`av ${big ? 'big' : ''} ${className}`} onClick={go} role={linkable ? 'link' : undefined} aria-label={linkable ? `Open ${u.name || u.username}'s profile` : undefined}
      style={{ cursor: go ? 'pointer' : undefined, ...style }}>
      {u?.photo && !bad ? <img src={sharpPhoto(u.photo)} alt="" referrerPolicy="no-referrer" draggable={false} onError={() => setBad(true)} /> : initial}
    </div>
  )
  // a small golden dot when the person has the app open right now (the wrapper only exists for online people)
  return u?.online ? <span className="avw">{av}<i className="odot" title="Online" aria-label="Online" /></span> : av
}

export function Modal({ open = true, onClose, children, className = '', col }) {
  useEffect(() => {
    if (!open) return
    const k = (e) => e.key === 'Escape' && onClose?.()
    addEventListener('keydown', k)
    return () => removeEventListener('keydown', k)
  }, [open, onClose])
  if (!open) return null
  return (
    <div className={`modal on ${col ? 'col' : ''} ${className}`} onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      {children}
    </div>
  )
}

export function Seg({ value, onChange, options }) {
  return (
    <div className="seg pseg">
      {options.map(([v, label]) => (
        <button key={String(v)} type="button" className={value === v ? 'on' : ''} onClick={() => onChange(v)}>{label}</button>
      ))}
    </div>
  )
}

/* Search bar: icon on the left, clear button on the right */
export function SearchBar({ value, onChange, placeholder, autoFocus, onEnter }) {
  return (
    <div className="sbar">
      <Search size={18} />
      <input type="text" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} autoFocus={autoFocus}
        autoComplete="off" autoCapitalize="none" spellCheck={false} aria-label={placeholder}
        onKeyDown={onEnter ? (e) => { if (e.key === 'Enter') { e.preventDefault(); onEnter() } } : undefined} />
      {value && <button type="button" className="sclear" aria-label="Clear search" onClick={() => onChange('')}><X size={16} /></button>}
    </div>
  )
}

/* Grey shimmering blocks while something loads for the first time: no words, no spinner. */
export function Skel({ rows = 6 }) { return <div className="skel" aria-hidden="true">{Array.from({ length: rows }, (_, i) => <span key={i} />)}</div> }
export function Empty({ children }) { return <div className="empty">{children}</div> }

export function Toast() {
  const { toastMsg } = useApp()
  return <div className={`toast ${toastMsg ? 'on' : ''}`}>{toastMsg}</div>
}

/* confirm() and ask() dialogs */
export function Dialogs() {
  const { dialog, setDialog } = useApp()
  const [v1, setV1] = useState('')
  const [v2, setV2] = useState('')
  const [err, setErr] = useState('')
  useEffect(() => { setV1(dialog?.value || ''); setV2(''); setErr('') }, [dialog])
  if (!dialog) return null
  const close = (val) => { dialog.res(val); setDialog(null) }
  if (dialog.type === 'confirm') {
    return (
      <Modal onClose={() => close(false)}>
        <div className="sheet">
          <h2>{dialog.title || 'Are you sure?'}</h2>
          <p>{dialog.message}</p>
          <div className="btns">
            <button onClick={() => close(false)}>Cancel</button>
            <button className="go warn" onClick={() => close(true)}>{dialog.label || 'Delete'}</button>
          </div>
        </div>
      </Modal>
    )
  }
  const submit = async () => {
    const r = dialog.validate ? await dialog.validate(v1, v2) : null
    if (r) return setErr(r)
    close({ value: v1.trim(), value2: v2.trim() })
  }
  return (
    <Modal onClose={() => close(null)}>
      <div className="sheet">
        <h2>{dialog.title}</h2>
        {dialog.sub && <p>{dialog.sub}</p>}
        <input autoFocus value={v1} onChange={(e) => setV1(e.target.value)} placeholder={dialog.placeholder || ''}
          type={dialog.password ? 'password' : 'text'} inputMode={dialog.numeric ? 'numeric' : 'text'} maxLength={dialog.max || 60}
          onKeyDown={(e) => e.key === 'Enter' && submit()} />
        {dialog.confirm && (
          <input value={v2} onChange={(e) => setV2(e.target.value)} placeholder="Repeat to confirm" type="password"
            inputMode="numeric" maxLength={dialog.max || 60} onKeyDown={(e) => e.key === 'Enter' && submit()} />
        )}
        <div className="err">{err}</div>
        <div className="btns">
          <button onClick={() => close(null)}>Cancel</button>
          {dialog.clear && <button className="warn" onClick={() => close({ cleared: true })}>{dialog.clear}</button>}
          <button className="go" onClick={submit}>{dialog.ok || 'OK'}</button>
        </div>
      </div>
    </Modal>
  )
}

/* Small popup menu anchored to a button */
let closeOpenMenu = null // only one card menu can be open at a time

export function usePopupMenu() {
  const [menu, setMenu] = useState(null) // {x,y,items}
  useEffect(() => {
    if (!menu) return
    const c = () => setMenu(null)
    addEventListener('click', c); addEventListener('scroll', c, true); addEventListener('resize', c)
    return () => { removeEventListener('click', c); removeEventListener('scroll', c, true); removeEventListener('resize', c) }
  }, [menu])
  const open = (e, items, opts = {}) => {
    e.stopPropagation()
    e.preventDefault()
    if (closeOpenMenu) closeOpenMenu() // close any other card's menu first
    closeOpenMenu = () => setMenu(null)
    const r = e.currentTarget.getBoundingClientRect()
    // open upwards when the button is near the bottom of the screen
    const up = r.bottom + 6 + items.length * 42 + 12 > innerHeight && r.top > innerHeight / 2
    setMenu((m) => (m ? null : { x: Math.min(r.right, innerWidth - 8), y: up ? innerHeight - r.top + 6 : r.bottom + 6, up, items, top: !!opts.top, left: !!opts.left, lx: r.left, ly: r.top }))
  }
  // Portal to <body>: cards use transform/overflow, which would clip a fixed menu rendered inside them
  const el = menu && createPortal(
    <div className="cmenu" onClick={(e) => e.stopPropagation()}
      style={menu.left && innerWidth <= 720 ? { left: 'auto', bottom: 'auto', transform: 'none', right: innerWidth - menu.lx + 8, top: Math.max(8, Math.min(menu.ly, innerHeight - menu.items.length * 48 - 24)), minWidth: 0, width: 'max-content', maxWidth: Math.max(120, menu.lx - 16), maxHeight: '80vh', overflowY: 'auto' }   // phones, when asked: floats just to the left of the button
        : innerWidth <= 720 ? { left: '50%', right: 'auto', bottom: 'auto', maxHeight: '80vh', overflowY: 'auto', ...(menu.top ? { top: 64, transform: 'translateX(-50%)' } : { top: '50%', transform: 'translate(-50%, -50%)' }) }   // phones: centre of the screen, or just under the top bar
        : { ...(innerWidth <= 1024 ? { left: '50%', right: 'auto', transform: 'translateX(-50%)' } : { left: 'auto', right: innerWidth - menu.x }), ...(menu.up ? { bottom: menu.y } : { top: menu.y }) }}>
      {menu.items.map((it) => (
        <button key={it.label} className={`${it.danger ? 'danger' : ''} ${it.cls || ''}`.trim()} onClick={(e) => { e.stopPropagation(); setMenu(null); it.fn() }}>{it.label}</button>
      ))}
    </div>,
    document.body,
  )
  return [open, el]
}

export function SiteIcon({ host }) { return <img alt="" src={fav(host || hostOf(''))} /> }
export { useRef }

/* Board cover: a 2x2 collage of the latest link pictures (or one picture), else the board's emoji on its colour, else the folder icon */
export function BoardCover({ b }) {
  const pics = (b.previews && b.previews.length ? b.previews : b.preview ? [b.preview] : []).slice(0, 4)
  const [bad, setBad] = useState({})
  const ok = pics.filter((p) => !bad[p])
  const edge = b.color ? { boxShadow: `0 0 0 3px ${b.color}` } : undefined
  const img = (p, cls) => <img key={p} className={cls} alt="" src={p} loading="lazy" referrerPolicy="no-referrer" onError={() => setBad((x) => ({ ...x, [p]: 1 }))} />
  if (ok.length >= 2) return <div className="fcover collage" style={edge}>{ok.map((p) => img(p, ''))}</div>
  if (ok.length === 1) return <div className="fcover one" style={edge}>{img(ok[0], '')}{b.emoji && <span className="femoji">{b.emoji}</span>}</div>
  if (b.emoji) return <div className="fcover tile" style={{ background: b.color || 'var(--card)', ...edge }}><span>{b.emoji}</span></div>
  return <span style={{ color: b.color || undefined, display: 'inline-flex' }}><FolderBig /></span>
}
