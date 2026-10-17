import { useNavigate } from 'react-router-dom'
import { useState } from 'react'
import { createPortal } from 'react-dom'
import { useApp } from '../context'
import { Avatar, Modal, Seg } from './ui'
import { DEFAULT_CUSTOM, MAX_CUSTOM, THEMES, applyTheme, getCustoms, getTheme, paintCustom, saveCustoms } from '../theme'
import { readImage } from '../api'
import { CardI, Exit, Gear, Grid4, LinkI, Pulse, ShieldI, UserI } from '../icons'

/* Build your own theme (up to 3): colors + optional background image, previewed live, saved on this device.
   `id` is an existing custom theme's id, or null for a new one. */
export function CustomThemeModal({ open, id, onClose, onChanged }) {
  const { toast } = useApp()
  const [c, setC] = useState(DEFAULT_CUSTOM)
  const [prev, setPrev] = useState(null) // theme to restore if the editor is cancelled
  const [wasOpen, setWasOpen] = useState(false)
  if (open && !wasOpen) { setWasOpen(true); setC(getCustoms().find((x) => x.id === id) || DEFAULT_CUSTOM); setPrev(getTheme()) }
  if (!open) { if (wasOpen) setWasOpen(false); return null }
  const set = (patch) => { const n = { ...c, ...patch }; setC(n); paintCustom(n) }
  const cancel = () => { applyTheme(prev); onClose() }
  const pickImage = async (e) => {
    const f = e.target.files?.[0]; e.target.value = ''
    if (!f) return
    try { set({ image: await readImage(f, { max: 1280 }) }) } catch (err) { toast(err.message) }
  }
  const save = () => {
    const list = getCustoms()
    const nid = id || `custom-${Date.now()}`
    const next = id ? list.map((x) => (x.id === id ? { ...c, id } : x)) : [...list, { ...c, id: nid }].slice(0, MAX_CUSTOM)
    if (!saveCustoms(next)) return toast('That image is too big to save. Try a smaller one.')
    applyTheme(nid); onChanged(nid); toast('Theme saved'); onClose()
  }
  const remove = () => {
    saveCustoms(getCustoms().filter((x) => x.id !== id))
    applyTheme('night'); onChanged('night'); toast('Theme deleted'); onClose()
  }
  // portal: the sidebar slides with a transform, which would trap a fixed popup inside it
  return createPortal(
    <Modal onClose={cancel} className="center">
      <div className="sheet">
        <h2>{id ? 'Edit theme' : 'New theme'}</h2>
        <div className="cust">
          <label>Background color</label><input type="color" value={c.bg} onChange={(e) => set({ bg: e.target.value })} />
          <label>Text color</label><input type="color" value={c.ink} onChange={(e) => set({ ink: e.target.value })} />
          <label>Accent color</label><input type="color" value={c.accent} onChange={(e) => set({ accent: e.target.value })} />
          <label>Font</label>
          <div style={{ gridColumn: '1 / -1' }}><Seg value={c.font || 'default'} onChange={(v) => set({ font: v })} options={[['default', 'Default'], ['serif', 'Serif'], ['mono', 'Mono'], ['round', 'Round']]} /></div>
          <label>Text size</label>
          <div style={{ gridColumn: '1 / -1' }}><Seg value={c.size || 'm'} onChange={(v) => set({ size: v })} options={[['s', 'Small'], ['m', 'Medium'], ['l', 'Large']]} /></div>
          <label>Density</label>
          <div style={{ gridColumn: '1 / -1' }}><Seg value={c.density || 'comfy'} onChange={(v) => set({ density: v })} options={[['comfy', 'Comfy'], ['compact', 'Compact']]} /></div>
          <label>Background image</label>
          <div className="imgrow">
            <label className="ghost" style={{ cursor: 'pointer' }}>{c.image ? 'Change image' : 'Choose image'}
              <input type="file" accept="image/*" hidden onChange={pickImage} /></label>
            {c.image && <button type="button" onClick={() => set({ image: '' })}>Remove image</button>}
          </div>
        </div>
        <div className="btns">
          {id && <button className="danger" onClick={remove}>Delete</button>}
          <button onClick={cancel}>Cancel</button><button className="go" onClick={save}>Save</button>
        </div>
      </div>
    </Modal>,
    document.body
  )
}

export default function Drawer() {
  const { user, drawer, setDrawer, logout, setSettings, setEditProfile, setPhotoEdit, toast } = useApp()
  const nav = useNavigate()
  const go = (fn) => { setDrawer(false); fn() }
  const [theme, setTheme] = useState(getTheme)
  const [customs, setCustoms] = useState(getCustoms)
  const [editing, setEditing] = useState(null) // null | { id } (id null = new theme)
  const changed = (id) => { setCustoms(getCustoms()); setTheme(id) }
  const pick = (id) => {
    const i = customs.findIndex((c) => c.id === id)
    if (i >= 0 && theme === id) return setEditing({ id }) // tapping the active custom theme opens it for editing / deleting
    applyTheme(id); setTheme(id); toast(`${i >= 0 ? `My theme ${i + 1}` : THEMES.find((t) => t.id === id)?.name} theme`.replace('theme theme', 'theme'))
  }
  const openProfile = () => go(() => nav(`/u/${user.username}`))      // the photo, name and @username all open your profile page
  return (
    <>
      <div className={`scrim ${drawer ? 'on' : ''}`} onClick={() => setDrawer(false)} />
      <aside className={`drawer ${drawer ? 'on' : ''}`} aria-label="Profile">
        <div className="dhead">
          <Avatar u={user} onClick={openProfile} />
          <b className="dlinkname" role="link" tabIndex={0} onClick={openProfile} onKeyDown={(e) => e.key === 'Enter' && openProfile()}>{user?.name}</b>
          <small className="dlinkname" role="link" tabIndex={0} onClick={openProfile} onKeyDown={(e) => e.key === 'Enter' && openProfile()}>@{user?.username}</small>
        </div>
        <button onClick={() => go(() => nav(`/u/${user.username}`))}><UserI size={20} />My profile</button>
        <button onClick={() => go(() => nav('/ocard'))}><CardI size={20} />OCARD</button>
        <button onClick={() => go(() => nav('/otin'))}><LinkI size={20} />Otin</button>
        <button onClick={() => go(() => nav('/ogems'))}><Grid4 size={20} />OGems</button>
        {user?.is_staff && <button onClick={() => go(() => nav('/admin'))}><ShieldI size={20} />Admin</button>}
        <button onClick={() => go(() => nav('/settings'))}><Gear size={20} />Settings</button>
        <button className="danger" onClick={() => go(logout)}><Exit size={20} />Log out</button>
        <div className="themes" role="radiogroup" aria-label="Theme">
          {THEMES.map((t) => (
            <button key={t.id} role="radio" aria-checked={theme === t.id} aria-label={`${t.name} theme`} title={t.name}
              className={theme === t.id ? 'on' : ''} onClick={() => pick(t.id)}
              style={{ background: `linear-gradient(135deg, ${t.bg} 50%, ${t.accent} 50%)` }} />
          ))}
          {customs.map((c, i) => (
            <button key={c.id} role="radio" aria-checked={theme === c.id} aria-label={`My theme ${i + 1}`} title={theme === c.id ? 'Tap to edit or delete' : `My theme ${i + 1}`}
              className={theme === c.id ? 'on' : ''} onClick={() => pick(c.id)}
              style={{ background: `linear-gradient(135deg, ${c.bg} 50%, ${c.accent} 50%)` }} />
          ))}
          <button className="add" aria-label="Create theme" title="Create your own theme"
            onClick={() => (customs.length >= MAX_CUSTOM ? toast(`You can create up to ${MAX_CUSTOM} themes. Tap your active one to edit or delete it.`) : setEditing({ id: null }))}>+</button>
        </div>
        <CustomThemeModal open={!!editing} id={editing?.id} onClose={() => setEditing(null)} onChanged={changed} />
        <div className="dbrand">
          OPIOW<span>.</span>
        </div>
      </aside>
    </>
  )
}
