import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom'
import { useApp } from '../context'
import { Avatar } from './ui'
import { useState } from 'react'
import { createPortal } from 'react-dom'
import { Modal } from './ui'
import { Bookmark, Folder, Grid4, Home, Mail } from '../icons'

/* What OPIOW stands for (opens from the logo at the top) */
function BrandModal({ open, onClose }) {
  // portal: the top bar has a backdrop-filter, which would otherwise pin this modal to the bar's corner
  return createPortal(
    <Modal open={open} onClose={onClose}>
      <div className="sheet dbrand-modal">
        <div className="dbrand">
          <small className="tag1">Save it. Sort it. Share it.</small>OPIOW<span>.</span>
          <small className="full"><b>O</b>nline <b>P</b>latform for <b>I</b>nternet <b>O</b>bjects <b>W</b>orldwide</small>
        </div>
        <div className="btns"><button onClick={onClose}>Close</button></div>
      </div>
    </Modal>,
    document.body
  )
}

export function TopBar() {
  const { user, top, setDrawer } = useApp()
  const back = top.back
  const loc = useLocation()
  const [brand, setBrand] = useState(false)
  return (
    <div className={`top ${top.hideTabs ? 'inboard' : ''}`}>
      <div className="tleft">
        {user || back ? (
          <button className={`pbtn ${back ? 'back' : ''}`} onClick={() => (back ? back() : setDrawer(true))} aria-label={back ? 'Back' : 'Open profile'}>
            <Avatar u={user} />
            <span className="bk" aria-hidden="true">←</span>
          </button>
        ) : <Link className="loginbtn" to="/login" state={{ from: loc.pathname + loc.search }}>Log in</Link>}
        {top.left}
      </div>
      <div className="logo sm">{top.center || <button className="logobtn" aria-label="About OPIOW" onClick={() => setBrand(true)}>OPIOW<span>.</span></button>}</div>
      <BrandModal open={brand} onClose={() => setBrand(false)} />
      {/* on PC the Home / Mine / Boards / Inbox tabs are on every page; a page's own buttons (counts, menus) stay at the far right */}
      <div className="tright">
        <nav className="tabs">
          <NavLink to="/discover" className={({ isActive }) => (isActive ? 'on' : '')} end>Home</NavLink>
          <NavLink to="/malinks" className={({ isActive }) => (isActive ? 'on' : '')}>Malinks</NavLink>
          <NavLink to="/ogems" className={({ isActive }) => (isActive ? 'on' : '')}>OGems</NavLink>
          <NavLink to="/boards" className={({ isActive }) => (isActive ? 'on' : '')}>Boards</NavLink>
          <NavLink to="/inbox" className={({ isActive }) => (isActive ? 'on' : '')}>Inbox<InboxBadge /></NavLink>
        </nav>
        {top.right && <span className="tacts">{top.right}</span>}
      </div>
    </div>
  )
}

export function BottomNav() {
  const loc = useLocation()
  const inHome = ['/discover', '/friends', '/saved', '/'].includes(loc.pathname)
  const cls = (on) => (on ? 'on' : '')
  return (
    <nav className="bnav">
      <NavLink to="/discover" className={cls(inHome)}><Home size={22} /><span>Home</span></NavLink>
      <NavLink to="/malinks" className={({ isActive }) => cls(isActive)}><Bookmark size={22} /><span>Malinks</span></NavLink>
      {/* OGems sits in the middle as a round button that rises out of the bar */}
      <NavLink to="/ogems" className={({ isActive }) => `bcenter ${cls(isActive)}`} aria-label="OGems"><i className="bcirc"><Grid4 size={26} /></i></NavLink>
      <NavLink to="/boards" className={({ isActive }) => cls(isActive)}><Folder size={22} /><span>Boards</span></NavLink>
      <NavLink to="/inbox" className={({ isActive }) => cls(isActive)}><Mail size={22} /><span>Inbox</span><InboxBadge /></NavLink>
    </nav>
  )
}

/* New messages + friend requests waiting in the Inbox */
function InboxBadge() {
  const { user, counts } = useApp()
  const n = user ? (counts.messages || 0) + (counts.requests || 0) + (counts.followers || 0) : 0
  return n > 0 ? <span className="badge" aria-label={`${n} new`}>{n > 99 ? '99+' : n}</span> : null
}
