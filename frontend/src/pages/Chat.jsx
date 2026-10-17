import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { api, errMsg, hostOf, isLocked, unlockStore } from '../api'
import { useApp, useFetch, useTopBar } from '../context'
import { Avatar, Modal, SearchBar, Seg, Skel, usePopupMenu } from '../components/ui'
import { Check, Dots, Eye, Grid4, ListI, Lock, QrI, Warn, X } from '../icons'
import { PickBoardModal, PickFriendModal, QrModal } from '../components/LazyModals'
import { haptic } from '../gestures'
import ChatSettingsPanel from '../components/ChatSettingsPanel'
import { clipWords, keepIfSame, toggleLock, unlockWithPin } from '../lib'

const norm = (u) => (u || '').toLowerCase().replace(/^https?:\/\/(www\.)?/, '').replace(/\/+$/, '')

export default function Chat() {
  const { uid: param } = useParams()           // the person's username (an old address with their number still works)
  const nav = useNavigate()
  const { user, ask, toast, confirm, setViewer, refresh, tick, loadCounts, patchMe } = useApp()
  const { data: convs, reload: reloadConvs } = useFetch(`/conversations/?with=${param}`, [tick, param], { poll: 8000 })
  const { data: mylinks, reload: reloadLinks } = useFetch('/links/')
  const [msgs, setMsgs] = useState([])
  const [resetKey, setResetKey] = useState(0)     // bumps to clear the message box (the box keeps its own text, so typing doesn't redraw the whole chat)
  const [busy, setBusy] = useState(false)
  const end = useRef()
  const [toBoard, setToBoard] = useState(null)
  const [q, setQ] = useState('') // filters the messages shown
  const [view, setViewState] = useState(() => { try { return localStorage.getItem('opio.chatview') === 'list' ? 'list' : 'cards' } catch { return 'cards' } })
  const setView = (v) => { setViewState(v); try { localStorage.setItem('opio.chatview', v) } catch { /* ignore */ } }
  const [toFriend, setToFriend] = useState(null)
  const [qrMode, setQrMode] = useState(false)       // the QR sign before the box: what you type is sent as a QR code
  const [shown, setShown] = useState(null)          // the QR message being read: { m, text }. Tapping the chat box to reply turns it back into its code
  const [qrPrivate, setQrPrivate] = useState(!!user.qr_private)  // (the default comes from Chat settings) QR privacy: the message destroys itself once the other person has viewed it
  const [setOpen, setSetOpen] = useState(false)      // the chat settings
  const [plusOn, setPlusOn] = useState(false)         // the + is open: the picker for links, boards and cards (the QR sign is hidden meanwhile)
  const sendMany = async (items) => {               // everything picked goes out as link messages (boards and cards with their own name and picture)
    try {
      for (const [i, payload] of items.entries()) await api.post(`/messages/${uid}/`, { ...payload, ...(i === 0 && replyTo ? { reply_to: replyTo.id } : {}) })
      setReplyTo(null); setPlusOn(false); await load(); reloadConvs()
    } catch (x) { toast(errMsg(x)); load() }
  }
  const [replyTo, setReplyTo] = useState(null)       // the message the next one answers: { id, from, title }
  const box = useRef(null)
  const startReply = (m) => {                       // long press, or Reply in the 3 dots
    if (m.kind === 'board_invite') return
    setReplyTo({ id: m.id, from: m.from, title: m.kind === 'qr' ? 'QR message' : m.title || m.url })
    setTimeout(() => box.current?.focus(), 0)
  }
  const conv = (convs || []).find((c) => String(c.user.id) === param || c.user.username.toLowerCase() === String(param).toLowerCase())
  const uid = conv ? String(conv.user.id) : (/^\d+$/.test(param) ? param : '')      // the number the server works with
  // an address with a name that isn't someone you can chat with goes back to the Inbox
  useEffect(() => { if (convs && !conv) { toast('That chat isn’t available.'); nav('/inbox', { replace: true }) } }, [convs, conv]) // eslint-disable-line
  // the address shows the person's name, not a number (a username that is all digits keeps its number)
  useEffect(() => { if (conv && /^\d+$/.test(param) && !/^\d+$/.test(conv.user.username)) nav(`/inbox/${conv.user.username}`, { replace: true }) }, [conv?.user.id, param]) // eslint-disable-line
  const other = conv?.user


  const lock = async () => {
    const r = await toggleLock({ kind: 'chat', target: uid, locked: !!conv?.locked, ask, toast })
    if (r !== null) reloadConvs()
  }
  const block = async () => {
    if (!(await confirm({ title: 'Block this user?', message: 'They will disappear from your OPALS and messages.', label: 'Block' }))) return
    try { await api.post('/blocks/', { user_id: Number(uid) }); toast('Blocked'); refresh(); nav('/inbox') } catch (x) { toast(errMsg(x)) }
  }

  // Top bar: who you're chatting with (tap for their profile) + lock / block
  const shownName = other ? other.nickname || other.name : ''
  useTopBar({
    back: () => nav('/inbox'), hideTabs: true,
    center: <>OPIOW<span>.</span></>,
    left: other && (
      <button className="tuser" onClick={() => nav(`/u/${other.username}`)} aria-label={`View ${shownName}'s profile`}>
        <Avatar u={other} />
      </button>
    ),
    right: other && (
      <>
        <button className="cbtn" aria-label={conv?.locked ? 'Remove chat lock' : 'Lock chat'} onClick={lock}><Lock size={18} /></button>
        <button className="cbtn" aria-label="Block user" onClick={block}><Warn size={18} /></button>
      </>
    ),
  }, [other?.id, other?.name, other?.nickname, other?.photo, conv?.locked])

  const load = useCallback(async () => {
    if (!uid) return                                   // the person is still being looked up from the address
    try { const { data } = await api.get(`/messages/${uid}/`); setMsgs((prev) => keepIfSame(prev, data)) }
    catch (e) {
      if (isLocked(e)) { (await unlockWithPin({ kind: 'chat', target: uid, ask, toast })) ? load() : nav('/inbox') }
      else if (e?.response?.status === 403 || e?.response?.status === 404) { toast(errMsg(e)); nav('/inbox') }
    }
  }, [uid]) // eslint-disable-line
  useEffect(() => {
    load()
    const tick = () => { if (!document.hidden) load() }
    const t = setInterval(tick, 2500)
    document.addEventListener('visibilitychange', tick)
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', tick) }
  }, [load])
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }) }, [msgs.length])
  useEffect(() => { document.body.classList.add('in-chat'); return () => document.body.classList.remove('in-chat') }, [])
  useEffect(() => { if (msgs.length) loadCounts() }, [msgs.length]) // opening the chat marks them read; update the Inbox badge

  const send = async (url) => {               // returns true when it went out, so the box can clear itself
    if (!url.trim()) return false
    if (qrMode && wordCount(url) > QR_WORDS) { toast(`A QR message can be up to ${QR_WORDS} words.`); return false }
    setBusy(true)
    // QR mode: what you type goes out as a QR code; the other person taps it to read the message and reply
    try { await api.post(`/messages/${uid}/`, { ...(qrMode ? { qr_text: url, private: qrPrivate } : { url }), ...(replyTo ? { reply_to: replyTo.id } : {}) }); setReplyTo(null); setShown(null); await load(); reloadConvs(); return true }
    catch (x) { toast(errMsg(x)); return false } finally { setBusy(false) }
  }
  // your own QR message can be read again; one sent to you opens once, and the words only come when you open it
  const openQr = async (m) => {
    if (shown?.m.id === m.id) return                                   // already showing
    if (m.from === user.id) return setShown({ m, text: m.note })
    if (m.opened) return toast('This message has already been opened.')
    try {
      const { data } = await api.post(`/messages/${uid}/${m.id}/open/`)
      // the words show in the chat; the box switches to QR mode, is set to reply to this message and the cursor waits in it
      setShown({ m, text: data.note }); setQrMode(true); setResetKey((k) => k + 1); startReply(m); load()
    } catch (x) { toast(errMsg(x)); load() }
  }
  // while a QR message is open: tapping anywhere else turns it back into its code (the reply box and the message itself are fine to tap),
  // and the usual ways of capturing the screen close it. A web page can't truly block screenshots; this is a best effort.
  useEffect(() => {
    if (!shown) return undefined
    const away = (e) => { if (!e.target.closest('.qrshown, .compose, .replybar, .cmenu')) setShown(null) }
    const hide = () => setShown(null)
    const vis = () => { if (document.hidden) setShown(null) }
    const key = (e) => {
      const k = e.key
      if (k === 'PrintScreen' || ((e.ctrlKey || e.metaKey) && (k === 'p' || k === 'P')) || (e.metaKey && e.shiftKey && ['3', '4', '5'].includes(k))) {
        try { navigator.clipboard.writeText('') } catch { /* no clipboard */ }
        setShown(null)
      }
    }
    document.addEventListener('pointerdown', away)
    window.addEventListener('blur', hide)
    document.addEventListener('visibilitychange', vis)
    window.addEventListener('keydown', key)
    window.addEventListener('keyup', key)
    return () => {
      document.removeEventListener('pointerdown', away); window.removeEventListener('blur', hide)
      document.removeEventListener('visibilitychange', vis); window.removeEventListener('keydown', key); window.removeEventListener('keyup', key)
    }
  }, [shown])
  const saveAutoDelete = async (patch) => {
    try { await patchMe({ auto_delete: patch }); toast('Chat settings saved') } catch (x) { toast(errMsg(x)) }
  }
  const saved = useMemo(() => new Set((mylinks || []).map((l) => norm(l.url))), [mylinks])
  const save = async (m) => {
    try { await api.post('/links/save/', { url: m.url, title: m.title, image: m.image, from_user_id: other?.id }); toast('Saved'); reloadLinks(); refresh() }
    catch (x) { toast(errMsg(x)) }
  }
  const delAll = async (m) => {
    if (!(await confirm({ title: 'Delete for everyone?', message: 'It is removed from your chat and from theirs.', label: 'Delete for all' }))) return
    try { await api.delete(`/messages/${uid}/${m.id}/?all=1`); setMsgs((prev) => prev.filter((x) => x.id !== m.id)); if (shown?.m.id === m.id) setShown(null); toast('Deleted for everyone'); reloadConvs(); loadCounts() }
    catch (x) { toast(errMsg(x)) }
  }
  const del = async (m) => {
    if (!(await confirm({ title: 'Delete this message?', message: 'It is removed from your chat only. The other person keeps their copy.', label: 'Delete' }))) return
    try { await api.delete(`/messages/${uid}/${m.id}/`); setMsgs((prev) => prev.filter((x) => x.id !== m.id)); toast('Deleted'); reloadConvs(); loadCounts() }
    catch (x) { toast(errMsg(x)) }
  }
  const respond = async (m, action) => {
    try { await api.post(`/invites/${m.invite.id}/${action}/`); toast(action === 'accept' ? 'Joined the board' : 'Declined'); load(); refresh() }
    catch (x) { toast(errMsg(x)) }
  }
  // search filters the chat: link title, site, address and note
  const needle = q.trim().toLowerCase()
  const shownMsgs = needle ? msgs.filter((m) => `${m.title} ${m.url} ${m.note || ''}`.toLowerCase().includes(needle)) : msgs
  if (!other) return <Skel />
  return (
    <div className="chat open">
      {/* PC: profile details on the left (on phones this info is in the top bar) */}
      <aside className="cside">
        <Avatar big u={other} />
        <b className="cs-name">{shownName}</b>
        <small className="cs-user">@{other.username}</small>
        {other.nickname && <small className="cs-user">{other.name}</small>}
        <button className="ghost" onClick={() => nav(`/u/${other.username}`)}>View profile</button>
        <button className="ghost" onClick={lock}><Lock size={16} /> {conv.locked ? 'Remove chat lock' : 'Lock chat'}</button>
        <button className="ghost danger" onClick={block}><Warn size={16} /> Block</button>
      </aside>
      <section className="cmain">
        <div className="cview" role="group" aria-label="Search and view">
          <SearchBar value={q} onChange={setQ} placeholder="Search this chat" />
          <button type="button" className="ghost ibtn chatset" aria-label="Chat settings" title="Chat settings" onClick={() => setSetOpen(true)}>⚙</button>
          <div className="views">
            <button className={view === 'list' ? 'on' : ''} onClick={() => setView('list')} aria-label="List view" title="List"><ListI /></button>
            <button className={view === 'cards' ? 'on' : ''} onClick={() => setView('cards')} aria-label="Card view" title="Cards"><Grid4 /></button>
          </div>
        </div>
        <div className="msgs">
          {!msgs.length && <div className="cnone">No messages yet. Paste a link below.</div>}
          {msgs.length > 0 && !shownMsgs.length && <div className="cnone">Nothing in this chat matches “{q.trim()}”.</div>}
          {shownMsgs.map((m) => <Press key={m.id} mine={m.from === user.id} quote={m.reply} who={shownName} meId={user.id} onLong={() => startReply(m)}>{(() => {
            const mine = m.from === user.id
            if (m.kind === 'board_invite') {
              const st = m.invite?.status
              return (
                <div key={m.id} className="msg invite">
                  <b>Board Collab Invite from “{other.nickname || other.name}”</b>
                  <small>Board: {m.title} · {m.invite?.role === 'view' ? 'view only' : 'can edit'}</small>
                  <div className="invrow">
                    {st === 'pending' ? (
                      <>
                        <button className="ib ok" aria-label="Accept" onClick={() => respond(m, 'accept')}><Check size={18} /></button>
                        <button className="ib no" aria-label="Reject" onClick={() => respond(m, 'decline')}><X size={18} /></button>
                      </>
                    ) : <small>{st === 'accepted' ? 'Accepted' : 'Declined'}</small>}
                    <button className="ib" aria-label="View board" onClick={() => nav(`/boards/${m.invite.board_id}`)}><Eye size={18} /></button>
                  </div>
                </div>
              )
            }
            if (m.kind === 'qr') return <QrMessage key={m.id} m={m} mine={mine} view={view} watermark="Me" sender={mine ? user : other} text={shown?.m.id === m.id ? shown.text : null} onOpen={() => openQr(m)} onReply={() => startReply(m)} onDelete={() => del(m)} onDeleteAll={() => delAll(m)} onSettings={() => setSetOpen(true)} />
            return <ChatCard key={m.id} m={m} mine={mine} view={view} who={shownName} isSaved={saved.has(norm(m.url))} onSave={() => save(m)} onView={() => (m.url.startsWith(location.origin) ? nav(m.url.slice(location.origin.length)) : setViewer({ url: m.url, title: m.title, image: m.image, host: hostOf(m.url), description: '' }))}
              onBoard={() => setToBoard({ title: m.title, body: { url: m.url, title: m.title, from_user_id: other.id } })} onShare={() => setToFriend({ url: m.url, title: m.title })} onReply={() => startReply(m)} onDelete={() => del(m)} />
          })()}</Press>)}
          {/* a private message is already gone from the server once read; it stays on screen until you tap the box to reply */}
          {shown && !msgs.some((x) => x.id === shown.m.id) && <QrMessage m={shown.m} mine={false} view={view} watermark="Me" sender={other} text={shown.text} onOpen={() => {}} onReply={() => startReply(shown.m)} onDelete={() => setShown(null)} onSettings={() => setSetOpen(true)} />}
          <div ref={end} />
        </div>
        {replyTo && (
          <div className="replybar">
            <span>↩ Replying to <b>{replyTo.from === user.id ? 'Me' : shownName}</b>: {clipWords(replyTo.title, 8)}</span>
            <button type="button" aria-label="Cancel reply" onClick={() => setReplyTo(null)}><X size={16} /></button>
          </div>
        )}
        <Composer box={box} qrMode={qrMode} plusOn={plusOn} busy={busy} resetKey={resetKey} onSend={send} onToggleQr={() => setQrMode((v) => !v)} onPlus={() => setPlusOn(true)} />
      </section>
      <PickBoardModal payload={toBoard} onClose={() => setToBoard(null)} />
      <PickFriendModal link={toFriend} onClose={() => setToFriend(null)} />
      {plusOn && <AttachModal onSend={sendMany} onClose={() => setPlusOn(false)} />}
      {setOpen && <ChatSettingsModal ad={user.auto_delete || {}} onChange={saveAutoDelete} qrPrivate={!!user.qr_private} onQrPrivate={async (v) => { try { await patchMe({ qr_private: v }); setQrPrivate(v); toast('Chat settings saved') } catch (x) { toast(errMsg(x)) } }} onClose={() => setSetOpen(false)} />}
    </div>
  )
}

/* The message box. It keeps what you type in its own state, so each keystroke redraws only this box and not every message above it. */
const Composer = memo(function Composer({ box, qrMode, plusOn, busy, resetKey, onSend, onToggleQr, onPlus }) {
  const [url, setUrl] = useState('')
  useEffect(() => { setUrl('') }, [qrMode, resetKey])
  const submit = async (e) => { e.preventDefault(); if (await onSend(url)) setUrl('') }
  return (
    <form className="compose" onSubmit={submit}>
      {/* the QR sign is outside the bar; the + sits inside the bar, on its left. They take turns: using one hides the other */}
      {!plusOn && <button type="button" className={`ghost ibtn qrsign ${qrMode ? 'on' : ''}`} aria-pressed={qrMode} aria-label="Send a message as a QR code" title={qrMode ? 'QR message on. Tap to go back to links' : 'Send a message as a QR code'} onClick={onToggleQr}><QrI size={20} /></button>}
      <div className={`cbar ${qrMode ? '' : 'withplus'}`}>
        {!qrMode && <button type="button" className="cplus" aria-label="Add links, boards or cards" title="Add links, boards or cards" onClick={onPlus}>+</button>}
        {qrMode
          ? <input ref={box} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="QR code Chat" className={wordCount(url) > QR_WORDS ? 'over' : ''} />
          : <input ref={box} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Paste a link" inputMode="url" autoCapitalize="none" />}
      </div>
      <button className="solid" disabled={busy}>{busy ? '…' : 'Send'}</button>
    </form>
  )
})

/* a message sent as a QR code: the code is what shows in the chat; tap it to read the message */
function useQrImage(text, margin = 1) {
  const [img, setImg] = useState('')
  useEffect(() => {
    let live = true
    import('qrcode').then((m) => m.default.toDataURL(text, { margin, width: 300 })).then((d) => live && setImg(d)).catch(() => live && setImg(''))
    return () => { live = false }
  }, [text, margin])
  return img
}

// the code only carries a reference: the words reach the other person when they open it (once)
const qrToken = (m) => `OPIOW message ${m.id}`
const QR_WORDS = 100
const wordCount = (t) => t.trim().split(/\s+/).filter(Boolean).length

function QrMessage({ m, mine, sender, text, view, watermark, onOpen, onReply, onDelete, onDeleteAll, onSettings }) {
  const img = useQrImage(qrToken(m), 0)     // no border around the code
  const [openMenu, menuEl] = usePopupMenu()
  // a QR message can be replied to and deleted (for you, or for everyone if you sent it), never forwarded; Settings opens the QR privacy options
  const dots = <button className="dots" aria-label="More options" onClick={(e) => openMenu(e, [
    { label: 'Reply', fn: onReply },
    { label: 'Delete', danger: true, fn: onDelete },
    ...(mine && onDeleteAll ? [{ label: 'Delete for all', danger: true, fn: onDeleteAll }] : []),
    { label: 'Settings', fn: onSettings },
  ])}><Dots /></button>
  const fresh = !mine && !m.opened && text === null          // new for you and not opened yet: it shakes, with Open under it
  const bubble = (
    <span className="qrfrom" title={mine ? 'Me' : sender.nickname || sender.name}><Avatar u={sender} /></span>   // a small bubble at the bottom left shows who sent it
  )
  if (text !== null) {
    // opened: the words show here and stay while you reply; tapping anywhere else turns it back into its code.
    // A faint watermark with the reader's name sits behind the words, and selecting or copying them is switched off.
    const mark = `url("data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='170' height='90'><text x='6' y='52' font-size='13' font-family='sans-serif' fill='white' fill-opacity='0.09' transform='rotate(-18 85 45)'>${watermark}</text></svg>`)}")`
    return (
      <div className={`msg qrmsg qrshown ${mine ? 'mine' : ''}`} onContextMenu={(e) => e.preventDefault()} onCopy={(e) => e.preventDefault()}>
        <div className="qrwords" style={{ backgroundImage: mark }}><p>{text}</p>{bubble}</div>
        <small className="qrstate">{mine ? 'Tap anywhere else and it turns back into a code' : 'Reply below. Tap anywhere else and it turns back into a code'}</small>
        {dots}{menuEl}
      </div>
    )
  }
  return (
    <div className={`msg qrmsg qr-${view === 'list' ? 'list' : 'cards'} ${mine ? 'mine' : ''} ${fresh ? 'fresh' : ''} ${m.opened && !mine ? 'done' : ''}`}>
      <button type="button" className="qrthumb" onClick={onOpen} aria-label={fresh ? 'Open the message' : 'QR message'}>
        {img ? <img alt="QR code message" src={img} /> : <span>…</span>}
        {bubble}
      </button>
      {fresh && <b className="qropen">Open</b>}
      {!fresh && !mine && <small className="qrstate">Opened</small>}
      {mine && m.private && <small className="qrstate">Private</small>}
      {dots}{menuEl}
    </div>
  )
}


/* Chat settings: links, QR codes and boards can each disappear after a number of days, or all together */
function ChatSettingsModal({ ad, onChange, qrPrivate, onQrPrivate, onClose }) {
  return (
    <Modal onClose={onClose} className="center">
      <div className="sheet chatsettings" style={{ position: 'relative' }}>
        <button className="qrx" onClick={onClose} aria-label="Close"><X size={18} /></button>
        <h2>Chat settings</h2>
        <ChatSettingsPanel ad={ad} onChange={onChange} qrPrivate={qrPrivate} onQrPrivate={onQrPrivate} />
        <div className="btns"><button onClick={onClose}>Done</button></div>
      </div>
    </Modal>
  )
}
/* the + in the chat box: search your links, boards or cards (toggle between them), tick as many as you like and send them together.
   Only public boards can be sent as a link; a private one goes as an invite from the board. */
function AttachModal({ onSend, onClose }) {
  const [tab, setTab] = useState('links')
  const [q, setQ] = useState('')
  const [picked, setPicked] = useState({})            // key -> { url, title, image }; stays ticked when you switch the toggle
  const [busy, setBusy] = useState(false)
  const { data: links, loading: l1 } = useFetch('/links/', [])
  const { data: boards, loading: l2 } = useFetch('/boards/', [])
  const { data: cards, loading: l3 } = useFetch('/linkpage/', [])
  const all = {
    links: (links || []).map((l) => ({ key: `l${l.id}`, name: l.title || l.url, sub: l.host, payload: { url: l.url, title: l.title, image: l.image && l.image.startsWith('http') ? l.image : '' } })),
    boards: (boards || []).filter((b) => b.is_owner && b.is_public).map((b) => ({ key: `b${b.id}`, name: `${b.emoji ? b.emoji + ' ' : ''}${b.name}`, sub: `Board · ${b.link_count} links`, payload: { url: `${location.origin}/boards/${b.owner.username}/${b.slug}`, title: b.name, image: (b.image || b.preview || '').startsWith('http') ? (b.image || b.preview) : '' } })),
    cards: (cards?.pages || []).map((p) => ({ key: `c${p.id}`, name: p.name || p.handle, sub: `Card · /${p.handle}/ocard`, payload: { url: `${location.origin}/${p.handle}/ocard`, title: p.name || p.handle, image: '' } })),
  }
  const needle = q.trim().toLowerCase()
  const rows = all[tab].filter((r) => !needle || `${r.name} ${r.sub}`.toLowerCase().includes(needle))
  const loading = tab === 'links' ? l1 : tab === 'boards' ? l2 : l3
  const count = Object.keys(picked).length
  const toggle = (r) => setPicked((p) => { const n = { ...p }; if (n[r.key]) delete n[r.key]; else n[r.key] = r.payload; return n })
  const send = async () => { if (!count || busy) return; setBusy(true); await onSend(Object.values(picked)); setBusy(false) }
  const empty = tab === 'links' ? 'No links yet.' : tab === 'boards' ? 'You have no public boards to send. Make a board public first.' : 'You have no cards yet. Create one in OCARD first.'
  return (
    <Modal onClose={onClose} className="center">
      <div className="sheet attachsheet" style={{ position: 'relative' }}>
        <button className="qrx" onClick={onClose} aria-label="Close"><X size={18} /></button>
        <h2>Send to this chat</h2>
        <Seg value={tab} onChange={setTab} options={[['links', 'Links'], ['boards', 'Boards'], ['cards', 'Cards']]} />
        <input type="search" className="attachsearch" value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${tab}`} autoCapitalize="none" spellCheck={false} />
        {loading && <p>Loading…</p>}
        {!loading && !rows.length && <p>{needle ? `Nothing matches “${q.trim()}”.` : empty}</p>}
        <div className="attachlist">
          {rows.map((r) => (
            <button key={r.key} type="button" className={`bpitem attachrow ${picked[r.key] ? 'on' : ''}`} aria-pressed={!!picked[r.key]} onClick={() => toggle(r)}>
              <span className="attachtick">{picked[r.key] ? <Check size={14} /> : null}</span>
              <span className="attachtxt"><b>{clipWords(r.name, 8)}</b><small>{r.sub}</small></span>
            </button>
          ))}
        </div>
        <div className="btns"><button onClick={onClose}>Cancel</button><button className="go" disabled={!count || busy} onClick={send}>{busy ? '…' : count ? `Send ${count}` : 'Send'}</button></div>
      </div>
    </Modal>
  )
}

/* long press a message to reply to it; the quote of what it answers shows above it */
function Press({ mine, quote, who, meId, onLong, children }) {
  const t = useRef(null)
  const held = useRef(false)
  const p0 = useRef(null)
  const start = (e) => { p0.current = { x: e.clientX, y: e.clientY }; held.current = false; clearTimeout(t.current); t.current = setTimeout(() => { held.current = true; haptic(15); onLong() }, 500) }
  const move = (e) => { if (p0.current && Math.hypot(e.clientX - p0.current.x, e.clientY - p0.current.y) > 10) clearTimeout(t.current) }
  const end = () => clearTimeout(t.current)
  return (
    <div style={{ display: 'contents' }} onPointerDown={start} onPointerMove={move} onPointerUp={end} onPointerCancel={end} onPointerLeave={end}
      onClickCapture={(e) => { if (held.current) { held.current = false; e.stopPropagation(); e.preventDefault() } }}>
      {quote && <div className={`replyq ${mine ? 'mine' : ''}`}>↩ <b>{quote.from === meId ? 'Me' : who}</b>: {clipWords(quote.title, 8)}</div>}
      {children}
    </div>
  )
}

/* A link sent in chat: photo on the left; site, title, note, buttons and the 3-dots menu on the right */
function ChatCard({ m, mine, view, who, isSaved, onSave, onView, onBoard, onShare, onReply, onDelete }) {
  const [openMenu, menuEl] = usePopupMenu()
  const [qrOpen, setQrOpen] = useState(false)
  const { toast } = useApp()
  const host = hostOf(m.url)
  const copy = async () => { try { await navigator.clipboard.writeText(m.url); toast('Link copied') } catch { toast(m.url) } }
  const shareOut = async () => {
    if (navigator.share) { try { await navigator.share({ title: m.title, url: m.url }) } catch { /* cancelled */ } return }
    copy()
  }
  const items = [
    { label: 'Reply', fn: onReply },
    ...(mine || isSaved ? [] : [{ label: 'Save', fn: onSave }]),
    { label: 'Save to board', fn: onBoard },
    { label: 'Forward', fn: onShare },
    { label: 'Share', fn: shareOut },
    { label: 'QR code', fn: () => setQrOpen(true) },
    { label: 'Copy link', fn: copy },
    { label: 'Open in browser', fn: () => window.open(m.url, '_blank', 'noopener,noreferrer') },
    { label: 'Delete', danger: true, fn: onDelete },
  ]
  const list = view === 'list'
  if (list) {
    return (
      <div className={`msg lrow ${mine ? 'mine' : ''}`}>
        <div className="lthumb" onClick={onView}>
          <span className="ml">{(host || '?')[0].toUpperCase()}</span>
          {m.image && <img alt="" src={m.image} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={(e) => (e.currentTarget.style.display = 'none')} />}
        </div>
        <div className="ltxt" onClick={onView}>
          <b title={m.title}>{clipWords(m.title, 6)}</b>
          <small className="lwho">{mine ? `Me → ${who}` : `${who} → Me`}</small>
          <small>{host}</small>
        </div>
        {!mine && !isSaved && <button className="lsave" onClick={onSave}>Save</button>}
        {!mine && isSaved && <span className="lsaved">Saved ✓</span>}
        <button className="dots" aria-label="More options" onClick={(e) => openMenu(e, items)}><Dots /></button>
        {menuEl}
        <QrModal open={qrOpen} url={m.url} title={m.title || 'Link'} hint="Scan to open this link" onClose={() => setQrOpen(false)} />
      </div>
    )
  }
  return (
    <div className={`msg lcard ${mine ? 'mine' : ''}`}>
      <div className="mthumb" onClick={onView}>
        <span className="ml">{(host || '?')[0].toUpperCase()}</span>
        {m.image && <img className="mi" alt="" src={m.image} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={(e) => (e.currentTarget.style.display = 'none')} />}
      </div>
      <div className="minfo">
        <div className="mtop">
          <div className="mtxt"><b title={m.title} onClick={onView}>{clipWords(m.title, 1)}</b><small>{host}</small></div>
          <button className="dots" aria-label="More options" onClick={(e) => openMenu(e, items)}><Dots /></button>
        </div>
        {m.note && <div className="note">{m.note}</div>}
        <div className="mb">
          <button onClick={onView}>Preview</button>
          {!mine && (isSaved ? <button className="saved" disabled>Saved ✓</button> : <button className="msave" onClick={onSave}>Save</button>)}
          {mine && <a href={m.url} target="_blank" rel="noopener noreferrer">Open</a>}
        </div>
      </div>
      {menuEl}
      <QrModal open={qrOpen} url={m.url} title={m.title || 'Link'} hint="Scan to open this link" onClose={() => setQrOpen(false)} />
    </div>
  )
}
