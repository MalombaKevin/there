import { useNavigate } from 'react-router-dom'
import { createPortal } from 'react-dom'
import { useApp } from '../context'
import { Avatar, usePopupMenu } from './ui'
import { PickFriendModal, QrModal } from './LazyModals'
import LinkStatsModal from './LinkStatsModal'
import { Dots } from '../icons'
import { api, fav, isVideoUrl, thum } from '../api'
import { clipWords } from '../lib'
import { haptic } from '../gestures'
import { memo, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'

// true on phones (and follows the screen if it is resized or turned)
const PHONE = '(max-width: 720px)'
const usePhone = () => useSyncExternalStore(
  (cb) => { const m = window.matchMedia(PHONE); m.addEventListener('change', cb); return () => m.removeEventListener('change', cb) },
  () => window.matchMedia(PHONE).matches,
  () => false,
)

const REACTIONS = ['❤️', '🔥', '😂', '👏', '😮']
// more to choose from behind the + (or type any emoji of your own)
const USAGE_KEY = 'opio.reactionUse'
const topFive = () => {
  try {
    const use = JSON.parse(localStorage.getItem(USAGE_KEY) || '{}')
    const mine = Object.entries(use).sort((a, b) => b[1] - a[1]).map(([e]) => e)
    return [...new Set([...mine, ...REACTIONS])].slice(0, 5)     // your favourites first, then the usual ones to fill the five
  } catch { return REACTIONS }
}
const noteUse = (e) => { try { const use = JSON.parse(localStorage.getItem(USAGE_KEY) || '{}'); use[e] = (use[e] || 0) + 1; localStorage.setItem(USAGE_KEY, JSON.stringify(use)) } catch { /* private mode */ } }
const MORE_EMOJIS = ['👍', '👎', '😍', '🥰', '😎', '🤩', '😢', '😭', '😡', '🤔', '🙌', '🙏', '💯', '✨', '🎉', '💪', '👀', '🤯', '🥳', '😅', '😇', '🤣', '💔', '🌟']
// the first emoji in what was typed (a single emoji can be several characters), or '' when it isn't one
const firstEmoji = (text) => {
  const t = (text || '').trim()
  if (!t) return ''
  const first = typeof Intl !== 'undefined' && Intl.Segmenter ? [...new Intl.Segmenter().segment(t)][0].segment : [...t][0]
  return [...first].every((c) => c.charCodeAt(0) > 127 && !/\p{L}/u.test(c)) ? first : ''
}

// a card only redraws when something it shows changed (the grid rebuilds link objects on every render)
const sameCard = (a, b) => {
  const x = a.link
  const y = b.link
  return a.view === b.view && a.playlist === b.playlist && a.videos === b.videos && a.user?.id === b.user?.id && a.menuItems?.length === b.menuItems?.length &&
    (x === y || (x.id === y.id && x.url === y.url && x.title === y.title && x.description === y.description && x.image === y.image && x.tag === y.tag &&
      x.adult === y.adult && x.reactions === y.reactions && x.my_reaction === y.my_reaction && x.owner === y.owner))
}

const PAGE = 18   // cards drawn at a time; more are added as you scroll

/* One link, rendered as a slim row (list) or a photo-left card (square / masonry).
   Extras: swipe a card (phones) to save or send it, press and hold to peek, tap an emoji to react. */
const Card = memo(function Card({ link, view, menuItems, onPoster, playlist, videos, setViewer, toast, user }) {
  const [friend, setFriend] = useState(null)
  const [qrOpen, setQrOpen] = useState(false)
  const [statsOpen, setStatsOpen] = useState(false)
  const [openMenu, menuEl] = usePopupMenu()
  const [tries, setTries] = useState(0)
  const [dx, setDx] = useState(0)          // swipe distance
  const [peek, setPeek] = useState(false)  // press-and-hold preview
  const [rx, setRx] = useState({ reactions: link.reactions, mine: link.my_reaction })
  const [picking, setPicking] = useState(false)
  const phone = usePhone()
  const [tray, setTray] = useState(false)      // the + : choose any emoji, or type your own
  const [typed, setTyped] = useState('')
  const t = useRef({ x: 0, y: 0, hold: null, held: false, swiping: false })
  const open = () => {
    if (t.current.held) { t.current.held = false; return } // the tap that ends a long-press is not a click
    // a video opens with the player controls (next, previous, autoplay, repeat, full mode) over the videos in this list
    const list = playlist || (isVideoUrl(link.url) ? videos : null)
    setViewer(list ? { ...link, playlist: list } : link)
  }
  const chain = [link.image, link.image ? `https://images.weserv.nl/?w=700&url=${encodeURIComponent(link.image.replace(/^https?:\/\//, ''))}` : '', thum(link.url)]
    .filter((x) => x && (x.startsWith('http') || x.startsWith('data:') || x.startsWith('/')))
  const src = chain[tries]
  const list = view === 'list'
  // every card can copy its link, share it to other apps and send it to an OPAL
  const copy = async () => { try { await navigator.clipboard.writeText(link.url); toast('Link copied') } catch { toast(link.url) } }
  const share = async () => {
    if (typeof link.id === 'number') api.post('/events/', { kind: 'share', link_id: link.id }).catch(() => {})
    if (navigator.share) { try { await navigator.share({ title: link.title, url: link.url }) } catch { /* cancelled */ } return }
    copy()
  }
  // the owner of a link sees Analytics in its menu, public or private (nobody else does); on your Mine page that is every link you made
  const isMine = !!user && !link.react_path && typeof link.id === 'number' && link.source === 'mine' && (!link.owner || link.owner.id === user.id)
  const base = menuItems || []
  const has = (l) => base.some((i) => i.label === l)
  const extra = [
    ...(has('Send to an OPAL') || !user ? [] : [{ label: 'Send to an OPAL', fn: () => setFriend(link) }]),
    { label: 'Share', fn: share },
    { label: 'QR code', fn: () => setQrOpen(true) },
    { label: 'Copy link', fn: copy },
    ...(isMine ? [{ label: 'Analytics', fn: () => setStatsOpen(true) }] : []),
  ]
  // Share / Copy link sit above the destructive options (Block, Delete, Remove...)
  const firstDanger = base.findIndex((i) => i.danger)
  const items = firstDanger < 0 ? [...base, ...extra] : [...base.slice(0, firstDanger), ...extra, ...base.slice(firstDanger)]
  const poster = user && link.owner && link.owner.id !== user.id ? link.owner : null // never show my own profile on a link, and nobody's when logged out
  const tag = link.tag

  // --- gestures (touch) ---
  const saveItem = base.find((i) => i.label === 'Save')
  const onStart = (e) => {
    const p = e.touches[0]
    t.current = { x: p.clientX, y: p.clientY, held: false, swiping: false, hold: setTimeout(() => { t.current.held = true; haptic(15); setPeek(true) }, 450) }
  }
  const onMove = (e) => {
    const p = e.touches[0]
    const mx = p.clientX - t.current.x
    const my = p.clientY - t.current.y
    if (Math.abs(mx) > 10 || Math.abs(my) > 10) clearTimeout(t.current.hold)
    if (!t.current.swiping && Math.abs(mx) > 14 && Math.abs(mx) > Math.abs(my) * 1.5) t.current.swiping = true
    if (t.current.swiping) setDx(Math.max(-140, Math.min(140, mx)))
  }
  const onEnd = () => {
    clearTimeout(t.current.hold)
    setPeek(false)
    if (t.current.swiping) {
      if (dx > 90 && user) { haptic(20); setFriend(link) } else if (dx < -90 && saveItem) { haptic(20); saveItem.fn() }
      t.current.swiping = false
      t.current.held = true    // swallow the click that follows the swipe
      setTimeout(() => { t.current.held = false }, 50)
    }
    setDx(0)
  }
  const mouseHold = {
    onMouseDown: () => { t.current.hold = setTimeout(() => { t.current.held = true; setPeek(true) }, 500) },
    onMouseUp: () => { clearTimeout(t.current.hold); setPeek(false) },
    onMouseLeave: () => { clearTimeout(t.current.hold); setPeek(false) },
  }

  // --- reactions ---
  // every posted link can be reacted to, including your own: public links, and links on boards (those react through their own address)
  const canReact = !!user && link.reactions !== undefined && (!!link.react_path || (typeof link.id === 'number' && !!link.is_public && link.source !== 'saved'))
  const react = async (emoji) => {
    setPicking(false); setTray(false); setTyped('')
    haptic(10)
    noteUse(emoji)
    const off = rx.mine === emoji
    try {
      const { data } = await api.post(link.react_path || `/links/${link.id}/react/`, { emoji: off ? '' : emoji })
      setRx({ reactions: data.reactions, mine: data.my_reaction })
    } catch { /* ignore */ }
  }
  const shownRx = Object.entries(rx.reactions || {}).filter(([, n]) => n > 0)

  const dots = items.length > 0 && (
    <button className={`dots ${list ? 'inrow' : ''}`} aria-label="More options" onClick={(e) => openMenu(e, items)}><Dots /></button>
  )
  const posterBtn = poster && (
    <button className="poster inline" title={`${poster.name} (@${poster.username})`} aria-label={`View ${poster.name}'s profile`}
      onClick={(e) => { e.stopPropagation(); onPoster?.(poster) }}>
      <Avatar u={poster} />
    </button>
  )
  return (
    <article className={`shop ${list ? 'compact' : ''}`} onClick={list ? open : undefined}
      style={dx ? { transform: `translateX(${dx}px)`, transition: 'none' } : undefined}
      onTouchStart={onStart} onTouchMove={onMove} onTouchEnd={onEnd} onTouchCancel={onEnd} {...mouseHold}>
      {dx !== 0 && <><span className="swhint l" style={{ opacity: Math.min(1, dx / 90) }}>Send</span><span className="swhint r" style={{ opacity: Math.min(1, -dx / 90) }}>{saveItem ? 'Save' : ''}</span></>}
        <div className="awning" />
        <div className="thumb" onClick={open}>
          <div className="letter">
            {tries >= chain.length ? <img alt="" src={link.logo || fav(link.host)} style={{ position: 'static', width: 52, height: 52, borderRadius: 12, background: '#fff', padding: 5, objectFit: 'contain' }} /> : (link.host || '?')[0].toUpperCase()}
          </div>
          {src && tries < chain.length && <img alt="" src={src} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setTries((t2) => t2 + 1)} />}
          {tag && <span className="tag">{tag}</span>}
          {link.adult && <span className="adult">18+</span>}
          {!list && dots}
        </div>
        <div className="info">
          <div className="row">
            <img alt="" src={link.logo || fav(link.host)} loading="lazy" decoding="async" onError={(e) => (e.currentTarget.style.display = 'none')} />
            <div style={{ minWidth: 0 }}>
              <div className="title" title={link.title}>{view === 'square' ? clipWords((link.title || '').replace(/\s+[-–—·|:•]+\s+/g, ' '), 2, '...') : clipWords(link.title, 10)}</div>
              <div className="host">{list ? [link.host, tag, link.adult ? '18+' : ''].filter(Boolean).join(' · ') : link.host}</div>
              {!list && poster && <div className="host by">@{poster.username}</div>}
            </div>
            {posterBtn}
            {list && dots}
          </div>
          <div className="desc">{clipWords(link.description, phone ? 8 : 14, '...')}</div>
          {(canReact || shownRx.length > 0) && (
            <div className="rxbar" onClick={(e) => e.stopPropagation()}>
              {shownRx.map(([e, n]) => <button key={e} className={`rx ${rx.mine === e ? 'mine' : ''}`} disabled={!canReact} onClick={() => react(e)}>{e} {n}</button>)}
              {canReact && (picking && phone
                ? <>
                  <button className="rx add" onClick={() => setPicking(false)} aria-label="Close reactions">☺+</button>
                  {createPortal(
                    <div className="rxover" onClick={() => setPicking(false)}>
                      <div className="rxpanel" onClick={(e) => e.stopPropagation()}>
                        {tray ? (
                          // the +: your phone's emoji keyboard opens, and the first emoji you pick reacts straight away
                          <div className="rxkbd">
                            <input autoFocus value={typed} placeholder="Pick an emoji from your keyboard" maxLength={16}
                              onChange={(ev) => { const v = ev.target.value; setTyped(v); const e = firstEmoji(v); if (e) react(e) }} />
                            <button type="button" aria-label="Back" onClick={() => { setTray(false); setTyped('') }}>✕</button>
                          </div>
                        ) : (
                          <div className="rxfive">
                            {topFive().map((e) => <button key={e} type="button" onClick={() => react(e)} aria-label={`React ${e}`}>{e}</button>)}
                            <button type="button" className="rxplus" onClick={() => setTray(true)} aria-label="Add another emoji">+</button>
                          </div>
                        )}
                      </div>
                    </div>, document.body)}
                </>
                : picking
                ? <>
                  {REACTIONS.map((e) => <button key={e} className="rx pick" onClick={() => react(e)} aria-label={`React ${e}`}>{e}</button>)}
                  <button className={`rx pick plus ${tray ? 'on' : ''}`} onClick={() => setTray(!tray)} aria-label="Add your own emoji" title="Add your own emoji">+</button>
                  {tray && (
                    <div className="emojitray">
                      <form onSubmit={(ev) => { ev.preventDefault(); const e = firstEmoji(typed); if (e) react(e) }}>
                        <input value={typed} onChange={(ev) => setTyped(ev.target.value)} placeholder="Type or paste an emoji" maxLength={16} autoFocus />
                        <button type="submit" className="rx pick" disabled={!firstEmoji(typed)}>React</button>
                      </form>
                      <div className="emojigrid">{MORE_EMOJIS.map((e) => <button key={e} type="button" onClick={() => react(e)}>{e}</button>)}</div>
                    </div>
                  )}
                </>
                : <button className="rx add" onClick={() => setPicking(true)} aria-label="Add reaction">☺+</button>)}
            </div>
          )}
          <div className="actions">
            {isVideoUrl(link.url)
              ? <a href={link.url} onClick={(e) => { e.preventDefault(); e.stopPropagation(); open() }}>▶ Play</a>   // videos play in OPIOW instead of visiting the site
              : <>
                <a href={link.url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>Visit</a>
                <button className="pv" onClick={(e) => { e.stopPropagation(); open() }}>Preview</button>
              </>}
          </div>
        </div>
      {peek && createPortal(
        <div className="peek" aria-hidden="true">
          <div className="peekcard">
            {link.image ? <img alt="" src={link.image} referrerPolicy="no-referrer" /> : <div className="peeknone"><img alt="" src={link.logo || fav(link.host)} /></div>}
            <h3>{link.title}</h3>
            <small>{link.host}</small>
            {link.description && <p>{clipWords(link.description, 30)}</p>}
          </div>
        </div>, document.body)}
      {menuEl}
      {/* the popups sit on the page itself: inside the card they would be cut off by its edges */}
      {createPortal(<div style={{ display: 'contents' }} onClick={(e) => e.stopPropagation()}><PickFriendModal link={friend} onClose={() => setFriend(null)} /><LinkStatsModal link={statsOpen ? link : null} onClose={() => setStatsOpen(false)} /><QrModal open={qrOpen} url={link.url} title={link.title || 'Link'} hint="Scan to open this link" onClose={() => setQrOpen(false)} /></div>, document.body)}
    </article>
  )
}, sameCard)

export default function LinkGrid({ links, view, getMenu, empty, tagFor, playlist }) {
  const nav = useNavigate()
  const { setViewer, toast, user } = useApp()
  const [count, setCount] = useState(PAGE)
  const more = useRef(null)
  const shown = links.slice(0, count)
  const videos = useMemo(() => links.filter((l) => isVideoUrl(l.url)), [links])
  // when the sentinel under the list scrolls into view, draw the next page
  useEffect(() => {
    const el = more.current
    if (!el || count >= links.length) return
    const io = new IntersectionObserver((e) => { if (e[0].isIntersecting) setCount((c) => c + PAGE) }, { rootMargin: '600px' })
    io.observe(el)
    return () => io.disconnect()
  }, [count, links.length])
  if (!links.length) return <div className="empty">{empty}</div>
  return (
    <>
      <main className={`grid v-${view}`}>
        {shown.map((l) => (
          <Card key={`${l.id}`} link={tagFor ? { ...l, tag: tagFor(l) } : l} view={view} menuItems={getMenu?.(l)} onPoster={(p) => nav(`/u/${p.username}`)}
            playlist={playlist} videos={videos} setViewer={setViewer} toast={toast} user={user} />
        ))}
      </main>
      {count < links.length && <div ref={more} style={{ height: 1 }} aria-hidden="true" />}
    </>
  )
}
