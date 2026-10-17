import { useState } from 'react'
import { api, errMsg } from '../api'
import { useBack } from '../routing'
import { useApp, useFetch, useTopBar } from '../context'
import { QrModal } from '../components/LazyModals'

const shortUrl = (code) => `${location.origin}/s/${code}`

/* Otin: turn a long link into a short one (yoursite/s/abc123, or a name of your own), copy or share it, and see how many times it was used. */
export default function Otin() {
  const { toast, confirm } = useApp()
  const back = useBack()
  useTopBar({ back, hideTabs: true, center: 'Otin', right: <span /> }, [])
  const { data, reload } = useFetch('/shortlinks/', [])
  const [url, setUrl] = useState('')
  const [alias, setAlias] = useState('')
  const [busy, setBusy] = useState(false)
  const [qr, setQr] = useState(null)
  const list = data || []

  const create = async (e) => {
    e.preventDefault()
    if (!url.trim() || busy) return
    setBusy(true)
    try {
      const { data: s } = await api.post('/shortlinks/', { url, alias })
      setUrl(''); setAlias(''); reload()
      try { await navigator.clipboard.writeText(shortUrl(s.code)); toast('Short link made and copied') } catch { toast('Short link made') }
    } catch (x) { toast(errMsg(x)) } finally { setBusy(false) }
  }
  const copy = async (s) => { try { await navigator.clipboard.writeText(shortUrl(s.code)); toast('Copied') } catch { toast(shortUrl(s.code)) } }
  const share = async (s) => {
    if (navigator.share) { try { await navigator.share({ title: 'Short link', url: shortUrl(s.code) }) } catch { /* cancelled */ } return }
    copy(s)
  }
  const remove = async (s) => {
    if (!(await confirm({ title: 'Delete this short link?', message: `${shortUrl(s.code)} will stop working for everyone who has it.`, label: 'Delete' }))) return
    try { await api.delete(`/shortlinks/${s.id}/`); toast('Deleted'); reload() } catch (x) { toast(errMsg(x)) }
  }

  return (
    <main className="slpage">
      <form className="slform" onSubmit={create}>
        <label htmlFor="sl-url">Long link</label>
        <input id="sl-url" type="url" inputMode="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Paste the link you want to shorten" autoCapitalize="none" spellCheck={false} />
        <label htmlFor="sl-alias">Short name <small>optional</small></label>
        <div className="slalias">
          <span>{location.host}/s/</span>
          <input id="sl-alias" value={alias} onChange={(e) => setAlias(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ''))} maxLength={30} placeholder="my-link" autoCapitalize="none" spellCheck={false} />
        </div>
        <button type="submit" className="go" disabled={!url.trim() || busy}>{busy ? '…' : 'Shorten'}</button>
      </form>

      <h2 className="slhead">Your short links <small>{list.length}</small></h2>
      {data && !list.length && <p className="hint">You haven’t made a short link yet. Paste a long link above.</p>}
      <div className="sllist">
        {list.map((s) => (
          <article className="slrow" key={s.id}>
            <div className="sltop">
              <a className="slshort" href={shortUrl(s.code)} target="_blank" rel="noopener noreferrer" title="Open this short link"><b>{location.host}/s/{s.code}</b></a>
              <span className="slclicks">{s.clicks} click{s.clicks === 1 ? '' : 's'}</span>
            </div>
            <small className="sltarget" title={s.url}>{s.url}</small>
            <div className="slbtns">
              <button type="button" className="ghost" onClick={() => copy(s)}>Copy</button>
              <button type="button" className="ghost" onClick={() => share(s)}>Share</button>
              <button type="button" className="ghost" onClick={() => setQr(s)}>QR code</button>
              <button type="button" className="ghost sldel" onClick={() => remove(s)}>Delete</button>
            </div>
          </article>
        ))}
      </div>
      {qr && <QrModal open url={shortUrl(qr.code)} title="Short link" hint="Scan to open" onClose={() => setQr(null)} />}
    </main>
  )
}
