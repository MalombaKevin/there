import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { api, errMsg } from '../api'
import { useApp } from '../context'
import { useNameCheck } from '../lib'

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID

// Google's sign-in script is only needed here, so it loads on demand instead of on every page
function loadGoogleScript() {
  if (document.getElementById('gsi-script')) return
  const s = document.createElement('script')
  s.id = 'gsi-script'; s.src = 'https://accounts.google.com/gsi/client'; s.async = true; s.defer = true
  document.head.appendChild(s)
}

/* Log in / sign up, Claude style.
   /login and /signup: choose Google or "Continue with email".
   /login/email and /signup/email: the email form on its own page. */
export default function Login({ mode = 'login', step = 'choose' }) {
  const { login } = useApp()
  const nav = useNavigate()
  const signup = mode === 'signup'
  const loc = useLocation()
  const [f, setF] = useState({ username: '', email: '', password: '' })
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const gbtn = useRef()
  const nameChk = useNameCheck('username', signup && step === 'email' ? f.username : '')
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })

  const finish = async (p) => {
    setBusy(true); setErr('')
    try { const { data } = await p(); login(data) }
    catch (e) { setErr(errMsg(e)) } finally { setBusy(false) }
  }

  // Google Identity Services button (landing pages only)
  useEffect(() => {
    if (!CLIENT_ID || step !== 'choose') return
    loadGoogleScript()
    let stop = false
    const init = () => {
      if (stop) return
      if (!window.google?.accounts?.id) return setTimeout(init, 200)
      window.google.accounts.id.initialize({
        client_id: CLIENT_ID,
        callback: (r) => finish(() => api.post('/auth/google/', { credential: r.credential })),
      })
      if (gbtn.current) window.google.accounts.id.renderButton(gbtn.current, { theme: 'outline', size: 'large', width: Math.min(400, gbtn.current.offsetWidth || 400), text: 'continue_with', shape: 'rectangular' })
    }
    init()
    return () => { stop = true }
  }, [step]) // eslint-disable-line

  const submit = (e) => {
    e.preventDefault()
    if (signup) finish(() => api.post('/auth/register/', { username: f.username, email: f.email, password: f.password }))
    else finish(() => api.post('/auth/login/', { identifier: f.email, email: f.email, username: f.email, password: f.password }))
  }

  const other = signup
    ? <>Already have an account? <Link to="/login" state={loc.state}>Log in</Link></>
    : <>Don’t have an account? <Link to="/signup" state={loc.state}>Sign up</Link></>

  return (
    <div className="cl-page">
      <main className="cl-card">
        {step === 'email' && <button className="cl-back" onClick={() => nav(signup ? '/signup' : '/login', { state: loc.state })} aria-label="Back">←</button>}
        <div className="cl-logo">OPIOW<span>.</span></div>
        <h1 className="cl-title">
          {step === 'choose' ? (signup ? 'Create your OPIOW account' : 'Save it. Sort it. Share it.') : signup ? 'Sign up with email' : 'Log in with email'}
        </h1>
        <p className="cl-sub">
          {step === 'choose' ? (signup ? 'Keep every link you love in one place.' : 'Log in to your OPIOW account.') : signup ? 'Choose a username to get started.' : 'Enter your email or username and password.'}
        </p>

        {step === 'choose' ? (
          <>
            <div className="cl-gwrap">
              <button className="cl-btn" type="button" onClick={() => { if (!CLIENT_ID) setErr('Google sign-in is not configured. Set VITE_GOOGLE_CLIENT_ID (see README).') }}>
                <svg viewBox="0 0 48 48" width="20" height="20" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.5 17.7 9.5 24 9.5z" /><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4.1 7.1-10.1 7.1-17.5z" /><path fill="#FBBC05" d="M10.5 28.7A14.5 14.5 0 0 1 9.5 24c0-1.6.3-3.2.8-4.7l-7.9-6.1A24 24 0 0 0 0 24c0 3.9.9 7.5 2.6 10.8l7.9-6.1z" /><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.9 2.3-8.4 2.3-6.3 0-11.6-4-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z" /></svg>
                Continue with Google
              </button>
              {CLIENT_ID && <div className="cl-gsi" ref={gbtn} />}
            </div>
            <div className="cl-or"><span>OR</span></div>
            <button className="cl-btn" type="button" onClick={() => nav(signup ? '/signup/email' : '/login/email', { state: loc.state })}>
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></svg>
              Continue with email
            </button>
            <div className="err">{err}</div>
          </>
        ) : (
          <form onSubmit={submit} className="cl-form">
            {signup && (
              <>
                <label htmlFor="username">Username</label>
                <input id="username" value={f.username} onChange={set('username')} placeholder="Username" autoComplete="username" required autoFocus />
                {nameChk.msg && <small className={`namechk ${nameChk.ok ? 'ok' : 'bad'}`}>{nameChk.ok ? '✓ ' : ''}{nameChk.msg}</small>}
              </>
            )}
            <label htmlFor="email">{signup ? 'Email' : 'Email or username'}</label>
            <input id="email" value={f.email} onChange={set('email')} type={signup ? 'email' : 'text'} placeholder={signup ? 'Email' : 'Email or username'}
              autoComplete={signup ? 'email' : 'username'} required autoFocus={!signup} />
            <label htmlFor="password">Password</label>
            <input id="password" value={f.password} onChange={set('password')} type="password" placeholder="Password"
              autoComplete={signup ? 'new-password' : 'current-password'} required minLength={signup ? 8 : 1} />
            <div className="err">{err}</div>
            <button className="cl-btn cl-primary" disabled={busy || (signup && nameChk.ok === false)}>{busy ? 'Please wait…' : signup ? 'Create account' : 'Log in'}</button>
          </form>
        )}

        <p className="cl-switch">{other}</p>
        <Link className="cl-explore" to="/discover" replace>Keep Exploring</Link>
      </main>
    </div>
  )
}
