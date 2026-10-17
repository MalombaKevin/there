import { useEffect } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useApp } from './context'

/* Back: the previous page, or a sensible fallback when this page was opened straight from a link. */
export function useBack(fallback = '/discover') {
  const nav = useNavigate()
  const loc = useLocation()
  const from = typeof loc.state?.back === 'string' && loc.state.back.startsWith('/') ? loc.state.back : null     // a page opened from Settings knows to come back to it
  return () => (window.history.state?.idx > 0 ? nav(-1) : nav(from || fallback, { replace: true }))
}

const TITLES = [
  [/^\/discover/, 'Discover'], [/^\/(malinks|mine)/, 'Malinks'], [/^\/friends/, 'OPALS'], [/^\/boards\/all/, 'All links'], [/^\/boards\/\d+/, 'Board'],
  [/^\/boards/, 'Boards'], [/^\/inbox\/[^/]+/, 'Chat'], [/^\/inbox/, 'Inbox'], [/^\/u\//, 'Profile'], [/^\/analytics/, 'Analytics'], [/^\/(ogems|oguide|ohacks)/, 'OGems'], [/^\/(otin|shortlink)/, 'Otin'], [/^\/s\//, 'Short link'], [/^\/admin/, 'Admin'], [/^\/ocard/, 'Edit Card'],
  [/^\/settings/, 'Settings'], [/^\/(login|signup)/, 'Welcome'],
]

/* On every page change: scroll to the top and set the browser tab title. */
export function RouteEffects() {
  const { pathname } = useLocation()
  useEffect(() => {
    window.scrollTo(0, 0)
    const t = TITLES.find(([re]) => re.test(pathname))
    document.title = t ? `${t[1]} · OPIOW` : 'OPIOW'
  }, [pathname])
  return null
}

/* Pages that need an account. Guests see a prompt on the same address and are brought back after logging in. */
export function RequireLogin({ what = 'this page', children }) {
  const { user } = useApp()
  const loc = useLocation()
  if (user) return children
  const from = loc.pathname + loc.search
  return (
    <div className="gate">
      <h2>Log in to continue</h2>
      <p>You need an account to open {what}.</p>
      <div className="gatebtns">
        <Link className="gobtn" to="/login" state={{ from }}>Log in</Link>
        <Link className="ghostbtn" to="/signup" state={{ from }}>Sign up</Link>
      </div>
      <Link className="gateback" to="/discover" replace>Continue discovering</Link>
    </div>
  )
}

/* Staff-only pages: everyone else sees "not found" (the server refuses them too). */
export function Staff({ children }) {
  const { user } = useApp()
  return user?.is_staff ? children : <NotFound />
}

/* Login / signup pages: if you are already in, go on to where you were headed. */
export function LoginRoute({ ready, children }) {
  const { user } = useApp()
  const loc = useLocation()
  const next = new URLSearchParams(loc.search).get('next')
  if (next && next.startsWith('/') && !next.startsWith('//') && !loc.state?.from) {
    // opened in a new tab with ?next=: keep it as where to go after logging in, so it survives the Log in / Sign up steps
    return <Navigate to={loc.pathname} replace state={{ from: next }} />
  }
  const from = loc.state?.from
  if (ready && user) return <Navigate to={typeof from === 'string' && from.startsWith('/') && !from.startsWith('/login') && !from.startsWith('/signup') ? from : '/discover'} replace />
  return children
}

export function NotFound() {
  const back = useBack()
  return (
    <div className="gate">
      <h2>Page not found</h2>
      <p>That address doesn’t lead anywhere on OPIOW.</p>
      <div className="gatebtns">
        <Link className="gobtn" to="/discover" replace>Go to Discover</Link>
        <button className="ghostbtn" onClick={back}>Go back</button>
      </div>
    </div>
  )
}
