import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, errMsg, fav, readImage } from '../api'
import { useApp, useFetch } from '../context'
import { Avatar, Modal, Seg, SearchBar } from './ui'
import { Folder } from '../icons'
import { ANIMALS } from '../animals'
import { useNameCheck } from '../lib'

/* Category box: click it and the list drops down (most used first, with counts); it narrows as you type,
   and anything you type that isn't in the list is used as a new category. Empty = auto-detect. */
export function CategorySelect({ value, onChange, cats, placeholder = 'Auto-detect — or pick / type a category' }) {
  const [text, setText] = useState('')
  const [open, setOpen] = useState(false)
  const [hi, setHi] = useState(-1)
  const list = cats || []
  // follow changes made by the form (reset, or an existing category id when editing)
  useEffect(() => {
    if (value === text) return
    setText(list.find((c) => c.id === value)?.name ?? value)
  }, [value, cats]) // eslint-disable-line
  const q = text.trim().toLowerCase()
  // 18+ categories stay out of the list until you search for them
  const matches = list.filter((c) => (q ? c.name.toLowerCase().includes(q) || c.id.includes(q) : !c.adult))
  const exact = list.some((c) => c.name.toLowerCase() === q || c.id === q)
  const rows = [...matches.map((c) => ({ key: c.id, label: c.name, count: c.count, pick: c.name })),
    ...(q && !exact ? [{ key: '__new', label: `Use “${text.trim()}”`, pick: text.trim(), isNew: true }] : [])]
  const choose = (r) => { setText(r.pick); onChange(r.pick); setOpen(false); setHi(-1) }
  const key = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setHi((h) => Math.min(h + 1, rows.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)) }
    else if (e.key === 'Enter' && open && hi >= 0 && rows[hi]) { e.preventDefault(); e.stopPropagation(); choose(rows[hi]) }
    else if (e.key === 'Escape' && open) { e.stopPropagation(); setOpen(false) }
  }
  return (
    <>
      <label>Category</label>
      <div className="combo">
        <input value={text} maxLength={20} placeholder={placeholder} autoComplete="off" spellCheck={false}
          onFocus={() => setOpen(true)} onBlur={() => setOpen(false)} onKeyDown={key}
          onChange={(e) => { setText(e.target.value); onChange(e.target.value); setOpen(true); setHi(-1) }} />
        {text && <button type="button" className="combo-x" aria-label="Clear category" onMouseDown={(e) => e.preventDefault()} onClick={() => { setText(''); onChange('') }}>×</button>}
        {open && rows.length > 0 && (
          <ul className="combo-list" role="listbox">
            {rows.map((r, i) => (
              <li key={r.key} role="option" aria-selected={i === hi} className={`${i === hi ? 'hi' : ''} ${r.isNew ? 'new' : ''}`}
                onMouseDown={(e) => e.preventDefault()} onClick={() => choose(r)} onMouseEnter={() => setHi(i)}>
                <span>{r.label}</span>{r.count > 0 && <em>{r.count}</em>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  )
}

/* Board box: click to pick from the boards you can add to (yours and ones you collaborate on), or type a name to create a new
   board. Left blank, the link just goes to All (Mine). onChange gets { id, newName }. */
function BoardSelect({ boards, onChange }) {
  const [text, setText] = useState('')
  const [open, setOpen] = useState(false)
  const list = (boards || []).filter((b) => b.can_edit)
  const q = text.trim().toLowerCase()
  const matches = list.filter((b) => !q || b.name.toLowerCase().includes(q))
  const exact = list.find((b) => b.name.toLowerCase() === q)
  const rows = [...matches.map((b) => ({ key: b.id, label: b.name, sub: b.owner && !b.is_owner ? `by @${b.owner.username}` : b.is_public ? 'Public' : 'Private', pick: b })),
    ...(q && !exact ? [{ key: '__new', label: `Create “${text.trim()}”`, isNew: true }] : [])]
  const change = (v) => {
    setText(v)
    const t = v.trim().toLowerCase()
    const hit = list.find((b) => b.name.toLowerCase() === t)
    onChange(hit ? { id: hit.id } : t ? { newName: v.trim() } : {})
  }
  const choose = (r) => { setText(r.isNew ? text.trim() : r.pick.name); onChange(r.isNew ? { newName: text.trim() } : { id: r.pick.id }); setOpen(false) }
  return (
    <div className="combo">
      <input value={text} maxLength={30} placeholder="Leave blank for All, or pick / type a board" autoComplete="off" spellCheck={false}
        onFocus={() => setOpen(true)} onBlur={() => setOpen(false)} onChange={(e) => { change(e.target.value); setOpen(true) }}
        onKeyDown={(e) => e.key === 'Escape' && open && (e.stopPropagation(), setOpen(false))} />
      {text && <button type="button" className="combo-x" aria-label="Clear board" onMouseDown={(e) => e.preventDefault()} onClick={() => change('')}>×</button>}
      {open && rows.length > 0 && (
        <ul className="combo-list" role="listbox">
          {rows.map((r) => (
            <li key={r.key} role="option" className={r.isNew ? 'new' : ''} onMouseDown={(e) => e.preventDefault()} onClick={() => choose(r)}>
              <span>{r.label}</span>{r.sub && <em>{r.sub}</em>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/* ---------- Add link (with optional new board, category and 18+; the photo is picked from the site) ---------- */
export function AddLinkModal({ open, onClose, board, onAdded }) {
  const { toast } = useApp()
  const { data: boards } = useFetch('/boards/', [open])
  const { data: cats } = useFetch('/categories/?options=1')
  const { data: mine } = useFetch(open && board ? '/links/' : null, [open])    // your Mine + Saved links, offered as you type (adding to a board only)
  const [suggest, setSuggest] = useState(false)
  const [name, setName] = useState('')            // the link's name and description: read from the site as soon as the address is complete, and yours to edit
  const [desc, setDesc] = useState('')
  const [reading, setReading] = useState(false)
  const [image, setImage] = useState('')           // a picture you uploaded for this link
  const [autoImage, setAutoImage] = useState('')    // the site's own picture, read from the link
  const imgFile = useRef()
  const touched = useRef({ name: false, desc: false })   // once you type in a box, we stop filling it in
  const [category, setCategory] = useState('')
  const [url, setUrl] = useState('')
  const [pub, setPub] = useState(false)
  const [adult, setAdult] = useState(false)
  const [boardId, setBoardId] = useState('')
  const [nbName, setNbName] = useState('')
  const [nbPub, setNbPub] = useState(false)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (open) { setUrl(''); setCategory(''); setPub(false); setAdult(false); setBoardId(''); setNbName(''); setErr(''); setName(''); setDesc(''); setReading(false); setImage(''); setAutoImage(''); touched.current = { name: false, desc: false } } }, [open])
  // once the address looks complete, read the site's name and description (after a short pause) and fill the boxes you have not typed in
  useEffect(() => {
    const u = url.trim()
    if (!open || !/^(https?:\/\/)?[^\s/]+\.[^\s/]{2,}(\/\S*)?$/i.test(u)) { setReading(false); return }
    let stop = false
    setReading(true)
    const t = setTimeout(async () => {
      try {
        const { data } = await api.get('/preview/', { params: { url: u } })
        if (stop) return
        if (!touched.current.name) setName(data.title || '')
        if (!touched.current.desc) setDesc(data.description || '')
        setAutoImage(data.image || '')
      } catch { /* the link may be unreachable: you can still type a name yourself */ } finally { if (!stop) setReading(false) }
    }, 600)
    return () => { stop = true; clearTimeout(t) }
  }, [url, open])

  // as you type: your own links (Mine and Saved) that match, leaving out what is already on this board
  const typed = url.trim().toLowerCase()
  const onBoard = new Set((board?.links || []).map((l) => (l.url || '').toLowerCase()))
  const suggestions = !board || !mine ? [] : mine
    .filter((l) => !onBoard.has((l.url || '').toLowerCase()) && l.url.toLowerCase() !== typed)
    .filter((l) => !typed || `${l.title} ${l.host} ${l.url}`.toLowerCase().includes(typed))
    .slice(0, 8)

  const pasteClip = async () => { try { setUrl(await navigator.clipboard.readText()) } catch { setErr('Clipboard blocked. Paste into the box manually.') } }

  const submit = async () => {
    if (busy) return
    if (!url.trim()) return setErr('Paste a link first.')
    if (!/^(https?:\/\/)?[^\s/]+\.[^\s/]{2,}(\/\S*)?$/i.test(url.trim())) return setErr('That does not look like a link.')
    // the popup closes the moment Add link is pressed; the link is added in the background (reading its page can take a few seconds)
    // and the result shows up as a message, and in the list when it is ready
    const sent = { url, adult, category: category || undefined, title: name.trim() || undefined, description: desc.trim() || undefined, image: image || undefined }
    const forBoard = board, isPub = pub, bId = boardId, nb = { name: nbName, is_public: nbPub }
    setBusy(true); setErr(''); onClose(); toast('Adding your link…')
    try {
      if (forBoard) {
        await api.post(`/boards/${forBoard.id}/links/`, sent)
        toast(`Added to ${forBoard.name}`)
      } else {
        const body = { ...sent, is_public: isPub }
        if (bId === '__new') body.new_board = nb
        else if (bId) body.board_id = bId
        await api.post('/links/', body)
        toast(isPub ? 'Added as public' : 'Added as private')
      }
      onAdded?.()
    } catch (e) { toast(errMsg(e)) } finally { setBusy(false) }
  }
  return (
    <Modal open={open} onClose={onClose} className="addlinkmodal">
      <div className="sheet">
        <h2>{board ? `Add to ${board.name}` : 'Add a link'}</h2>
        <p>{board ? 'Paste a website link and it joins this board.' : 'Paste a website link, then choose who can see it.'}</p>
        <div className="alcols">
        <div className="alleft">
        <div className="urlrow">
          <input value={url} onChange={(e) => { setUrl(e.target.value); setSuggest(true) }} placeholder={board ? 'Paste a link, or pick one of yours' : 'https://example.com'} autoFocus inputMode="url" autoCapitalize="none" spellCheck={false}
            onFocus={() => setSuggest(true)} onClick={() => setSuggest(true)} onBlur={() => setTimeout(() => setSuggest(false), 150)} onKeyDown={(e) => e.key === 'Enter' && submit()} />
          <button type="button" className="pastebtn" onClick={pasteClip}>Paste</button>
          {board && suggest && suggestions.length > 0 && (
            <div className="linksug" role="listbox" aria-label="Your links">
              {suggestions.map((l) => (
                <button key={l.id} type="button" role="option" onMouseDown={(e) => e.preventDefault()} onClick={() => { setUrl(l.url); setSuggest(false) }}>
                  <img alt="" src={l.logo || fav(l.host)} referrerPolicy="no-referrer" onError={(e) => (e.currentTarget.style.visibility = 'hidden')} />
                  <span><b>{l.title}</b><small>{l.host}</small></span>
                  <i>{l.source === 'saved' ? 'Saved' : 'Malinks'}</i>
                </button>
              ))}
            </div>
          )}
        </div>
        <label>Name <small>optional{reading ? ' · reading the link…' : ''}</small></label>
        <input className="ldname" value={name} maxLength={300} placeholder="Filled in from the link. Change it if you like" onChange={(e) => { touched.current.name = true; setName(e.target.value) }} />
        <label>Description <small>optional</small></label>
        <textarea className="lddesc" rows={3} value={desc} maxLength={1000} placeholder="Filled in from the link. Change it if you like" onChange={(e) => { touched.current.desc = true; setDesc(e.target.value) }} />
        <label>Image <small>optional</small></label>
        <input ref={imgFile} type="file" accept="image/*" hidden onChange={async (e) => {
          const f = e.target.files?.[0]; e.target.value = ''
          if (f) try { setImage(await readImage(f, { max: 900 })); setErr('') } catch (x) { setErr(x.message || 'Could not use that image') }
        }} />
        <div className="ldimg">
          {(image || autoImage) ? <img alt="" src={image || autoImage} referrerPolicy="no-referrer" onError={(e) => (e.currentTarget.style.visibility = 'hidden')} /> : <span className="ldnoimg">No picture yet</span>}
          <div>
            <button type="button" className="ghost" onClick={() => imgFile.current.click()}>{image ? 'Change image' : 'Upload image'}</button>
            {image && <button type="button" className="ghost" onClick={() => setImage('')}>Remove</button>}
            <small>{image ? 'Your picture is used.' : autoImage ? 'The site’s own picture. Upload one to replace it.' : 'Upload one, or the site’s picture is used if it has one.'}</small>
          </div>
        </div>
        </div>
        <div className="alright">
        {!board && (<><label>Visibility</label><Seg value={pub} onChange={setPub} options={[[false, 'Private'], [true, 'Public']]} /></>)}
        {!board && (
          <>
            <label>Add to a board (optional)</label>
            <BoardSelect key={String(open)} boards={boards} onChange={({ id, newName }) => { setBoardId(id ? String(id) : newName ? '__new' : ''); setNbName(newName || '') }} />
            {boardId === '__new' && <Seg value={nbPub} onChange={setNbPub} options={[[false, 'New board is private'], [true, 'New board is public']]} />}
          </>
        )}
        <CategorySelect value={category} onChange={setCategory} cats={cats} />
        <label>18+ content</label>
        <Seg value={adult} onChange={setAdult} options={[[false, 'No'], [true, 'Yes, 18+']]} />
        </div>
        </div>
        <div className="err">{err}</div>
        <div className="btns">
          <button onClick={onClose}>Cancel</button>
          <button className="go" onClick={submit} disabled={busy}>{busy ? 'Adding…' : 'Add link'}</button>
        </div>
      </div>
    </Modal>
  )
}

/* ---------- Edit link ---------- */
export function EditLinkModal({ link, onClose, onSaved, board }) {
  const { toast } = useApp()
  const [f, setF] = useState(null)
  const { data: cats } = useFetch('/categories/?options=1')
  const [photo, setPhoto] = useState(undefined) // undefined = unchanged, '' = reset to site photo
  const file = useRef()
  useEffect(() => { if (link) { setF({ title: link.title, description: link.description || '', is_public: link.is_public, adult: link.adult, category: link.category || '' }); setPhoto(undefined) } }, [link])
  if (!link || !f) return null
  const set = (k) => (v) => setF((s) => ({ ...s, [k]: v }))
  const shown = photo === undefined ? (link.custom_image ? link.image : '') : photo
  const save = async () => {
    try {
      const body = { title: f.title, description: f.description, adult: f.adult, category: f.category || undefined }
      if (!board && link.source !== 'saved') body.is_public = f.is_public
      if (photo !== undefined) body.image = photo
      if (board) await api.patch(`/boards/${board.id}/links/${link.id}/`, { title: f.title, description: f.description, adult: f.adult })
      else await api.patch(`/links/${link.id}/`, body)
      onSaved?.(); onClose()
    } catch (e) { toast(errMsg(e)) }
  }
  return (
    <Modal onClose={onClose}>
      <div className="sheet">
        <h2>Edit link</h2>
        <p>{link.host}</p>
        <label>Title</label><input value={f.title} maxLength={120} onChange={(e) => set('title')(e.target.value)} />
        <label>Description</label><input value={f.description} maxLength={300} onChange={(e) => set('description')(e.target.value)} />
        {!board && link.source !== 'saved' && (<><label>Visibility</label><Seg value={f.is_public} onChange={set('is_public')} options={[[false, 'Private'], [true, 'Public']]} /></>)}
        {!board && <CategorySelect value={f.category} onChange={set('category')} cats={cats} />}
        <label>18+ content</label><Seg value={f.adult} onChange={set('adult')} options={[[false, 'No'], [true, 'Yes, 18+']]} />
        {!board && (
          <>
            <label>Photo</label>
            <div className="photorow">
              {shown && <img src={shown} alt="" />}
              <button type="button" onClick={() => file.current.click()}>Upload photo</button>
              {(link.custom_image || photo) && <button type="button" onClick={() => setPhoto('')}>Use site photo</button>}
            </div>
            <input ref={file} type="file" accept="image/*" hidden onChange={async (e) => { const x = e.target.files[0]; e.target.value = ''; if (x) try { setPhoto(await readImage(x)) } catch (er) { toast(er.message) } }} />
          </>
        )}
        <div className="btns"><button onClick={onClose}>Cancel</button><button className="go" onClick={save}>Save</button></div>
      </div>
    </Modal>
  )
}

/* ---------- Advertise ---------- */
export function AdvertiseModal({ link, onClose, onDone }) {
  const { toast } = useApp()
  const [pitch, setPitch] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => setPitch(link?.pitch || ''), [link])
  if (!link) return null
  const go = async () => {
    setBusy(true)
    try { await api.post(`/links/${link.id}/advertise/`, { pitch }); toast('Your link is now in Discover'); onDone?.(); onClose() }
    catch (e) { toast(errMsg(e)) } finally { setBusy(false) }
  }
  return (
    <Modal onClose={onClose}>
      <div className="sheet">
        <h2>Advertise this link</h2>
        <p>{link.title} appears in everyone's Discover, at the very top for the first 6 hours. The link must be active, and it becomes public.</p>
        <input value={pitch} maxLength={140} onChange={(e) => setPitch(e.target.value)} placeholder="One line pitch (optional)" />
        <div className="btns">
          <button onClick={onClose}>Cancel</button>
          <button className="go" onClick={go} disabled={busy}>{busy ? 'Checking link…' : 'Advertise'}</button>
        </div>
      </div>
    </Modal>
  )
}

/* ---------- New board: name, category (pick one, most used first with counts, or type your own) and who can see it ---------- */
export function NewBoardModal({ open, onClose, onCreated }) {
  const { data: cats } = useFetch(open ? '/categories/?options=1' : null, [open])
  const [name, setName] = useState('')
  const [category, setCategory] = useState('')
  const [pub, setPub] = useState(false)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (open) { setName(''); setCategory(''); setPub(false); setErr('') } }, [open])
  if (!open) return null
  const submit = async () => {
    if (!name.trim()) return setErr('Give the board a name.')
    setBusy(true)
    try { await api.post('/boards/', { name: name.trim(), is_public: pub, category: category || undefined }); onCreated?.(); onClose() }
    catch (e) { setErr(errMsg(e)) }
    setBusy(false)
  }
  return (
    <Modal onClose={onClose}>
      <form className="sheet" onSubmit={(e) => { e.preventDefault(); submit() }}>
        <h2>New board</h2>
        <input value={name} onChange={(e) => { setName(e.target.value); setErr('') }} maxLength={30} placeholder="Board name, e.g. Music" autoFocus />
        <CategorySelect value={category} onChange={setCategory} cats={cats} placeholder="Pick or type a category (optional)" />
        <Seg value={pub} onChange={setPub} options={[[false, 'Private'], [true, 'Public']]} />
        <div className="err">{err}</div>
        <div className="btns"><button type="button" onClick={onClose}>Cancel</button><button className="go" disabled={busy}>Create</button></div>
      </form>
    </Modal>
  )
}

/* ---------- Save to board (with "create a new board") ---------- */
export function PickBoardModal({ payload, onClose }) {
  const { toast } = useApp()
  const { data: boards, reload } = useFetch('/boards/', [!!payload])
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [pub, setPub] = useState(false)
  const [err, setErr] = useState('')
  useEffect(() => { setCreating(false); setName(''); setErr('') }, [payload])
  if (!payload) return null
  const pin = async (id, boardName) => {
    try { await api.post(`/boards/${id}/pin/`, payload.body); toast(`Saved to ${boardName}`); onClose() }
    catch (e) { toast(errMsg(e)); onClose() }
  }
  const create = async () => {
    try { const { data } = await api.post('/boards/', { name, is_public: pub }); await pin(data.id, data.name) }
    catch (e) { setErr(errMsg(e)) }
  }
  return (
    <Modal onClose={onClose}>
      <div className="sheet">
        <h2>Save to a board</h2>
        <p>{payload.title}</p>
        <button className="bpitem newb" onClick={() => setCreating((c) => !c)}>+ Create a new board</button>
        {creating && (
          <div>
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={30} placeholder="Board name, e.g. Music" autoFocus />
            <Seg value={pub} onChange={setPub} options={[[false, 'Private'], [true, 'Public']]} />
            <div className="err">{err}</div>
            <button className="solid" style={{ width: '100%', marginTop: 6 }} onClick={create}>Create &amp; save</button>
          </div>
        )}
        <label>Your boards</label>
        {(boards || []).filter((b) => b.can_edit).length ? boards.filter((b) => b.can_edit).map((b) => (
          <button key={b.id} className="bpitem" onClick={() => pin(b.id, b.name)}>
            <Folder size={22} /><span>{b.name}<small>{b.is_public ? 'Public' : 'Private'}{b.member_count > 1 ? ` · shared with ${b.member_count - 1}` : ''}</small></span>
          </button>
        )) : <p>No boards yet.</p>}
        <div className="btns"><button onClick={onClose}>Cancel</button></div>
      </div>
    </Modal>
  )
}

/* ---------- Send a link to a friend ---------- */
export function PickFriendModal({ link, onClose }) {
  const { toast } = useApp()
  const { data: friends } = useFetch('/friends/', [!!link])
  if (!link) return null
  const acc = (friends || []).filter((f) => f.status === 'accepted')
  const send = async (u) => {
    try {
      await api.post(`/messages/${u.id}/`, { url: link.url }); toast(`Sent to ${u.nickname || u.name}`); onClose()
      if (link.board_id || typeof link.id === 'number') api.post('/events/', { kind: 'share', ...(link.board_id ? { board_id: link.board_id } : { link_id: link.id }) }).catch(() => {})
    }
    catch (e) { toast(errMsg(e)) }
  }
  return (
    <Modal onClose={onClose}>
      <div className="sheet">
        <h2>Send to an OPAL</h2><p>{link.title}</p>
        {acc.length ? acc.map((f) => (
          <div className="frow" key={f.user.id}><Avatar u={f.user} /><div className="n"><b>{f.user.nickname || f.user.name}</b><small>@{f.user.username}</small></div>
            <div className="b"><button className="ghost bluebtn" onClick={() => send(f.user)}>Send</button></div></div>
        )) : <p>You have no OPALS yet. Follow people to make some.</p>}
        <div className="btns"><button onClick={onClose}>Cancel</button></div>
      </div>
    </Modal>
  )
}

/* ---------- Edit profile & privacy ---------- */
export function EditProfileModal() {
  const { user, editProfile, setEditProfile, patchMe, toast } = useApp()
  const [name, setName] = useState('')
  const [username, setUsername] = useState('')
  const [priv, setPriv] = useState(false)
  const [msgs, setMsgs] = useState('friends')
  const [qrOk, setQrOk] = useState(true)          // others may send me messages as a QR code
  const [err, setErr] = useState('')
  useEffect(() => { if (editProfile && user) { setName(user.name); setUsername(user.username); setPriv(user.is_private); setMsgs(user.message_privacy || 'friends'); setQrOk(user.qr_messages !== false); setErr('') } }, [editProfile, user])
  const nameChk = useNameCheck('username', username, user?.username)
  if (!editProfile) return null
  const save = async () => {
    try { await patchMe({ name, username, is_private: priv, message_privacy: msgs, qr_messages: qrOk }); toast(priv ? 'Your profile is now private' : 'Your profile is now public'); setEditProfile(false) }
    catch (e) { setErr(errMsg(e)) }
  }
  return (
    <Modal onClose={() => setEditProfile(false)}>
      <div className="sheet">
        <h2>Edit profile</h2>
        <label>Name</label><input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
        <label>Username</label><input value={username} maxLength={20} onChange={(e) => setUsername(e.target.value)} autoCapitalize="none" />
        {nameChk.msg && <small className={`namechk ${nameChk.ok ? 'ok' : 'bad'}`}>{nameChk.ok ? '✓ ' : ''}{nameChk.msg}</small>}
        <label>Contact</label><p>{user.email}</p>
        <label>Profile privacy</label>
        <Seg value={priv} onChange={setPriv} options={[[false, 'Public'], [true, 'Private']]} />
        {!priv && <>
          <label>Who can message you</label>
          <Seg value={msgs} onChange={setMsgs} options={[['anyone', 'Anyone'], ['friends', 'OPALS'], ['none', 'No one']]} />
          <label>QR messages</label>
          <Seg value={qrOk} onChange={setQrOk} options={[[true, 'Allow'], [false, 'Don’t allow']]} />
        </>}
        <div className="err">{err}</div>
        <div className="btns"><button onClick={() => setEditProfile(false)}>Cancel</button><button className="go" onClick={save} disabled={nameChk.ok === false}>Save</button></div>
      </div>
    </Modal>
  )
}

/* ---------- Profile picture (add / change / remove / save) ---------- */
export function PhotoModal() {
  const { user, photoEdit, setPhotoEdit, patchMe, toast } = useApp()
  const [draft, setDraft] = useState('')
  const [err, setErr] = useState('')
  const file = useRef()
  useEffect(() => { if (photoEdit) { setDraft(user?.photo || ''); setErr('') } }, [photoEdit, user])
  if (!photoEdit) return null
  const save = async () => { try { await patchMe({ photo: draft }); toast(draft ? 'Profile picture saved' : 'Profile picture removed'); setPhotoEdit(false) } catch (e) { setErr(errMsg(e)) } }
  return (
    <Modal onClose={() => setPhotoEdit(false)}>
      <div className="sheet">
        <h2>Profile picture</h2>
        <div style={{ display: 'grid', placeItems: 'center', margin: '8px 0 12px' }}><Avatar big plain u={{ ...user, photo: draft }} /></div>
        <input ref={file} type="file" accept="image/*" hidden onChange={async (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) try { setDraft(await readImage(f, { square: true })); setErr('') } catch (x) { setErr(x.message) } }} />
        <div className="pickrow" role="radiogroup" aria-label="Choose a picture">
          <button type="button" className="plus" aria-label="Upload a photo" title="Upload a photo" onClick={() => file.current.click()}>+</button>
          {ANIMALS.map((a) => (
            <button key={a.id} type="button" role="radio" aria-checked={draft === a.uri} aria-label={a.name} title={a.name} className={draft === a.uri ? 'on' : ''}
              onClick={() => { setDraft(a.uri); setErr('') }}><img src={a.uri} alt="" /></button>
          ))}
        </div>
        <div className="err">{err}</div>
        {draft && <div className="btns"><button className="warn" onClick={() => setDraft('')}>Remove picture</button></div>}
        <div className="btns"><button onClick={() => setPhotoEdit(false)}>Cancel</button><button className="go" onClick={save}>Save</button></div>
      </div>
    </Modal>
  )
}

/* ---------- Interests popup (the pen next to your interests on your profile) ---------- */
export function InterestsModal({ open, onClose }) {
  if (!open) return null
  return (
    <Modal onClose={onClose}>
      <div className="sheet">
        <h2>My interests</h2>
        <InterestsBody />
        <div className="btns"><button className="go" onClick={onClose}>Done</button></div>
      </div>
    </Modal>
  )
}
/* ---------- Interests and Blocked accounts (shown on full pages; interests also as the first-login popup) ---------- */
const MAX_INTERESTS = 6
const MIN_INTERESTS = 1

/* The categories people can pick from (only ones in use). You need at least 1 and can pick up to 6. */
export function useInterestOptions() {
  const { user } = useApp()
  const { data: cats, loading, reload } = useFetch('/categories/?used=1', [], { poll: 15000 })
  const picked = (user.interests || []).length
  const need = Math.min(MIN_INTERESTS, (cats || []).length)
  return { cats, loading, reload, picked, need, ready: !loading && picked >= need && picked <= MAX_INTERESTS }
}

export function InterestsBody() {
  const { user, patchMe, refresh, toast } = useApp()
  const { cats, loading, reload, picked, need } = useInterestOptions()
  const [q, setQ] = useState('')
  const term = q.trim().toLowerCase().replace(/^@/, '')
  const shown = useMemo(() => (cats || []).filter((c) => !term || c.name.toLowerCase().includes(term)), [cats, term])
  const toggle = (id) => {
    const cur = user.interests || []
    if (!cur.includes(id) && cur.length >= MAX_INTERESTS) return toast(`You can pick up to ${MAX_INTERESTS} interests. Tap one to remove it first.`)
    if (cur.includes(id) && cur.length <= MIN_INTERESTS) return toast('Keep at least one interest.')
    patchMe({ interests: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] }).then(refresh)
  }
  // typed text that isn't in the list becomes a new interest of your own
  const typed = q.trim()
  const exact = (cats || []).find((c) => c.name.toLowerCase() === typed.toLowerCase() || c.id === typed.toLowerCase())
  const addTyped = () => {
    if (!typed) return
    if (exact) return toggle(exact.id)
    const cur = user.interests || []
    if (cur.length >= MAX_INTERESTS) return toast(`You can pick up to ${MAX_INTERESTS} interests. Tap one to remove it first.`)
    patchMe({ interests: [...cur, typed] }).then(() => { setQ(''); refresh(); reload() }).catch(() => {})
  }
  return (
    <>
      <p className="hint pickhint">Pick 1 to {MAX_INTERESTS} interests. They show on your profile and are shown first in Discover. <b>{picked}/{MAX_INTERESTS} picked</b></p>
      <SearchBar value={q} onChange={setQ} placeholder="Search or type your own interest" onEnter={addTyped} />
      {typed && !exact && (
        <button type="button" className="addint" onClick={addTyped}>+ Add “{typed}” as an interest</button>
      )}
      <label>Your interests</label>
      {!loading && !(cats || []).length && <p className="hint">No categories yet. They appear here once people add public links.</p>}
      <div className="catwrap">{shown.map((c) => (
        <button key={c.id} className={`catbtn ${(user.interests || []).includes(c.id) ? 'on' : ''}`} onClick={() => toggle(c.id)}>
          {c.name}<span className="ccount" title={`${c.count} public link${c.count === 1 ? '' : 's'}`}>{c.count}</span>
        </button>))}</div>
      <label>18+ content</label>
      <Seg value={!!user.hide_adult} onChange={(v) => patchMe({ hide_adult: v }).then(refresh)} options={[[false, 'Show'], [true, 'Hide in Discover']]} />
    </>
  )
}

export function BlockedBody() {
  const { user, patchMe, toast, refresh } = useApp()
  const { data: cats } = useFetch('/categories/')
  const { data: blocked, reload } = useFetch('/blocks/')
  const [q, setQ] = useState('')
  const [found, setFound] = useState([])
  useEffect(() => {
    if (q.trim().length < 2) { setFound([]); return }
    const t = setTimeout(async () => { try { setFound((await api.get('/users/search/', { params: { q } })).data) } catch { setFound([]) } }, 300)
    return () => clearTimeout(t)
  }, [q])
  const block = async (u) => { try { await api.post('/blocks/', { user_id: u.id }); toast(`Blocked ${u.name}`); reload(); refresh() } catch (e) { toast(errMsg(e)) } }
  const unblock = async (u) => { await api.delete(`/blocks/${u.id}/`); toast('Unblocked'); reload(); refresh() }
  const isBlocked = (id) => (blocked || []).some((b) => b.id === id)
  const blockedCats = (user.blocked_categories || []).map((id) => ({ id, name: (cats || []).find((c) => c.id === id)?.name || id.replace(/-/g, ' ') }))
  const unblockCat = (id) => patchMe({ blocked_categories: (user.blocked_categories || []).filter((x) => x !== id) }).then(refresh)
  return (
    <>
      <SearchBar value={q} onChange={setQ} placeholder="Search a name or @username to block" />
      {q.trim().length >= 2 && !found.length && <p className="hint">No one found for “{q.trim()}”.</p>}
      {found.map((u) => (
        <div className="frow" key={u.id}><Avatar u={u} /><div className="n"><b>{u.name}</b><small>@{u.username}</small></div>
          <div className="b">{isBlocked(u.id) ? <button className="ghost" onClick={() => unblock(u)}>Unblock</button> : <button className="ghost danger" onClick={() => block(u)}>Block</button>}</div></div>))}
      <label>Blocked users</label>
      {(blocked || []).length ? blocked.map((u) => (
        <div className="frow" key={u.id}><Avatar u={u} /><div className="n"><b>{u.name}</b><small>@{u.username}</small></div>
          <div className="b"><button className="ghost" onClick={() => unblock(u)}>Unblock</button></div></div>)) : <p className="hint">No blocked accounts.</p>}
      {blockedCats.length > 0 && (
        <>
          <label>Blocked categories (tap to unblock)</label>
          <div className="catwrap">{blockedCats.map((c) => <button key={c.id} className="catbtn off" onClick={() => unblockCat(c.id)}>{c.name}</button>)}</div>
        </>
      )}
    </>
  )
}

/* First-login popup: choose 1 to 6 interests (can't be closed until you have) */
export function SettingsModal() {
  const { settings, setSettings, patchMe, toast } = useApp()
  const { ready, need } = useInterestOptions()
  if (!settings) return null
  const finish = async () => {
    if (!ready) return toast('Pick at least one interest to continue.')
    await patchMe({ interests_set: true }); setSettings(false)
  }
  return (
    <Modal onClose={finish}>
      <div className="sheet">
        <h2>Choose your interests</h2>
        <InterestsBody />
        <div className="btns"><button className="go" onClick={finish} disabled={!ready}>Done</button></div>
      </div>
    </Modal>
  )
}
export { useNavigate }
