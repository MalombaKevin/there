import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api } from '../api'

const SPLASH_MS = 3000     // the page shows for 3 seconds, then sends the visitor on

/* A short link: /s/<code> looks up where it goes, shows "opiow.com" for 3 seconds and then sends the visitor there. No login is needed. */
export default function ShortRedirect() {
  const { code } = useParams()
  const [state, setState] = useState('loading')       // loading | missing
  // while the splash shows, the app's own bars are hidden: it is just opiow.com
  useEffect(() => { document.body.classList.add('in-short'); return () => document.body.classList.remove('in-short') }, [])
  useEffect(() => {
    let live = true
    const wait = new Promise((r) => setTimeout(r, SPLASH_MS))
    api.get(`/s/${encodeURIComponent(code)}/`)
      .then(async (r) => { await wait; if (live) window.location.replace(r.data.url) })
      .catch(() => live && setState('missing'))
    return () => { live = false }
  }, [code])
  if (state === 'missing') {
    return (
      <div className="gate">
        <h2>This short link doesn’t exist</h2>
        <p>It may have been deleted, or the address was typed wrong.</p>
        <div className="gatebtns"><Link className="gobtn" to="/discover" replace>Go to OPIOW</Link></div>
      </div>
    )
  }
  return (
    <div className="shortsplash" role="status" aria-live="polite">
      <div className="ssbrand">opiow.com</div>
      <div className="ssbar" aria-hidden="true"><i style={{ animationDuration: `${SPLASH_MS}ms` }} /></div>
      <small>Taking you to your link…</small>
    </div>
  )
}
