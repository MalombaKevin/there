import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import CardStatsModal from '../components/CardStatsModal'
import OCardGuide from '../components/OCardGuide'
import { useBlocker, useLocation, useNavigate, useParams } from 'react-router-dom'
import { api, errMsg, readImage, thum } from '../api'
import { useBack } from '../routing'
import { Avatar, BoardCover, Modal, Seg, Skel, usePopupMenu } from '../components/ui'
import { PickBoardModal, PickFriendModal, QrModal } from '../components/LazyModals'
import { useApp, useFetch, useTopBar } from '../context'
import { useNameCheck } from '../lib'
import { BulbI, CardI, Eye, EyeOff, Gear, Grid4, ListI, Pen, Trash, Warn } from '../icons'
import { LinkIcon, SOCIALS } from '../socials'
import { colorOf, solidBg } from '../cardbg'

const MAX_WORDS = 28
const MAX_PER_TAB = 6
const TAB_NAME_MAX = 12  // letters in a tab name
const MAX_TAB_WORDS = 14  // words in a tab's optional description
const words = (t) => t.trim().split(/\s+/).filter(Boolean).length
const pathOf = (handle) => `/${handle}/ocard`            // a card's address is  yoursite.com/<name>/ocard
const addressOf = (handle) => `${location.origin}${pathOf(handle)}`
/* On a PC the add list shows short names: at most 2 words and 12 letters */
const shortName = (t = '') => { const w = t.trim().split(/\s+/).slice(0, 2).join(' '); return w.length > 12 ? `${w.slice(0, 12).trimEnd()}…` : w }
const hostOf = (url) => { try { return new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname.replace(/^www\./, '') } catch { return '' } }
const newId = () => Math.random().toString(36).slice(2, 10)
// a board's own picture can be large: shrink it to an icon. Pictures given by address are kept as they are.
const toIcon = (src) => new Promise((res) => {
  if (!src || !src.startsWith('data:image/')) return res(src || '')
  if (src.length < 40000) return res(src)
  const im = new Image()
  im.onerror = () => res('')
  im.onload = () => {
    const n = Math.min(im.width, im.height), c = document.createElement('canvas')
    c.width = c.height = 128
    c.getContext('2d').drawImage(im, (im.width - n) / 2, (im.height - n) / 2, n, n, 0, 0, 128, 128)
    res(c.toDataURL('image/jpeg', 0.8))
  }
  im.src = src
})
// tell the card's owner's analytics about a view, a click on one of its links, or a share (never blocks anything)
const track = (handle, kind, item) => { api.post(`/l/${encodeURIComponent(handle)}/event/`, { kind, item }).catch(() => {}) }
const tabLabel = (t) => `${t.icon ? t.icon + ' ' : ''}${t.name}`

/* The tab bar. Four tabs per row: when there are more than four, the rest start a new bar underneath. */
function TabBars({ options, value, onChange }) {
  const rows = []
  for (let i = 0; i < options.length; i += 4) rows.push(options.slice(i, i + 4))
  return rows.map((row, r) => <Seg key={r} value={row.some(([v]) => v === value) ? value : null} onChange={onChange} options={row} />)
}

/* The tab bar in the editor: tap a tab to open it, drag it to a new place to reorder. Four per row, like the live card. */
function EditTabBars({ tabs, at, onSelect, onMove }) {
  const drag = useRef(null)
  const [dragging, setDragging] = useState(-1)
  const [ghost, setGhost] = useState(null)       // the tab being carried, drawn under the finger / cursor
  const rows = []
  for (let i = 0; i < tabs.length; i += 4) rows.push(tabs.slice(i, i + 4).map((t, k) => [i + k, t]))
  const down = (e, i) => {
    if (e.button) return
    drag.current = { i, x: e.clientX, y: e.clientY, moved: false, label: tabs[i].name || 'New tab', w: e.currentTarget.offsetWidth, h: e.currentTarget.offsetHeight }
    const move = (ev) => {
      const d = drag.current
      if (!d) return
      if (!d.moved && Math.hypot(ev.clientX - d.x, ev.clientY - d.y) < 8) return
      d.moved = true; setDragging(d.i)
      setGhost({ x: ev.clientX, y: ev.clientY, label: d.label, w: d.w, h: d.h })
      const el = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('[data-tabi]')
      const j = el ? Number(el.dataset.tabi) : -1
      if (j >= 0 && j !== d.i) { onMove(d.i, j); d.i = j; setDragging(j) }
    }
    const up = () => {
      const d = drag.current
      drag.current = null; setDragging(-1); setGhost(null)
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up)
      if (d && !d.moved) onSelect(d.i)
    }
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up)
  }
  const key = (e, i) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(i) }
    else if (e.altKey && e.key === 'ArrowLeft' && i > 0) { e.preventDefault(); onMove(i, i - 1) }
    else if (e.altKey && e.key === 'ArrowRight' && i < tabs.length - 1) { e.preventDefault(); onMove(i, i + 1) }
  }
  return <>{rows.map((row, r) => (
    <div className="seg pseg dragtabs" key={r}>
      {row.map(([i, t]) => (
        <button key={t.key} type="button" data-tabi={i} className={`${at === i ? 'on' : ''} ${t.hidden ? 'hid' : ''} ${dragging === i ? 'drag' : ''}`}
          onPointerDown={(e) => down(e, i)} onKeyDown={(e) => key(e, i)}>
          {t.name || 'New tab'}{t.hidden ? ' 🚫' : ''}
        </button>
      ))}
    </div>
  ))}
  {ghost && <div className="tabghost" style={{ left: ghost.x, top: ghost.y, width: ghost.w, height: ghost.h }}>{ghost.label}</div>}
  </>
}

/* The ready-made preview pictures a link can use (the carousel in the link editor); "" means the picture comes from the link itself */
const COVERS = [['sunset', 'Sunset'], ['ocean', 'Ocean'], ['forest', 'Forest'], ['berry', 'Berry'], ['gold', 'Gold'], ['night', 'Night'], ['mint', 'Mint']]
const MAX_LINK_WORDS = 12
const MAX_SOCIALS = 8      // icon-only social links under the card's description
// the top social sites people can add (the keys are the icon names in socials.jsx)
const TOP_SOCIALS = ['instagram', 'facebook', 'x', 'youtube', 'tiktok', 'linkedin', 'whatsapp', 'telegram', 'snapchat', 'github', 'pinterest', 'threads', 'discord', 'twitch', 'spotify', 'reddit']
const socialName = (k) => (k === 'custom' ? 'Link' : SOCIALS.find((x) => x.key === k)?.name || k)

/* The picture of a preview card: the chosen one (ready-made, uploaded), else the page picture taken from the link, else the site's initial on a colour */
function CoverPic({ cover, url, name }) {
  const [broken, setBroken] = useState(false)
  useEffect(() => { setBroken(false) }, [cover, url])
  if (cover && cover.startsWith('preset:')) return <div className={`mlcover cv-${cover.slice(7)}`}><span>{(name || hostOf(url) || '?')[0].toUpperCase()}</span></div>
  const src = cover || (url ? thum(url) : '')
  if (!src || broken) return <div className="mlcover cv-auto"><span>{(hostOf(url) || name || '?')[0].toUpperCase()}</span></div>
  return <div className="mlcover"><img src={src} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)} /></div>
}

/* One link on a card: icon, name and site (or, when its owner chose it, a preview card with a picture and a short description). Opens in a new tab. */
function LinkCard({ l, onOpen }) {
  const [playing, setPlaying] = useState(false)
  const video = videoOf(l.url)
  const card = l.preview ? (
    <a className="mlcard mlprevcard" href={l.url} target="_blank" rel="noopener noreferrer" onClick={() => onOpen?.(l)}>
      <CoverPic cover={l.cover} url={l.url} name={l.name} />
      <span className="mlpbody"><b>{l.name}</b>{l.desc && <em>{l.desc}</em>}<small>{hostOf(l.url)}</small></span>
    </a>
  ) : (
    <a className="mlcard" href={l.url} target="_blank" rel="noopener noreferrer" onClick={() => onOpen?.(l)}>
      <LinkIcon icon={l.icon} host={hostOf(l.url)} />
      <span><b>{l.name}</b><small>{hostOf(l.url)}</small></span>
    </a>
  )
  if (!video) return card
  // a video link can be played right here on the card
  return (
    <div className="mlvid">
      {card}
      <button type="button" className="mlvidbtn" aria-label={playing ? 'Close video' : 'Play video'} onClick={() => { if (!playing) onOpen?.(l); setPlaying(!playing) }}>{playing ? '✕' : '▶'}</button>
      {playing && <div className="mlvidplayer"><StatusVideo v={video} onState={() => {}} /></div>}
    </div>
  )
}

/* Tap the card's picture: the picture itself, then (swipe, or the arrows) the status: links that open directly and boards that open on the OPIOW site */
const SLIDE_MS = 12000     // each slide stays for 12 seconds, unless someone moves on
const VIDEO_PAUSE_MS = 30000   // a video paused for more than 30 seconds moves on

/* A link that is a video: YouTube, Vimeo, or a direct video file */
function videoOf(url = '') {
  let u
  try { u = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`) } catch { return null }
  const h = u.hostname.replace(/^www\./, '').replace(/^m\./, '')
  let m
  if (h === 'youtu.be') m = u.pathname.slice(1).split('/')[0]
  else if (h === 'youtube.com' || h === 'music.youtube.com') m = u.searchParams.get('v') || (u.pathname.match(/^\/(?:shorts|embed|live)\/([\w-]{6,})/) || [])[1]
  if (m && /^[\w-]{6,}$/.test(m)) return { type: 'yt', id: m }
  if (h === 'vimeo.com') { const id = (u.pathname.match(/\/(\d+)/) || [])[1]; if (id) return { type: 'vimeo', id } }
  if (/\.(mp4|webm|ogv|mov|m4v)$/i.test(u.pathname)) return { type: 'file', src: u.href }
  return null
}

/* Plays the video inside the status (time slider, full screen and back are the player's own controls) and reports play / pause / end */
function StatusVideo({ v, onState }) {
  const frame = useRef(null)
  useEffect(() => {
    if (v.type === 'file') return
    const ytOrigin = 'https://www.youtube.com', vmOrigin = 'https://player.vimeo.com'
    const msg = (e) => {
      if (e.source !== frame.current?.contentWindow) return
      let d = e.data
      if (typeof d === 'string') { try { d = JSON.parse(d) } catch { return } }
      if (!d) return
      if (v.type === 'yt') {
        const st = d.event === 'onStateChange' ? d.info : d.event === 'infoDelivery' ? d.info?.playerState : undefined
        if (st === 1 || st === 3) onState('play'); else if (st === 2) onState('pause'); else if (st === 0) onState('end')
      } else {
        if (d.event === 'play') onState('play'); else if (d.event === 'pause') onState('pause'); else if (d.event === 'finish') onState('end')
      }
    }
    window.addEventListener('message', msg)
    const hello = () => {
      const w = frame.current?.contentWindow; if (!w) return
      if (v.type === 'yt') w.postMessage(JSON.stringify({ event: 'listening', id: 1, channel: 'widget' }), ytOrigin)
      else ['play', 'pause', 'finish'].forEach((n) => w.postMessage(JSON.stringify({ method: 'addEventListener', value: n }), vmOrigin))
    }
    const f = frame.current
    f?.addEventListener('load', hello)
    const t = setInterval(hello, 1500)           // keep asking until the player answers
    return () => { window.removeEventListener('message', msg); f?.removeEventListener('load', hello); clearInterval(t) }
  }, [v.type, v.id, v.src]) // eslint-disable-line
  if (v.type === 'file') {
    return <video className="csvideo" src={v.src} controls autoPlay playsInline preload="metadata"
      onPlay={() => onState('play')} onPause={(e) => onState(e.currentTarget.ended ? 'end' : 'pause')} onEnded={() => onState('end')} />
  }
  const src = v.type === 'yt'
    ? `https://www.youtube.com/embed/${v.id}?enablejsapi=1&playsinline=1&rel=0&fs=1&autoplay=1`
    : `https://player.vimeo.com/video/${v.id}?playsinline=1&autoplay=1`
  return <iframe ref={frame} className="csvideo" title="Video" src={src} allow="autoplay; fullscreen; picture-in-picture; encrypted-media" allowFullScreen />
}

export function StoryViewer({ owner, status, onClose }) {
  const slides = [{ kind: 'picture' }, ...status]
  const [i, setI] = useState(0)
  const { user, toast } = useApp()
  const [openMenu, menuEl] = usePopupMenu()
  const [qrOpen, setQrOpen] = useState(false)
  const [toFriend, setToFriend] = useState(null)
  const [toBoard, setToBoard] = useState(null)
  const [optHold, setOptHold] = useState(false)   // the Options menu is open
  const [touched, setTouched] = useState(false)   // any button used on this slide: it stays until you move on yourself
  const paused = touched || qrOpen || !!toFriend || !!toBoard || optHold   // the slide stays while you are using it (menu, code, OPAL list...)
  // the menu closes on a tap anywhere else (a tap on one of its own items is handled in `menu` below)
  useEffect(() => {
    if (!optHold) return
    const off = () => setOptHold(false)
    addEventListener('click', off)
    return () => removeEventListener('click', off)
  }, [optHold])
  const touch = useRef(null)
  // next goes forward (and closes after the last one); back goes to the one before
  const next = () => (i >= slides.length - 1 ? onClose() : setI(i + 1))
  const back = () => setI(Math.max(0, i - 1))
  const [vs, setVs] = useState('idle')            // a video slide: idle (never played), play, pause
  const [playing, setPlaying] = useState(false)   // a video slide shows its picture and a Play button until Play is pressed
  useEffect(() => { setVs('idle'); setPlaying(false); setTouched(false) }, [i])
  const video = slides[i].kind === 'link' ? videoOf(slides[i].url) : null
  useEffect(() => {
    // a video that is playing stays; one never played moves on after 12s; one paused for over 30s moves on; one that ended moves on
    if (video && vs === 'end') { next(); return }     // a video that finished moves on
    if (paused) return
    if (video && vs === 'play') return
    const t = setTimeout(next, video && vs === 'pause' ? VIDEO_PAUSE_MS : SLIDE_MS)
    return () => clearTimeout(t)
  }, [i, vs, paused]) // eslint-disable-line
  useEffect(() => {
    const k = (e) => { if (e.key === 'Escape') onClose(); else if (e.key === 'ArrowRight') next(); else if (e.key === 'ArrowLeft') back() }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }) // eslint-disable-line
  const cur = slides[i]
  const isBoard = cur.kind === 'board'
  // the same options a board or link has on OPIOW; a board's address on this site is relative
  const href = cur.url ? new URL(/^https?:\/\//i.test(cur.url) ? cur.url : cur.url.startsWith('/') ? `${location.origin}${cur.url}` : `https://${cur.url}`).href : ''
  const copy = async () => { try { await navigator.clipboard.writeText(href); toast('Link copied') } catch { toast(href) } }
  const share = async () => {
    if (navigator.share) { try { await navigator.share({ title: cur.title, url: href }) } catch { /* cancelled */ } return }
    copy()
  }
  const sendToOpal = () => {
    if (user) return setToFriend({ title: cur.title, url: href, ...(isBoard ? { board_id: cur.ref } : {}) })
    const to = `/send?url=${encodeURIComponent(href)}&title=${encodeURIComponent(cur.title || '')}`
    toast('Log in to send this to an OPAL'); window.open(`/login?next=${encodeURIComponent(to)}`, '_blank', 'noopener')
  }
  // saving needs an account; your own things are already yours
  const mineItem = !!user && user.id === owner?.id
  const needLogin = () => { toast('Log in to save'); window.open(`/login?next=${encodeURIComponent(location.pathname)}`, '_blank', 'noopener') }
  const saveLink = async () => {
    if (!user) return needLogin()
    try { await api.post('/links/save/', { url: cur.url, title: cur.title, image: cur.image, from_user_id: owner?.id }); toast('Saved') } catch (e) { toast(errMsg(e)) }
  }
  const saveBoard = async () => {
    if (!user) return needLogin()
    try { await api.post(`/boards/${cur.ref}/save/`); toast('Board saved. It updates as the owner updates it.') } catch (e) { toast(errMsg(e)) }
  }
  // the same options a link or board has everywhere else in OPIOW
  const menu = cur.kind === 'picture' ? [] : [
    ...(mineItem ? [] : isBoard
      ? [{ label: 'Save board', fn: saveBoard }]
      : [{ label: 'Save', fn: saveLink }, { label: 'Save to board', fn: () => (user ? setToBoard({ title: cur.title, body: { url: cur.url, title: cur.title, from_user_id: owner?.id } }) : needLogin()) }]),
    { label: 'Send to an OPAL', fn: sendToOpal },
    { label: 'Share', fn: share },
    { label: 'QR code', fn: () => setQrOpen(true) },
    ...(isBoard ? [] : [{ label: 'Copy link', fn: copy }]),
    { label: isBoard ? 'Open board' : 'Open in browser', fn: () => window.open(href, '_blank', 'noopener,noreferrer') },
  ].map((it) => ({ ...it, fn: () => { setOptHold(false); it.fn() } }))
  return (<>
    {createPortal(
    <div className="csview" role="dialog" aria-label="Picture and status"
      onPointerDown={(e) => { touch.current = e.target.closest('.csvideo') ? null : { from: e.clientX } }}
      onPointerUp={(e) => {
        const t = touch.current; touch.current = null
        if (!t) return
        const dx = e.clientX - t.from
        if (Math.abs(dx) > 50) return dx < 0 ? next() : back()                    // a swipe: left shows the next one, right the one before
        if (Math.abs(dx) < 12 && !e.target.closest('a, button')) (e.clientX < window.innerWidth / 2 ? back : next)()   // a tap on the left goes back, on the right goes on. Only the Open button opens anything.
      }}
      onPointerCancel={() => { touch.current = null }}>
      <div className="csbars">{slides.map((_, k) => <span key={k} className={k < i ? 'done' : k === i ? `cur${video && vs !== 'idle' ? ' hold' : paused ? ' freeze' : ''}` : ''}><i key={k === i ? `run${i}` : k} /></span>)}</div>
      <button type="button" className="csx" aria-label="Close" onClick={onClose}>✕</button>
      <div className="csbody" onClickCapture={(e) => { if (e.target.closest('a, button')) setTouched(true) }}>
        {cur.kind === 'picture' ? (
          <div className="cspic">
            <Avatar big plain u={owner} />
            <h2>{owner.name}</h2>
            {status.length > 0 && <small>Tap the right side, or swipe, to see the status</small>}
          </div>
        ) : (
          <div className="cscard">
            {video && playing ? <span className="csimg csplay"><StatusVideo key={cur.id} v={video} onState={setVs} /></span> : <span className="csimg">{cur.image ? <img alt="" src={cur.image} referrerPolicy="no-referrer" draggable={false} onError={(e) => (e.currentTarget.style.visibility = 'hidden')} /> : <LinkIcon icon={isBoard ? 'board' : ''} host={cur.host} size={96} />}</span>}
            <b>{cur.title}</b>
            <small>{isBoard ? 'A board on OPIOW' : cur.host}</small>
            <div className="csbtns">
              {video
                ? !playing && <button type="button" className="csgo" onClick={() => setPlaying(true)}>▶ Play</button>
                : <a className="csgo" href={cur.url} target="_blank" rel="noopener noreferrer">{isBoard ? 'Open board' : 'Open link'}</a>}
              <button type="button" className="csgo csopt" onClick={(e) => { setOptHold(true); openMenu(e, menu) }}>Options</button>
            </div>
          </div>
        )}
      </div>
      {i > 0 && <button type="button" className="csarrow l" aria-label="Previous" onClick={back}>‹</button>}
      {i < slides.length - 1 && <button type="button" className="csarrow r" aria-label="Next" onClick={next}>›</button>}
    </div>,
    document.body,
    )}
    {menuEl}
    {(qrOpen || toFriend || toBoard) && createPortal(<>
      <QrModal open={qrOpen} hint="Scan to open" url={href} title={cur.title || 'Status'} onClose={() => setQrOpen(false)} />
      <PickFriendModal link={toFriend} onClose={() => setToFriend(null)} />
      <PickBoardModal payload={toBoard} onClose={() => setToBoard(null)} />
    </>, document.body)}
  </>)
}

/* The card as visitors see it: banner, picture overlapping it, name, description, then the tabs that have links in them.
   Shared by the public page (/<name>/ocard) and the editor's Preview. */
function CardView({ owner, bio, background, tabs, onOpen, status = [], linkView = 'small', socials = [] }) {
  const [active, setActive] = useState(0)
  const [story, setStory] = useState(false)       // the picture / status viewer
  const [mode, setMode] = useState(null)          // null = the way the owner set the links up; 'small' / 'large' = what this visitor picked
  const cur = tabs[Math.min(active, tabs.length - 1)]
  const view = mode || linkView
  return (
    <div className={`mlbg mlfull ${background ? 'hasbg' : ''}`} style={background ? { '--bgimg': `url("${background}")` } : undefined}>
      <div className="mlpanel">
        <div className="mlprof">
          <button type="button" className={`mlavbtn ${status.length ? 'hasstatus' : ''}`} aria-label={status.length ? 'See the picture and status' : 'See the picture'} onClick={() => setStory(true)}><Avatar big plain u={owner} /></button>
          <h1>{owner.name}</h1>
          {bio && <p className="mlbio">{bio}</p>}
          {socials.length > 0 && (
            <div className="mlsocials">
              {socials.map((x, i) => <a key={x.id || x.kind} href={x.url} target="_blank" rel="noopener noreferrer" aria-label={socialName(x.kind)} title={socialName(x.kind)}><LinkIcon icon={x.kind === 'custom' ? x.image : x.kind} size={40} /></a>)}
            </div>
          )}
        </div>
        {tabs.length > 0 && <TabBars value={Math.min(active, tabs.length - 1)} onChange={setActive} options={tabs.map((t, i) => [i, tabLabel(t)])} />}
        {tabs.length === 0 && <div className="empty">Nothing here yet.</div>}
        {cur?.desc && !cur.desc_below && <p className="mltabdesc">{cur.desc}</p>}
        {cur?.items.length > 0 && (
          <div className="mlviewpick" role="group" aria-label="How the links look">
            <button type="button" className={view === 'small' ? 'on' : ''} aria-pressed={view === 'small'} onClick={() => setMode('small')}><ListI size={16} /><span className="mlviewtxt"> Small</span></button>
            <button type="button" className={view === 'large' ? 'on' : ''} aria-pressed={view === 'large'} onClick={() => setMode('large')}><Grid4 size={16} /><span className="mlviewtxt"> Large</span></button>
          </div>
        )}
        <div className="mllist">{cur?.items.map((l) => <LinkCard key={l.id} l={mode ? { ...l, preview: mode === 'large' } : linkView === 'large' ? { ...l, preview: true } : l} onOpen={onOpen} />)}</div>
        {cur?.desc && cur.desc_below && <p className="mltabdesc below">{cur.desc}</p>}
      </div>
      {story && <StoryViewer owner={owner} status={status} onClose={() => setStory(false)} />}
    </div>
  )
}

/* The question before a card with 18+ content opens (live page and preview) */
function AdultGate({ onProceed, onCancel }) {
  return (
    <div className="mlgate">
      <div className="sheet">
        <h2>Content rated 18+</h2>
        <p>This OCARD contains content rated 18+.<br />Do you want to proceed?</p>
        <div className="btns"><button className="cancelred" onClick={onCancel}>Cancel</button><button className="go" onClick={onProceed}>Proceed</button></div>
      </div>
    </div>
  )
}

/* The settings button of a live card: a gear at the bottom right (share, QR code, send to an OPAL, create your own) */
function SkyButton({ onClick }) {
  return (
    <button type="button" className="mlsettings gear" aria-label="Settings" title="Settings" onClick={onClick}>
      <Gear size={26} />
    </button>
  )
}

/* The public card, at /<name>/ocard (the older /l/<name>/ocard and /l/<name> still open it) */
export function PublicLinks() {
  const { handle } = useParams()
  const { user } = useApp()
  const nav = useNavigate()
  const back = useBack('/discover')
  const { toast } = useApp()
  const [ok18, setOk18] = useState(() => { try { return sessionStorage.getItem(`ocard18:${handle}`) === '1' } catch { return false } })
  const [openMenu, menuEl] = usePopupMenu()
  const [qrOpen, setQrOpen] = useState(false)
  const { data, loading, error } = useFetch(`/l/${encodeURIComponent(handle)}/`, [handle])
  // one view per visit (once the 18+ question, if any, has been answered); the owner's own looks are ignored by the server
  useEffect(() => {
    if (!data || (data.adult && !ok18)) return
    try { if (sessionStorage.getItem(`ocardv:${handle}`)) return; sessionStorage.setItem(`ocardv:${handle}`, '1') } catch { /* private mode */ }
    track(handle, 'view')
  }, [data, ok18, handle])
  // the tab shows the person's own name, not OPIOW's
  useEffect(() => {
    const prev = document.title
    document.title = data ? (data.name || data.owner.name) : handle
    window.scrollTo(0, 0)
    return () => { document.title = prev }
  }, [data, handle])
  if (loading && !data) return <Skel />
  if (error || !data) return <div className="gate"><h2>Page not found</h2><p>There is no card called “{handle}”.</p></div>
  // a card with 18+ content asks first, whoever is looking (the owner too)
  if (data.adult && !ok18) {
    return <AdultGate onCancel={back} onProceed={() => { try { sessionStorage.setItem(`ocard18:${handle}`, '1') } catch { /* private mode */ } setOk18(true) }} />
  }
  const link = addressOf(handle)
  // these options open in a new tab; people who are not logged in get the login page there, and come back to it after
  const openTab = (path) => window.open(path, '_blank', 'noopener')
  const needLogin = (msg, from) => { toast(msg); openTab(`/login?next=${encodeURIComponent(from)}`) }
  const share = async () => {
    track(handle, 'share')
    if (navigator.share) { try { await navigator.share({ title: data.name || data.owner.name, url: link }) } catch { /* cancelled */ } return }
    try { await navigator.clipboard.writeText(link); toast('Link copied') } catch { toast(link) }
  }
  // creating a card needs an account: signed-in people go to their cards page, everyone else is asked to log in first
  const create = () => (user ? openTab('/ocard') : needLogin('Log in to create your card', '/ocard'))
  const items = [
    { label: 'Share', fn: share },
    { label: 'QR code', fn: () => { track(handle, 'share'); setQrOpen(true) } },
    { label: 'Send to an OPAL', fn: () => { const to = `/send?url=${encodeURIComponent(link)}&title=${encodeURIComponent(data.name || `${data.owner.name}'s card`)}`; return user ? openTab(to) : needLogin('Log in to send this to an OPAL', to) } },
    { label: 'Create your own card', fn: () => create() },
  ]
  return (
    <>
      <CardView key={handle} owner={{ ...data.owner, name: data.name || data.owner.name }} bio={data.bio} background={data.background} tabs={data.tabs} status={data.status || []} linkView={data.link_view || 'small'} socials={data.socials || []} onOpen={(l) => track(handle, 'click', l.id)} />
      {/* only you see this: a way back to editing while you look at your own card */}
      {user?.id === data.owner.id && <button type="button" className="mlback" aria-label="Back" onClick={() => nav('/ocard')}>←</button>}
      {/* the settings button stays at the top right while you scroll: a glowing sun (day) or moon (night) */}
      <SkyButton onClick={(e) => openMenu(e, items, { left: true })} />
      {menuEl}
      <QrModal open={qrOpen} hint="Scan to open" url={link} title={data.name || `${data.owner.name}'s card`} onClose={() => setQrOpen(false)} />
    </>
  )
}

/* Free accounts: 3 cards, 4 tabs and 28 links on a card. Pro: more of each. */
function UpgradeModal({ what, limits, onClose }) {
  const { toast, loadMe } = useApp()
  const [busy, setBusy] = useState(false)
  const go = async () => {
    setBusy(true)
    try { await api.post('/upgrade/'); await loadMe(); toast('You are now on Pro'); onClose(true) } catch (e) { toast(errMsg(e)) } finally { setBusy(false) }
  }
  return (
    <Modal onClose={() => onClose(false)}>
      <div className="sheet">
        <h2>Upgrade to Pro</h2>
        <p>{what === 'tabs' ? `You have used all ${limits.tabs} tabs on this card.` : what === 'links' ? `You have used all ${limits.links} links on this card.` : `You have used all ${limits.cards} cards.`} Pro gives you more room:</p>
        <ul className="mlperks">
          <li><b>Up to 10 cards</b> instead of 3</li>
          <li><b>Up to 12 tabs</b> on each card instead of 4</li>
          <li><b>Up to 280 links</b> on each card instead of 28</li>
        </ul>
        <div className="btns"><button onClick={() => onClose(false)}>Not now</button><button className="go" disabled={busy} onClick={go}>{busy ? 'Upgrading…' : 'Upgrade'}</button></div>
      </div>
    </Modal>
  )
}

/* A large popup with your boards and the boards you saved. Tapping one fills the link's address and name. */
function BoardPicker({ onPick, onClose }) {
  const [q, setQ] = useState('')
  const [dq, setDq] = useState('')           // the search text, after a short pause
  useEffect(() => { const t = setTimeout(() => setDq(q.trim()), 250); return () => clearTimeout(t) }, [q])
  const { data: mineData, loading } = useFetch('/boards/', [])                                 // boards I made or saved
  const { data: openData } = useFetch(`/discover/boards/?q=${encodeURIComponent(dq)}`, [dq])    // other people's public boards
  const term = q.trim().toLowerCase()
  // one list, no sections. Each board says whose it is underneath: Mine, Saved or Public.
  // Private boards cannot be added to a card (visitors could not open them), so they are left out.
  const seen = new Set()
  const boards = [
    ...(mineData || []).map((b) => ({ ...b, tag: b.saved ? 'Saved' : 'Malinks' })),
    ...(openData || []).map((b) => ({ ...b, tag: 'Public' })),
  ].filter((b) => {
    if (seen.has(b.id) || !b.is_public || b.frozen) return false
    seen.add(b.id)
    return !term || b.name.toLowerCase().includes(term) || (b.owner?.username || '').toLowerCase().includes(term)
  })
  // each board is a square tile: its own picture (or a collage of its links' pictures) fills the square, the name sits underneath
  const tile = (b) => {
    const pics = (b.image ? [b.image] : (b.previews?.length ? b.previews : b.preview ? [b.preview] : [])).slice(0, 4)
    const path = b.slug && b.owner?.username ? `/boards/${b.owner.username}/${b.slug}` : `/boards/${b.id}`
    return (
      <button key={b.id} type="button" className="mlsq" title={b.name} onClick={() => onPick({ url: `${location.origin}${path}`, name: b.name, image: pics[0] || '' })}>
        <span className={`mlsqpic n${pics.length}`} style={!pics.length && b.color ? { background: b.color } : undefined}>
          {pics.length ? pics.map((u) => <img key={u} src={u} alt="" loading="lazy" referrerPolicy="no-referrer" onError={(e) => { e.currentTarget.style.visibility = 'hidden' }} />) : <LinkIcon icon="board" size={44} />}
        </span>
        <b>{b.name}</b>
        <small>{b.tag}</small>
      </button>
    )
  }
  return (
    <Modal onClose={onClose} className="pfull">
      <div className="sheet">
        <div className="pfhead"><h2>Choose a board</h2><button className="pfx" onClick={onClose} aria-label="Close">✕</button></div>
        <input type="search" className="mlbsearch" placeholder="Search boards" value={q} autoFocus onChange={(e) => setQ(e.target.value)} />
        <div className="pflist">
          {loading && !mineData ? <p className="hint">Loading boards…</p>
            : boards.length ? <div className="mlsqgrid">{boards.map(tile)}</div>
            : <p className="hint">{term ? 'No public boards match your search.' : 'No public boards yet. Make one of your boards public to share it here.'}</p>}
        </div>
        <div className="btns pfclose"><button onClick={onClose}>Close</button></div>
      </div>
    </Modal>
  )
}

/* The card's status: pick links and boards of yours to show when someone taps the card's picture (up to 10) */
export function StatusModal({ status, onChange, onClose }) {
  const { toast, confirm } = useApp()
  const [tab, setTab] = useState('links')
  const [q, setQ] = useState('')
  const { data: links, reload: reloadLinks } = useFetch('/links/', [])
  const { data: boards } = useFetch('/boards/', [])
  const { data: others } = useFetch('/discover/', [])          // other people's public links
  const { data: openBoards } = useFetch('/discover/boards/', [])   // other people's public boards
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const MAX = 10
  const wide = typeof window !== 'undefined' && window.matchMedia('(min-width: 900px)').matches
  const [blink, setBlink] = useState('')          // an item that is already added: flashes on the added side
  const flash = (id) => {
    setBlink(''); setTimeout(() => setBlink(id), 30); setTimeout(() => setBlink(''), 1800)
    document.querySelector(`.statuslist [data-id="${id}"]`)?.scrollIntoView({ block: 'nearest' })
  }
  const nm = (t) => (wide ? shortName(t) : t)
  const full = status.length >= MAX
  const has = (kind, ref) => status.some((x) => x.kind === kind && x.ref === ref)
  const term = q.trim().toLowerCase()
  const isUrl = tab === 'links' && /^(https?:\/\/)?[^\s/]+\.[^\s/]{2,}(\/\S*)?$/i.test(q.trim())     // something pasted that is a web address
  const addLink = (l) => onChange([...status, { id: `l${l.id}`, kind: 'link', ref: l.id, title: l.title, url: l.url, image: l.image || '', host: l.host }])
  const addBoard = (b) => onChange([...status, { id: `b${b.id}`, kind: 'board', ref: b.id, title: b.name, url: `/boards/${b.owner?.username}/${b.slug}`, image: b.image || b.preview || '', host: '' }])
  const remove = async (it) => {
    if (!(await confirm({ title: 'Remove from your status?', message: `“${it.title}” will no longer be in your status.`, label: 'Remove' }))) return
    onChange(status.filter((x) => !(x.kind === it.kind && x.ref === it.ref)))
  }
  const plain = (u) => u.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/+$/, '')
  // paste a link: it goes into your Mine / Saved links (so it is one of your links) and into the status
  const addPasted = async () => {
    const url = q.trim()
    if (!url) return
    if (full) return setMsg('Status full')
    setBusy(true); setMsg('')
    try {
      let link
      try { ({ data: link } = await api.post('/links/', { url })) }
      catch (e) {
        if (!/already/i.test(errMsg(e))) throw e
        link = ((await api.get('/links/')).data || []).find((l) => plain(l.url) === plain(url))      // you already have it: use that one
      }
      if (!link) throw new Error('Could not add that link.')
      reloadLinks()
      if (!has('link', link.id)) addLink(link)
      setQ('')
    } catch (e) { setMsg(e.message && !e.response ? e.message : errMsg(e)) } finally { setBusy(false) }
  }
  // my latest links first, then the ones I saved; what is already added only shows up when searching (marked Added). A PC list holds 10.
  const cap = (rows) => (wide ? rows.slice(0, 10) : rows)
  const mineIds = new Set((links || []).map((l) => l.id))
  const ranked = [
    ...[...(links || [])].sort((a, b) => (a.source === 'saved') - (b.source === 'saved') || b.id - a.id),
    ...(others || []).filter((l) => typeof l.id === 'number' && l.source !== 'board' && !mineIds.has(l.id)),     // then what others made public
  ]
  const linkRows = cap(ranked.filter((l) => (term ? `${l.title} ${l.host}`.toLowerCase().includes(term) : !has('link', l.id))))
  const ownBoardIds = new Set((boards || []).map((b) => b.id))
  const allBoards = [...(boards || []), ...(openBoards || []).filter((b) => !ownBoardIds.has(b.id))]
  const boardRows = cap(allBoards.filter((b) => b.is_public && (term ? b.name.toLowerCase().includes(term) : !has('board', b.id))))   // only public boards can be opened by visitors
  return (
    <Modal onClose={onClose} className="statusmodal">
      <div className="sheet">
        <div className="pfhead"><h2>Status <span className={`statuscount ${full ? 'full' : ''}`}>({status.length}/{MAX})</span></h2><button className="pfx" onClick={onClose} aria-label="Close">✕</button></div>
        <div className="statuscols">
        <div className="statuscol added">
        <h3 className="statushead">Added</h3>
        {status.length === 0 && <p className="hint statusnone">Nothing added yet.</p>}
        {status.length > 0 && (
          <div className="statuslist">
            {status.map((it) => (
              <div className={`statusrow ${blink === it.id ? 'blink' : ''}`} data-id={it.id} key={it.id}>
                <span className="statusthumb">{it.image ? <img alt="" src={it.image} referrerPolicy="no-referrer" /> : <LinkIcon icon={it.kind === 'board' ? 'board' : ''} host={it.host} size={36} />}</span>
                <span className="statustext"><b title={it.title}>{nm(it.title)}</b><small>{it.kind === 'board' ? 'Board' : it.host}</small></span>
                <button type="button" className="ghost mldel" aria-label="Remove" onClick={() => remove(it)}><Trash size={16} /></button>
              </div>
            ))}
          </div>
        )}
        </div>
        <div className="statuscol add">
        <Seg value={tab} onChange={setTab} options={[['links', `Add a link (${status.filter((x) => x.kind === 'link').length})`], ['boards', `Add a board (${status.filter((x) => x.kind === 'board').length})`]]} />
        <div className="urlrow statuspaste">
          <input type="search" value={q} onChange={(e) => { setQ(e.target.value); setMsg('') }} readOnly={full} onBeforeInput={full ? (e) => { e.preventDefault(); toast('Status full') } : undefined}
            onPaste={full ? (e) => { e.preventDefault(); toast('Status full') } : undefined}
            onKeyDown={(e) => { if (full) { if (e.key.length === 1 || e.key === 'Enter') { e.preventDefault(); toast('Status full') } } else if (e.key === 'Enter' && isUrl) addPasted() }}
            onClick={full ? () => toast('Status full') : undefined}
            placeholder={full ? 'Status full' : tab === 'links' ? 'Search your links, or paste a link' : 'Search your boards'} inputMode={tab === 'links' ? 'url' : 'search'} autoCapitalize="none" spellCheck={false} />
          {isUrl && (full
            ? <button type="button" className="pastebtn statuswarn" aria-label="Status full" onClick={() => toast('Status full')}><Warn size={16} /></button>
            : <button type="button" className="pastebtn" disabled={busy} onClick={addPasted}>{busy ? '…' : 'Add'}</button>)}
        </div>
        {msg && <small className="namechk bad">{msg}</small>}
        <div className="pflist">
          {tab === 'links' ? (
            !links ? <p className="hint">Loading…</p> : !linkRows.length ? <p className="hint">{isUrl ? 'Press Add to add this link.' : term ? 'No links found.' : 'Everything is added.'}</p> : linkRows.map((l) => (
              <div className="statusrow" key={l.id}>
                <span className="statusthumb">{l.image ? <img alt="" src={l.image} referrerPolicy="no-referrer" /> : <LinkIcon icon="" host={l.host} size={36} />}</span>
                <span className="statustext"><b title={l.title}>{nm(l.title)}</b><small>{l.host}</small></span>
                {has('link', l.id) ? <button type="button" className="ghost addedbtn" onClick={() => wide && flash(`l${l.id}`)}>Added ✓</button>
                  : full ? <button type="button" className="ghost statuswarn" aria-label="Status full" title="Status full" onClick={() => toast('Status full')}><Warn size={18} /></button>
                  : <button type="button" className="ghost bluebtn" onClick={() => addLink(l)}>Add</button>}
              </div>
            ))
          ) : (
            !boards ? <p className="hint">Loading…</p> : !boardRows.length ? <p className="hint">{term ? 'No public boards found.' : 'No more public boards to add. Make a board public to add it.'}</p> : boardRows.map((b) => (
              <div className="statusrow" key={b.id}>
                <span className="statusthumb">{b.image || b.preview ? <img alt="" src={b.image || b.preview} referrerPolicy="no-referrer" /> : <LinkIcon icon="board" size={36} />}</span>
                <span className="statustext"><b title={b.name}>{nm(b.name)}</b><small>{ownBoardIds.has(b.id) ? (b.saved ? 'Saved board' : 'Your board') : 'Public board'}</small></span>
                {has('board', b.id) ? <button type="button" className="ghost addedbtn" onClick={() => wide && flash(`b${b.id}`)}>Added ✓</button>
                  : full ? <button type="button" className="ghost statuswarn" aria-label="Status full" title="Status full" onClick={() => toast('Status full')}><Warn size={18} /></button>
                  : <button type="button" className="ghost bluebtn" onClick={() => addBoard(b)}>Add</button>}
              </div>
            ))
          )}
        </div>
        </div>
        </div>
        <div className="btns pfclose"><button className="go" onClick={onClose}>Done</button></div>
      </div>
    </Modal>
  )
}

/* Add or change one social icon: pick a site (the top ones), or the + at the end to use your own icon picture, then paste the link */
function SocialModal({ item, taken, onClose, onSave, onRemove }) {
  const { toast } = useApp()
  const [kind, setKind] = useState(item?.kind || '')          // '' = still choosing; 'custom' = your own picture
  const [url, setUrl] = useState(item?.url || '')
  const [image, setImage] = useState(item?.image || '')
  const file = useRef()
  const editing = !!item
  const pick = async (e) => {
    const f = e.target.files?.[0]; e.target.value = ''
    if (f) try { setImage(await readImage(f, { square: true, size: 128 })) } catch (x) { toast(x.message || 'Could not use that image') }
  }
  const save = () => {
    if (!url.trim()) return toast('Paste the link first.')
    if (kind === 'custom' && !image) return toast('Add a picture for your icon.')
    onSave(kind === 'custom' ? { kind, id: item?.id || newId(), image, url: url.trim() } : { kind, url: url.trim() })
  }
  return (
    <Modal onClose={onClose} className="linkmodal">
      <div className="sheet">
        <h2>{editing ? 'Social icon' : 'Add a social icon'}</h2>
        {!kind ? (
          <>
            <p>Pick a site, or tap the + to use your own icon picture.</p>
            <div className="mlsocpick" role="group" aria-label="Social sites">
              {TOP_SOCIALS.map((k) => {
                const used = taken.includes(k)
                return (
                  <button key={k} type="button" className={used ? 'used' : ''} disabled={used} aria-label={socialName(k)} title={used ? `${socialName(k)} is already added` : socialName(k)} onClick={() => setKind(k)}>
                    <LinkIcon icon={k} size={44} />
                  </button>
                )
              })}
              <button type="button" className="mlsocplus" aria-label="Use your own icon picture" title="Your own icon: upload a picture and add a link" onClick={() => setKind('custom')}>+</button>
            </div>
            <div className="btns"><button onClick={onClose}>Cancel</button></div>
          </>
        ) : (
          <>
            <div className="mlsocform">
              {kind === 'custom' ? (
                <button type="button" className="mlsocpicbtn" aria-label="Upload the icon picture" onClick={() => file.current.click()}>
                  {image ? <LinkIcon icon={image} size={56} /> : <span className="mlsocplus big">+</span>}
                </button>
              ) : <LinkIcon icon={kind} size={56} />}
              <div><b>{kind === 'custom' ? 'Your own icon' : socialName(kind)}</b>{kind === 'custom' && <small>{image ? 'Tap the picture to change it' : 'Tap + to upload a small picture'}</small>}</div>
            </div>
            <input ref={file} type="file" accept="image/*" hidden onChange={pick} />
            <label>Link</label>
            <input value={url} maxLength={500} placeholder={kind === 'custom' ? 'https://' : `Paste your ${socialName(kind)} link`} inputMode="url" autoCapitalize="none" autoFocus onChange={(e) => setUrl(e.target.value)} />
            <div className="btns">
              {editing ? <button className="cancelred" onClick={onRemove}>Remove</button> : <button onClick={() => setKind('')}>Back</button>}
              <button className="go" disabled={!url.trim() || (kind === 'custom' && !image)} onClick={save}>{editing ? 'Save' : 'Add'}</button>
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}

/* A row of preview pictures to slide through: Auto (taken from the link), seven ready-made ones, and your own upload */
function CoverCarousel({ cover, url, name, onPick, onUpload }) {
  const row = useRef()
  const slide = (d) => row.current?.scrollBy({ left: d * 180, behavior: 'smooth' })
  const custom = cover.startsWith('data:image/') || /^https?:\/\//.test(cover)
  return (
    <div className="mlcarousel">
      <button type="button" className="cprev" aria-label="Previous pictures" onClick={() => slide(-1)}>‹</button>
      <div className="cstrip" ref={row} role="radiogroup" aria-label="Preview picture">
        <button type="button" role="radio" aria-checked={!cover} className={`ctile ${!cover ? 'on' : ''}`} onClick={() => onPick('')}>
          <CoverPic cover="" url={url} name={name} /><small>Auto</small>
        </button>
        {COVERS.map(([key, label]) => (
          <button key={key} type="button" role="radio" aria-checked={cover === `preset:${key}`} className={`ctile ${cover === `preset:${key}` ? 'on' : ''}`} onClick={() => onPick(`preset:${key}`)}>
            <CoverPic cover={`preset:${key}`} url={url} name={name} /><small>{label}</small>
          </button>
        ))}
        <button type="button" role="radio" aria-checked={custom} className={`ctile ${custom ? 'on' : ''}`} onClick={onUpload}>
          {custom ? <CoverPic cover={cover} url={url} name={name} /> : <div className="mlcover cv-add"><span>+</span></div>}<small>{custom ? 'Yours' : 'Upload'}</small>
        </button>
      </div>
      <button type="button" className="cnext" aria-label="More pictures" onClick={() => slide(1)}>›</button>
    </div>
  )
}

/* Add / edit one link: a name, the web address and an icon (30+ common ones, or your own picture with the +) */
function LinkModal({ item, onClose, onSave }) {
  const { toast } = useApp()
  const [name, setName] = useState(item.name || '')
  const [url, setUrl] = useState(item.url || '')
  const [icon, setIcon] = useState(item.icon || '')
  const [adult, setAdult] = useState(!!item.adult)    // this link is rated 18+
  const [desc, setDesc] = useState(item.desc || '')    // optional short line, shown on a preview card
  const [preview, setPreview] = useState(!!item.preview)   // show this link as a preview card (picture, name and description) instead of a plain row
  const [cover, setCover] = useState(item.cover || '')    // the preview picture: '' = picked from the link, 'preset:<name>' or an uploaded picture
  const coverFile = useRef()
  const file = useRef()
  const [picking, setPicking] = useState(false)     // the board picker
  const [fromBoard, setFromBoard] = useState(false)   // the icon is the picked board's picture
  const custom = icon.startsWith('data:image/') && !fromBoard
  const pick = async (e) => {
    const f = e.target.files?.[0]; e.target.value = ''
    if (f) try { setIcon(await readImage(f, { square: true, size: 128 })); setFromBoard(false) } catch (x) { toast(x.message || 'Could not use that image') }
  }
  return (
    <Modal onClose={onClose} className="linkmodal">
      <div className="sheet">
        <h2>{item.id ? 'Edit link' : 'Add a link'}</h2>
        <label>Link</label>
        <input value={url} maxLength={500} placeholder="https://" inputMode="url" autoCapitalize="none" autoFocus onChange={(e) => setUrl(e.target.value)} />
        <label>Name <small>optional</small></label>
        <input value={name} maxLength={40} placeholder={hostOf(url) || 'e.g. My Instagram. Leave empty to use the site address'} onChange={(e) => setName(e.target.value)} />
        <label>Description <small>optional, {MAX_LINK_WORDS} words max</small></label>
        <input value={desc} placeholder="A short line about this link" onChange={(e) => {
          if (words(e.target.value) > MAX_LINK_WORDS) return toast(`Maximum words limit: ${MAX_LINK_WORDS}`)
          setDesc(e.target.value)
        }} />
        <label className="mladult mlpreviewtoggle"><input type="checkbox" checked={preview} onChange={(e) => setPreview(e.target.checked)} /> <span>Show this link as a preview card</span></label>
        {preview && (
          <>
            <label>Preview picture <small>pick one, or leave it on Auto to use the link’s own picture</small></label>
            <input ref={coverFile} type="file" accept="image/*" hidden onChange={async (e) => {
              const f = e.target.files?.[0]; e.target.value = ''
              if (f) try { setCover(await readImage(f, { ratio: 16 / 9, max: 480 })) } catch (x) { toast(x.message || 'Could not use that image') }
            }} />
            <CoverCarousel cover={cover} url={url} name={name} onPick={setCover} onUpload={() => coverFile.current.click()} />
          </>
        )}
        <label>Icon <small>optional</small></label>
        <input ref={file} type="file" accept="image/*" hidden onChange={pick} />
        {/* the picture this link will show, with a clear way to add your own */}
        <div className="mlimgrow">
          <LinkIcon icon={icon} host={hostOf(url)} size={44} />
          <button type="button" className="ghost" onClick={() => file.current.click()}>{custom ? 'Change image' : 'Add image'}</button>
          {(custom || fromBoard) && <button type="button" className="ghost" onClick={() => { setIcon(''); setFromBoard(false) }}>Remove</button>}
          <small>or pick an icon below</small>
        </div>
        <div className="icongrid" role="radiogroup" aria-label="Icon">
          <button type="button" className={`plus ${custom ? 'on' : ''}`} aria-label="Use your own picture" title="Use your own picture" onClick={() => file.current.click()}>
            {custom ? <img src={icon} alt="" /> : '+'}
          </button>
          <button type="button" className={`auto tile ${icon === 'board' || fromBoard ? 'on' : ''}`} aria-label="Board" title="Share one of your boards" onClick={() => { setIcon(fromBoard ? icon : 'board'); setPicking(true) }}><svg className="folderanim" viewBox="0 0 48 36" width="34" height="26" aria-hidden="true">
              <path className="fback" d="M3 6a3 3 0 0 1 3-3h11l4 4h21a3 3 0 0 1 3 3v22a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3z" />
              <rect className="fpaper" x="9" y="11" width="30" height="16" rx="2" />
              <path className="ffront" d="M3 14a3 3 0 0 1 3-3h36a3 3 0 0 1 3 3v17a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3z" />
            </svg></button>
          {SOCIALS.map((s) => (
            <button key={s.key} type="button" role="radio" aria-checked={icon === s.key} aria-label={s.name} title={s.name} className={icon === s.key ? 'on' : ''} onClick={() => { setIcon(s.key); setFromBoard(false) }}>
              <LinkIcon icon={s.key} size={38} />
            </button>
          ))}
        </div>
        {(icon === 'board' || fromBoard) && <button type="button" className="ghost" onClick={() => setPicking(true)}>{url ? 'Change board' : 'Choose a board'}</button>}
        <label className="mladult"><input type="checkbox" checked={adult} onChange={(e) => setAdult(e.target.checked)} /> <span>This link contains content rated <b className="red18">18+</b></span></label>
        <div className="btns">
          <button onClick={onClose}>Cancel</button>
          <button className="go" disabled={!url.trim()} onClick={() => onSave({ id: item.id || newId(), name: name.trim() || hostOf(url) || url.trim().slice(0, 40), url: url.trim(), icon, adult, desc: desc.trim(), preview, cover: preview ? cover : '' })}>Save</button>
        </div>
      </div>
      {picking && <BoardPicker onClose={() => setPicking(false)} onPick={async (b) => { setUrl(b.url); setName(b.name.slice(0, 40)); setPicking(false); const pic = await toIcon(b.image); setIcon(pic || 'board'); setFromBoard(!!pic) }} />}
    </Modal>
  )
}

/* Edit one card, at /ocard/<id> (or /ocard/new): banner, picture, name, description, links and tabs, with a Preview of the finished card */
export function CardEditor() {
  const { user, toast, setPhotoEdit, confirm } = useApp()
  const { id } = useParams()
  const nav = useNavigate()
  const back = useBack('/ocard')
  const { data, loading, reload } = useFetch('/linkpage/', [])
  const page = id === 'new' ? null : (data?.pages || []).find((p) => String(p.id) === id)
  const [mode, setMode] = useState('edit')            // edit | preview
  const [handle, setHandle] = useState('')
  const [name, setName] = useState('')
  const [bio, setBio] = useState('')
  const [socials, setSocials] = useState([])        // icon-only links under the description: { kind, url } (or { kind: 'custom', id, image, url } for your own icon)
  const [socModal, setSocModal] = useState(null)      // the social icon popup: { index } (-1 = a new one)
  const [linkView, setLinkView] = useState('small')  // how the links look: small rows or large preview cards
  const [background, setBackground] = useState('')
  const [adultCard, setAdultCard] = useState(false)   // the owner marks the whole card as 18+
  const [status, setStatus] = useState([])             // links and boards shown when the picture is tapped
  const [statusOpen, setStatusOpen] = useState(false)
  const [statsOpen, setStatsOpen] = useState(false)
  const [previewOk, setPreviewOk] = useState(false)   // the 18+ question was answered in this preview
  const [items, setItems] = useState([])
  const [tabs, setTabs] = useState([])                // every tab in order: { key, main, name, hidden, item_ids }. The main one holds all links.
  const [at, setAt] = useState(0)                     // the tab open for editing
  const [modal, setModal] = useState(null)            // a link being added / edited
  const [upgrade, setUpgrade] = useState(false)       // the upgrade popup
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState('')
  const [baseline, setBaseline] = useState(null)       // what the card looked like when it was loaded or last saved; any difference is an unsaved change
  const [openMenu, menuEl] = usePopupMenu()            // the card switcher
  const bgFile = useRef()
  useTopBar({ back, center: 'Edit Card', hideTabs: true }, [])
  useEffect(() => {
    if (!data) return
    const p = page
    setName(p?.name || user.name || ''); setHandle(p?.handle || ''); setSaved(p?.handle || '')
    setBio(p?.bio || ''); setBackground(p?.background || ''); setAdultCard(!!p?.adult_card); setLinkView(p?.link_view || 'small'); setSocials(p?.socials || [])
    setStatus(p?.status || [])
    setItems(p?.items || [])
    setTabs(p ? p.tabs.map((t) => ({ key: t.main ? 'main' : newId(), main: t.main, name: t.name, desc: t.desc || '', desc_below: !!t.desc_below, hidden: !!t.hidden, item_ids: t.main ? [] : t.item_ids }))
      : [{ key: 'main', main: true, name: 'My Card', desc: '', desc_below: false, hidden: false, item_ids: [] }])
    setAt(0)
    // remember this starting point (the same values, in the same shape, as the snapshot below)
    const t0 = p ? p.tabs.map((t) => ({ main: t.main, name: t.name, desc: t.desc || '', desc_below: !!t.desc_below, hidden: !!t.hidden, item_ids: t.main ? [] : t.item_ids })) : [{ main: true, name: 'My Card', desc: '', desc_below: false, hidden: false, item_ids: [] }]
    setBaseline(JSON.stringify({ name: p?.name || user.name || '', handle: p?.handle || '', bio: p?.bio || '', background: p?.background || '', adultCard: !!p?.adult_card, status: p?.status || [], items: p?.items || [], socials: p?.socials || [], linkView: p?.link_view || 'small', tabs: t0 }))
  }, [data, id]) // eslint-disable-line
  const snapshot = JSON.stringify({ name, handle, bio, background, adultCard, status, items, socials, linkView, tabs: tabs.map(({ key, ...t }) => t) })
  const dirty = baseline !== null && snapshot !== baseline
  const dirtyRef = useRef(false)
  dirtyRef.current = dirty
  // leaving with unsaved changes (any link, the back button, switching cards...) asks first; closing the tab uses the browser's own question
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirtyRef.current && currentLocation.pathname !== nextLocation.pathname)
  useEffect(() => {
    if (!dirty) return
    const warn = (e) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])
  const nameChk = useNameCheck('page', handle, saved, page?.id)
  if (loading && !data) return <Skel />
  if (id !== 'new' && data && !page) return <div className="gate"><h2>Card not found</h2><p>That card doesn’t exist any more.</p></div>
  // a new card when you already have as many as you are allowed: say so now, not after you have filled it in
  if (id === 'new' && data && (data.pages || []).length >= (data.limits?.cards || 3)) {
    const lim0 = data.limits || { pro: false, cards: 3, tabs: 4, links: 30 }
    return (
      <div className="gate">
        <h2>You have {lim0.cards} cards</h2>
        <p>That is the most you can have. Delete one to make another.</p>
        <div className="gatebtns">
          {/* Upgrade is switched off for now (will be activated later)
          {!lim0.pro && <button className="gobtn" onClick={() => setUpgrade('cards')}>⭐ Upgrade</button>} */}
          <button className="ghostbtn" onClick={() => nav('/ocard', { replace: true })}>My cards</button>
        </div>
        {/* {upgrade && <UpgradeModal what="cards" limits={lim0} onClose={() => { setUpgrade(false); reload() }} />} */}
      </div>
    )
  }

  const lim = data?.limits || { pro: false, cards: 3, tabs: 4, links: 30 }
  const n = words(bio)
  const cur = tabs[Math.min(at, tabs.length - 1)]
  const setTab = (i, patch) => setTabs((ts) => ts.map((t, k) => (k === i ? { ...t, ...patch } : t)))
  const pickImage = (set, opts) => async (e) => {
    const f = e.target.files?.[0]; e.target.value = ''
    if (f) try { set(await readImage(f, opts)) } catch (x) { toast(x.message || 'Could not use that image') }
  }
  const saveItem = (it) => {
    setItems((all) => (all.some((x) => x.id === it.id) ? all.map((x) => (x.id === it.id ? it : x)) : [...all, it]))
    setModal(null)
  }
  const removeItem = async (id) => {
    const it = items.find((x) => x.id === id)
    if (!(await confirm({ title: 'Delete this link?', message: `“${it?.name || 'This link'}” will be taken off your card (when you save).`, label: 'Delete' }))) return
    setItems((all) => all.filter((x) => x.id !== id))
    setTabs((ts) => ts.map((t) => ({ ...t, item_ids: (t.item_ids || []).filter((x) => x !== id) })))
  }
  const toggle = (i, id) => {
    const ids = tabs[i].item_ids
    if (ids.includes(id)) return setTab(i, { item_ids: ids.filter((x) => x !== id) })
    if (ids.length >= MAX_PER_TAB) return toast(`A tab can hold up to ${MAX_PER_TAB} links.`)
    setTab(i, { item_ids: [...ids, id] })
  }
  const addTab = () => { setTabs([...tabs, { key: newId(), main: false, name: '', desc: '', desc_below: false, hidden: false, item_ids: [] }]); setAt(tabs.length) }
  const deleteTab = async (i) => {
    if (!(await confirm({ title: 'Delete this tab?', message: `“${tabs[i]?.name || 'This tab'}” will be removed. Its links stay on your card.`, label: 'Delete' }))) return
    setTabs(tabs.filter((_, k) => k !== i)); setAt(0)
  }
  // delete the whole card: asks first, and leaves without the "unsaved changes" question
  const deleteCard = async () => {
    if (!page) return
    if (!(await confirm({ title: 'Delete card?', message: `“${page.name || page.handle}” and its address will be deleted for good.`, label: 'Delete' }))) return
    try { await api.delete(`/linkpage/${page.id}/`); dirtyRef.current = false; toast('Card deleted'); nav('/ocard', { replace: true }) } catch (e) { toast(errMsg(e)) }
  }
  // drag a tab to a new place: it takes that position and the others shift along
  const moveTab = (from, to) => {
    setTabs((ts) => { const a = [...ts]; const [t] = a.splice(from, 1); a.splice(to, 0, t); return a })
    setAt((x) => (x === from ? to : from < x && to >= x ? x - 1 : from > x && to <= x ? x + 1 : x))
  }
  const save = async () => {
    if (n > MAX_WORDS) { toast(`Keep the description to ${MAX_WORDS} words or fewer.`); return false }
    if (tabs.some((t) => words(t.desc || '') > MAX_TAB_WORDS)) { toast(`Keep a tab's description to ${MAX_TAB_WORDS} words or fewer.`); return false }
    if (socials.some((x) => !x.url.trim())) { toast('Paste the link for every social icon, or remove it.'); return false }
    setBusy(true)
    try {
      const main = tabs.find((t) => t.main)
      const extras = tabs.filter((t) => !t.main && t.name.trim())
      const mainPos = tabs.slice(0, tabs.indexOf(main)).filter((t) => !t.main && t.name.trim()).length
      const { data: r } = await api.put('/linkpage/', { id: page?.id, name: name.trim(), handle, bio, background, socials, link_view: linkView, adult: adultCard, status: status.map((x) => ({ kind: x.kind, ref_id: x.ref })), status_days: 1, items, main_name: main.name.trim() || 'My Card', main_hidden: main.hidden, main_desc: main.desc || '', main_desc_below: !!main.desc_below, main_pos: mainPos,
        tabs: extras.map((t) => ({ name: t.name.trim(), desc: t.desc || '', desc_below: !!t.desc_below, item_ids: t.item_ids, hidden: t.hidden })) })
      toast('Saved'); setBaseline(snapshot); dirtyRef.current = false; reload()
      if (!page) nav(`/ocard/${r.page.id}`, { replace: true })    // a new card now has its own address
      return true
    } catch (e) { toast(errMsg(e)); return false } finally { setBusy(false) }
  }
  const copy = async () => { try { await navigator.clipboard.writeText(addressOf(saved)); toast('Link copied') } catch { toast(addressOf(saved)) } }

  const me = { ...user, name: name.trim() || user.name }
  // what visitors will see: hidden and empty tabs are left out
  const previewTabs = tabs.filter((t) => !t.hidden && (t.main || t.name.trim()))
    .map((t) => ({ name: t.name.trim() || 'My Card', desc: t.desc || '', desc_below: !!t.desc_below, items: t.main ? items : t.item_ids.map((id) => items.find((x) => x.id === id)).filter(Boolean) }))
    .filter((t) => t.items.length)

  return (
    <>
      <div className="mlmode">
        <Seg value={mode} onChange={(m) => { setMode(m); setPreviewOk(false) }} options={[['edit', 'Edit'], ['preview', 'Preview']]} />
        {page && <button type="button" className="ghost mlstatsbtn" onClick={() => setStatsOpen(true)}>Analytics</button>}
        {(data?.pages || []).length > 1 && (
          <button type="button" className="mlswitch" aria-label="Switch card" title="Switch to another card"
            onClick={(e) => {
              const list = data.pages.map((p) => ({ label: `${p.name || p.handle} (${p.handle})`, cls: String(p.id) === id ? 'sel' : '', fn: () => { if (String(p.id) !== id) nav(`/ocard/${p.id}`) } }))
              // + adds another card while you still can; once your cards are used up it says Upgrade (nothing extra on the top plan, which has no more to give)
              if (data.pages.length < lim.cards) list.push({ label: '+ New card', fn: () => nav('/ocard/new') })
              // else if (!lim.pro) list.push({ label: '⭐ Upgrade', fn: () => setUpgrade('cards') })   // Upgrade is off for now
              openMenu(e, list, { left: true })     // on phones it floats to the left of the circle
            }}>
            <CardI size={20} />
          </button>
        )}
      </div>
      {menuEl}
      {blocker.state === 'blocked' && (
        <Modal onClose={() => blocker.reset()}>
          <div className="sheet">
            <h2>Unsaved changes</h2>
            <p>You have changes to this card that are not saved. Do you want to save them before you leave?</p>
            <div className="btns mlleave">
              <button className="cancelred" onClick={() => blocker.proceed()}>Discard</button>
              <button className="go" disabled={busy || !handle || nameChk.ok === false} onClick={async () => { if (await save()) blocker.proceed() }}>{busy ? 'Saving…' : 'Save'}</button>
              <button onClick={() => blocker.reset()}>Cancel</button>
            </div>
          </div>
        </Modal>
      )}
      {mode === 'preview' ? (
        // the preview is the finished card on a page of its own, covering the top bar too
        <div className="mlpreview">
          {(adultCard || items.some((l) => l.adult)) && !previewOk
            ? <AdultGate onCancel={() => setMode('edit')} onProceed={() => setPreviewOk(true)} />
            : <><CardView owner={me} bio={bio} background={background} tabs={previewTabs} status={status} linkView={linkView} socials={socials.filter((x) => x.url.trim())} />
              <button type="button" className="mlclose" onClick={() => setMode('edit')}>✕ Close preview</button></>}
        </div>
      ) : (
        <div className={`mlbg ${background ? 'hasbg' : ''}`} style={background ? { '--bgimg': `url("${background}")` } : undefined}>
          <div className="mlpanel mledit">
            <div className="mlcol">
            <div className="mlprof">
              <Avatar big plain u={me} onClick={() => setPhotoEdit(true)} />
              <div className="mlpicbtns">
                <button type="button" className="mlpicbtn picture" onClick={() => setPhotoEdit(true)}>Picture</button>
                <button type="button" className="mlpicbtn status" onClick={() => setStatusOpen(true)}>Status{status.length ? ` (${status.length})` : ''}</button>
              </div>
            </div>

            <label>Name</label>
            <input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} placeholder="Name of your card" />
            <label>Card Url</label>
            <div className="mlurl"><span>{location.host}/</span><input value={handle} maxLength={30} onChange={(e) => setHandle(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ''))} placeholder="yourname" /><span className="mlsuffix">/ocard</span></div>
            {nameChk.msg && <small className={`namechk ${nameChk.ok ? 'ok' : 'bad'}`}>{nameChk.ok ? '✓ ' : ''}{nameChk.msg}</small>}
            <label>Description <small className={n > MAX_WORDS ? 'over' : ''}>{n}/{MAX_WORDS} words</small></label>
            <textarea rows={3} value={bio} onChange={(e) => setBio(e.target.value)} placeholder="A short line about you or your links" />
            <label>Social icons <small>{socials.length}/{MAX_SOCIALS} · icon-only links just under your description</small></label>
            <div className="mlsocedit">
              {socials.map((x, i) => (
                <button key={x.id || x.kind} type="button" className="mlsocchip" aria-label={`${socialName(x.kind)}: edit or remove`} title={`${socialName(x.kind)} · ${x.url}`} onClick={() => setSocModal({ index: i })}>
                  <LinkIcon icon={x.kind === 'custom' ? x.image : x.kind} size={40} />
                </button>
              ))}
              {socials.length < MAX_SOCIALS && <button type="button" className="mlsocplus" aria-label="Add a social icon" title="Add a social icon" onClick={() => setSocModal({ index: -1 })}>+</button>}
            </div>
            <label>How your links look</label>
            <Seg value={linkView} onChange={setLinkView} options={[['small', 'Small'], ['large', 'Large']]} />
            <small className="mlcount">Small: a row for each link. Large: a picture card for each link. Visitors can switch too.</small>
            </div>
            <div className="mlcol">
            <label>Card background</label>
            <input ref={bgFile} type="file" accept="image/*" hidden onChange={pickImage(setBackground, { max: 1000 })} />
            <div className="photorow">
              {background && <img alt="Card background" src={background} />}
              <button type="button" className="bgadd" onClick={() => bgFile.current.click()}>{background ? 'Change image' : 'Add image'}</button>
              {/* a rectangle the same size as Add image, with a multicoloured +: opens the colour picker for a plain colour background */}
              <label className={`bgrect ${colorOf(background) ? 'on' : ''}`} title="Choose a background colour" style={colorOf(background) ? { background: colorOf(background) } : undefined}>
                <span className="rainbow">+</span>
                <input type="color" aria-label="Choose a background colour" value={colorOf(background) || '#1f6feb'} onChange={(e) => setBackground(solidBg(e.target.value))} />
              </label>
              {background && <button type="button" onClick={() => setBackground('')}>Remove</button>}
            </div>

            <label className="mladult"><input type="checkbox" checked={adultCard || items.some((l) => l.adult)} disabled={items.some((l) => l.adult)} onChange={(e) => setAdultCard(e.target.checked)} /> This card contains content rated 18+</label>
            {(adultCard || items.some((l) => l.adult)) && <small className="mlcount">⚠ Visitors will be asked to confirm they want to proceed before they see this card.{items.some((l) => l.adult) ? ' It is turned on because a link is marked 18+.' : ''}</small>}
            <label>Tabs <small>{tabs.length}/{lim.tabs} tabs · {items.length}/{lim.links} links</small></label>
            <small className="mlcount">Drag a tab to move it. Hidden tabs (🚫) are left out of your live card and preview.</small>
            <EditTabBars tabs={tabs} at={Math.min(at, tabs.length - 1)} onSelect={setAt} onMove={moveTab} />
            {tabs.length < lim.tabs
              ? <button type="button" className="ghost" onClick={addTab}>+ Add a tab</button>
              /* Upgrade is off for now: : !lim.pro ? <button type="button" className="ghost bluebtn" onClick={() => setUpgrade('tabs')}>⭐ Upgrade to add more tabs</button> */
              : <small className="mlcount">You have reached {lim.tabs} tabs.</small>}

            {cur && (
              <div className="mltab">
                <div className="mltabhead">
                  <input value={cur.name} maxLength={TAB_NAME_MAX} onChange={(e) => setTab(tabs.indexOf(cur), { name: e.target.value })} placeholder={`Tab name (${TAB_NAME_MAX} letters max)`} />
                  <button type="button" className="ghost mlhide" aria-label={cur.hidden ? 'Show this tab' : 'Hide this tab'} title={cur.hidden ? 'Hidden. Tap to show it again' : 'Tap to hide this tab'} onClick={() => setTab(tabs.indexOf(cur), { hidden: !cur.hidden })}>
                    {cur.hidden ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                  {!cur.main && <button type="button" className="ghost danger mldel" aria-label="Delete tab" title="Delete tab" onClick={() => deleteTab(tabs.indexOf(cur))}><Trash size={18} /></button>}
                </div>
                <input className="mltabdescin" value={cur.desc || ''} placeholder={`Tab description, optional (${MAX_TAB_WORDS} words max)`}
                  onChange={(e) => {
                    // a tab's description stops at the word limit, and a small popup says so
                    if (words(e.target.value) > MAX_TAB_WORDS) return toast(`Maximum words limit: ${MAX_TAB_WORDS}`)
                    setTab(tabs.indexOf(cur), { desc: e.target.value })
                  }} />
                <div className="mldescpos" role="radiogroup" aria-label="Where the description shows">
                  <span>Description shows</span>
                  <Seg value={!!cur.desc_below} onChange={(v) => setTab(tabs.indexOf(cur), { desc_below: v })} options={[[false, 'Above the links'], [true, 'Below the links']]} />
                </div>
                {cur.hidden && <small className="mlcount">This tab is hidden: it is not on your live card or preview.</small>}
                {cur.main ? (
                  <>
                    <small className="mlcount">This tab holds all your links.</small>
                    {items.map((l) => (
                      <div className="mlrow2" key={l.id}>
                        <LinkIcon icon={l.icon} host={hostOf(l.url)} size={36} />
                        <span><b>{l.name}{l.adult && <em className="mlbadge">18+</em>}</b><small>{hostOf(l.url)}</small></span>
                        <button type="button" className="ghost" aria-label="Edit link" onClick={() => setModal(l)}><Pen size={16} /></button>
                        <button type="button" className="ghost mldel" aria-label="Delete link" onClick={() => removeItem(l.id)}><Trash size={16} /></button>
                      </div>
                    ))}
                    {items.length < lim.links
                      ? <button type="button" className="ghost bluebtn" onClick={() => setModal({})}>+ Add link</button>
                      /* Upgrade is off for now: : !lim.pro ? <button type="button" className="ghost bluebtn" onClick={() => setUpgrade('links')}>⭐ Upgrade to add more links</button> */
                      : <small className="mlcount">You have reached {lim.links} links.</small>}
                  </>
                ) : (
                  <>
                    <small className="mlcount">{cur.item_ids.length}/{MAX_PER_TAB} links. Visitors only see a tab once it has links.</small>
                    {items.length ? (
                      <div className="mlpick">
                        {items.map((l) => (
                          <label key={l.id} className="mlrow">
                            <input type="checkbox" checked={cur.item_ids.includes(l.id)} disabled={!cur.item_ids.includes(l.id) && cur.item_ids.length >= MAX_PER_TAB} onChange={() => toggle(tabs.indexOf(cur), l.id)} />
                            <LinkIcon icon={l.icon} host={hostOf(l.url)} size={28} /><span>{l.name}<small>{hostOf(l.url)}</small></span>
                          </label>
                        ))}
                      </div>
                    ) : <p className="hint">Add links in the first tab, then choose which ones belong here.</p>}
                  </>
                )}
              </div>
            )}

            <div className="mlsave">
              <button className="ghost bluebtn" disabled={busy || !handle || nameChk.ok === false} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>
              {saved && <>
                <button className="ghost" onClick={copy}>Copy link</button>
                <a className="ghost" href={pathOf(saved)} target="_blank" rel="noopener noreferrer">View page</a>
              </>}
            </div>
            {saved && <small className="mladdr">{addressOf(saved)}</small>}
            {page && <button type="button" className="ghost danger mldelcard" onClick={deleteCard}>Delete card</button>}
            </div>
          </div>
        </div>
      )}
      {statusOpen && <StatusModal status={status} onChange={setStatus} onClose={() => setStatusOpen(false)} />}
      {statsOpen && page && <CardStatsModal cards={[{ id: page.id, name: page.name || page.handle }]} initialId={page.id} onClose={() => setStatsOpen(false)} />}
      {modal && <LinkModal item={modal} onClose={() => setModal(null)} onSave={saveItem} />}
      {socModal && (
        <SocialModal item={socModal.index >= 0 ? socials[socModal.index] : null} taken={socials.map((x) => x.kind)} onClose={() => setSocModal(null)}
          onRemove={() => { setSocials((all) => all.filter((_, i) => i !== socModal.index)); setSocModal(null) }}
          onSave={(v) => { setSocials((all) => (socModal.index >= 0 ? all.map((x, i) => (i === socModal.index ? v : x)) : [...all, v])); setSocModal(null) }} />
      )}
      {/* {upgrade && <UpgradeModal what={upgrade} limits={lim} onClose={() => { setUpgrade(false); reload() }} />} */}
    </>
  )
}

/* Edit Card, at /ocard: your cards (up to 3), each with Edit / View / Delete, and a button to make a new one */
export default function MyCards() {
  const nav = useNavigate()
  const loc = useLocation()
  // from the list of cards, back goes to the home page, or to Settings when that is where you came from
  const from = typeof loc.state?.back === 'string' && loc.state.back.startsWith('/') ? loc.state.back : null
  const back = () => (from && window.history.state?.idx > 0 ? nav(-1) : nav(from || '/discover', { replace: !!from }))
  const { toast, confirm } = useApp()
  const { data, loading, reload } = useFetch('/linkpage/', [])
  const [upgrade, setUpgrade] = useState(false)
  const [stats, setStats] = useState(null)        // the card whose analytics are open
  // the first time someone opens their cards they get a step-by-step guide (skip it, or read each step); the ? reopens it
  const { user: me } = useApp()
  const guideKey = `opio.ocardGuide.${me?.id || 0}`
  const [guide, setGuide] = useState(() => { try { return !localStorage.getItem(guideKey) } catch { return false } })
  const closeGuide = () => { setGuide(false); try { localStorage.setItem(guideKey, '1') } catch { /* private mode */ } }
  useTopBar({ back, center: 'Edit Card', hideTabs: true }, [])
  if (loading && !data) return <Skel />      // (every hook is above this line)
  const pages = data?.pages || []
  const max = data?.max || 3
  const lim = data?.limits || { pro: false, cards: 3, tabs: 4, links: 30 }
  const remove = async (p) => {
    if (!(await confirm({ title: 'Delete card?', message: `“${p.name || p.handle}” and its address will be deleted for good.`, label: 'Delete' }))) return
    try { await api.delete(`/linkpage/${p.id}/`); toast('Card deleted'); reload() } catch (e) { toast(errMsg(e)) }
  }
  // choose which card shows on your profile ("View Card"); tap the chosen one again to show none
  const choose = async (p) => {
    try { await api.patch(`/linkpage/${p.id}/`, { on_profile: !p.on_profile }); toast(p.on_profile ? 'No card on your profile' : 'Shown on your profile'); reload() } catch (e) { toast(errMsg(e)) }
  }
  return (
    <main className="mlcards">
      <h2>My cards <small>{pages.length}/{max}</small> <button type="button" className="ghost ochelp" aria-label="How OCARD works" title="Questions? See how OCARD works" onClick={() => setGuide(true)}><BulbI size={18} /></button></h2>
      {pages.length === 0 && <p className="hint">You have no cards yet. A card is a page of your links that you can share.</p>}
      {pages.map((p) => (
        <div className="mlcrow" key={p.id}>
          <span><b>{p.name || p.handle}</b><small>{location.host}{pathOf(p.handle)} · {p.items.length} link{p.items.length === 1 ? '' : 's'}</small></span>
          <button type="button" className={`ghost ${p.on_profile ? 'bluebtn' : ''}`} title="The card people see with View Card on your profile" aria-pressed={p.on_profile} onClick={() => choose(p)}>{p.on_profile ? '✓ On profile' : 'Show on profile'}</button>
          <button type="button" className="ghost" onClick={() => nav(`/ocard/${p.id}`)}>Edit</button>
          <button type="button" className="ghost" onClick={() => setStats(p.id)}>Analytics</button>
          <a className="ghost" href={pathOf(p.handle)} target="_blank" rel="noopener noreferrer">View</a>
          <button type="button" className="ghost mldel" aria-label="Delete card" onClick={() => remove(p)}><Trash size={16} /></button>
        </div>
      ))}
      {pages.length < max
        ? <button type="button" className="ghost bluebtn" onClick={() => nav('/ocard/new')}>+ New card</button>
        /* Upgrade is off for now: : !lim.pro ? <button type="button" className="ghost bluebtn" onClick={() => setUpgrade(true)}>⭐ Upgrade to add more cards</button> */
        : <small className="mlcount">You have reached {max} cards. Delete one to make another.</small>}
      {/* {upgrade && <UpgradeModal what="cards" limits={lim} onClose={() => { setUpgrade(false); reload() }} />} */}
      {guide && <OCardGuide onClose={closeGuide} />}
      {stats && <CardStatsModal cards={pages.map((p) => ({ id: p.id, name: p.name || p.handle }))} initialId={stats} onClose={() => setStats(null)} />}
    </main>
  )
}
