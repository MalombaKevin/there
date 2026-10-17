import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useBack } from '../routing'
import { useApp, useFetch, useTopBar } from '../context'
import { Modal } from '../components/ui'
import { PickFriendModal, QrModal } from '../components/LazyModals'
import { X } from '../icons'

/* OGems: handy gems of what OPIOW can do for you, one card for each. */

/* Share something: share it out, send it to an OPAL, show its QR code or copy the link.
   `targets` is what can be shared (several cards: pick one first). */
function ShareModal({ heading, targets, onClose, onNeedLogin }) {
  const { toast, user } = useApp()
  const [i, setI] = useState(0)
  const [qr, setQr] = useState(false)
  const [friend, setFriend] = useState(null)
  const t = targets[Math.min(i, targets.length - 1)]
  const share = async () => {
    if (navigator.share) { try { await navigator.share({ title: t.title, url: t.url }) } catch { /* cancelled */ } return }
    copy()
  }
  const copy = async () => { try { await navigator.clipboard.writeText(t.url); toast('Link copied') } catch { toast(t.url) } }
  return (
    <Modal onClose={onClose} className="center">
      <div className="sheet ohshare" style={{ position: 'relative' }}>
        <button className="qrx" onClick={onClose} aria-label="Close"><X size={18} /></button>
        <h2>{heading}</h2>
        {targets.length > 1 && (
          <select value={i} onChange={(e) => setI(Number(e.target.value))} aria-label="Which card">
            {targets.map((x, k) => <option key={x.url} value={k}>{x.title}</option>)}
          </select>
        )}
        <p className="ohurl">{t.url}</p>
        <div className="ohopts">
          <button type="button" onClick={share}>Share</button>
          <button type="button" onClick={() => (user ? setFriend({ title: t.title, url: t.url }) : (onClose(), onNeedLogin?.('send this to an OPAL')))}>Send to an OPAL</button>
          <button type="button" onClick={() => setQr(true)}>QR code</button>
          <button type="button" onClick={copy}>Copy link</button>
        </div>
      </div>
      <QrModal open={qr} url={t.url} title={t.title} hint="Scan to open" onClose={() => setQr(false)} />
      <PickFriendModal link={friend} onClose={() => setFriend(null)} />
    </Modal>
  )
}

// The demo video of each guide: paste the YouTube link (or just its id) between the quotes. Empty = "coming soon".
const DEMOS = {
  links: '',
  boards: '',
  ocard: '',
  otin: '',
}

// the id of a YouTube video, from a link (watch, youtu.be, shorts, embed) or the id itself
const ytId = (s = '') => {
  const t = s.trim()
  if (/^[\w-]{11}$/.test(t)) return t
  const m = t.match(/(?:youtu\.be\/|[?&]v=|\/embed\/|\/shorts\/|\/live\/)([\w-]{11})/)
  return m ? m[1] : ''
}

/* A demo of a guide: a YouTube video that starts playing as soon as it opens (closing the popup stops it). */
function DemoModal({ title, video, onClose }) {
  const id = ytId(video)
  return (
    <Modal onClose={onClose} className="center">
      <div className="sheet ohdemo" style={{ position: 'relative' }}>
        <button className="qrx" onClick={onClose} aria-label="Close"><X size={18} /></button>
        <h2>{title} demo</h2>
        {id
          ? <div className="ohvideo"><iframe title={`${title} demo`} src={`https://www.youtube.com/embed/${id}?autoplay=1&rel=0&playsinline=1`} allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen /></div>
          : <p className="hint">The {title} demo video is coming soon.</p>}
      </div>
    </Modal>
  )
}

/* Shown to a logged-out visitor who presses a button that needs an account: log in (or sign up) and come back to where it leads. */
function LoginPrompt({ what, onClose, onLogin, onSignup }) {
  return (
    <Modal onClose={onClose} className="center">
      <div className="sheet ohlogin" style={{ position: 'relative' }}>
        <button className="qrx" onClick={onClose} aria-label="Close"><X size={18} /></button>
        <h2>Log in to continue</h2>
        <p>You need an account to {what}. It only takes a moment.</p>
        <div className="ohopts">
          <button type="button" className="ohgo" onClick={onLogin}>Log in</button>
          <button type="button" onClick={onSignup}>Sign up</button>
        </div>
      </div>
    </Modal>
  )
}

export default function OGems() {
  const nav = useNavigate()
  const back = useBack()
  useTopBar({ back, hideTabs: true, center: 'OGems', right: <span /> }, [])
  const { user } = useApp()
  const { data } = useFetch(user ? '/linkpage/' : null, [user?.id])         // your own numbers, only when you are logged in
  const [needLogin, setNeedLogin] = useState(null)       // a logged-out visitor pressed a button that needs an account: { what, path }
  const ask = (what, path) => setNeedLogin({ what, path })
  const [q, setQ] = useState('')
  const [demo, setDemo] = useState(null)             // the demo video popup: { title, video }
  const [sharing, setSharing] = useState(null)        // what the share popup is for: { heading, targets }
  const pages = data?.pages || []
  const hasCards = pages.length > 0

  const { data: links } = useFetch(user ? '/links/' : null, [user?.id])
  const { data: boards } = useFetch(user ? '/boards/' : null, [user?.id])
  const hasLinks = (links || []).length > 0
  const hasBoards = (boards || []).length > 0
  const { data: shorts } = useFetch(user ? '/shortlinks/' : null, [user?.id])
  const hasShort = (shorts || []).length > 0

  // every guide: which topic it belongs to, what it is, and its buttons
  const HACKS = [
    {
      id: 'ocard', topic: 'all', title: 'OCARD',
      text: 'One page with your picture, a short bio and your links in tabs. Share it by link or QR code and see who looks.',
      cta: hasCards ? 'Edit cards' : 'Create now', go: () => (user ? nav(hasCards ? '/ocard' : '/ocard/new') : ask('create your OCARD', '/ocard/new')), demo: DEMOS.ocard,
      // Share sends the page where anyone can make their own card (not your card)
      share: () => setSharing({ heading: 'Share OCARD', targets: [{ title: 'Create your OCARD', url: `${location.origin}/ocard/new` }] }),
    },
    {
      id: 'otin', topic: 'all', title: 'Otin',
      text: 'Turn a long, messy link into a short one. Pick your own short name, share it or make a QR code, and see its clicks.',
      cta: hasShort ? 'Edit Otin' : 'Shorten a link', go: () => (user ? nav('/otin') : ask('shorten your links with Otin', '/otin')), demo: DEMOS.otin,
      share: () => setSharing({ heading: 'Share Otin', targets: [{ title: 'Otin: shorten your links', url: `${location.origin}/otin` }] }),
    },
    {
      id: 'links', topic: 'all', title: 'Links',
      text: 'Keep every link in one place. Paste one and OPIOW fetches its name and picture. Keep it private or public.',
      cta: hasLinks ? 'Edit links' : 'Add links', go: () => (user ? nav('/malinks') : ask('add your links', '/malinks')), demo: DEMOS.links,
      share: () => setSharing({ heading: 'Share Links', targets: [{ title: 'Links on OPIOW', url: `${location.origin}/malinks` }] }),
    },
    {
      id: 'boards', topic: 'all', title: 'Boards',
      text: 'Gather links around a topic. Make the board public, invite OPALS to add links with you, lock it with a PIN, and share it.',
      cta: hasBoards ? 'Edit boards' : 'Add boards', go: () => (user ? nav('/boards') : ask('create a board', '/boards')), demo: DEMOS.boards,
      share: () => setSharing({ heading: 'Share Boards', targets: [{ title: 'Boards on OPIOW', url: `${location.origin}/boards` }] }),
    },
  ]
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const shown = HACKS.filter((h) => words.every((w) => `${h.title} ${h.text}`.toLowerCase().includes(w)))

  return (
    <div className="ohacks">
      <div className="ohtop">
        <input type="search" className="ohsearch" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search gems" aria-label="Search gems" autoCapitalize="none" spellCheck={false} />
        <button type="button" className="ghost ohsharepage" onClick={() => setSharing({ heading: 'Share OGems', targets: [{ title: 'OGems', url: `${location.origin}/ogems` }] })}>Share</button>
      </div>
      <div className="ohgrid">
        <div className="ohcards">
          {shown.map((h) => (
            <article className="ohcard" key={h.id}>
              <h3>{h.title}</h3>
              <p>{h.text}</p>
              <div className="ohbtns">
                <button type="button" className="go" onClick={h.go}>{h.cta}</button>
                <button type="button" className="ghost" onClick={() => setDemo({ title: h.title, video: h.demo })}>Demo</button>
                {h.share && <button type="button" className="ghost" onClick={h.share}>Share</button>}
              </div>
            </article>
          ))}
          {!shown.length && <p className="hint">{words.length ? `No gem matches “${q.trim()}”.` : 'Nothing here yet.'}</p>}
        </div>
      </div>
      {needLogin && <LoginPrompt what={needLogin.what} onClose={() => setNeedLogin(null)}
        onLogin={() => nav('/login', { state: { from: needLogin.path } })} onSignup={() => nav('/signup', { state: { from: needLogin.path } })} />}
      {demo && <DemoModal title={demo.title} video={demo.video} onClose={() => setDemo(null)} />}
      {sharing && <ShareModal heading={sharing.heading} targets={sharing.targets} onClose={() => setSharing(null)} onNeedLogin={(what) => ask(what, '/ogems')} />}
    </div>
  )
}
