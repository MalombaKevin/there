import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import { Modal } from './ui'
import { X } from '../icons'

const num = (n) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n || 0))
const day = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short' })

/* The owner's quick look at one posted link: the last 7 days of views, saves, shares and reactions.
   View more opens the Analytics page on this link, with every period to choose from. */
export default function LinkStatsModal({ link, onClose }) {
  const nav = useNavigate()
  const [data, setData] = useState(null)
  const [err, setErr] = useState(false)
  useEffect(() => {
    if (!link) return
    let live = true
    setErr(false)
    api.get(`/links/${link.id}/stats/?days=7`).then((r) => live && setData(r.data)).catch(() => live && setErr(true))
    return () => { live = false }
  }, [link?.id]) // eslint-disable-line
  if (!link) return null
  const peak = Math.max(1, ...(data?.trend || []).map((d) => d.view + d.save + d.share))
  const tiles = data ? [['Views', data.view], ['Saves', data.save], ['Shares', data.share], ['Reactions', data.react]] : []
  const more = () => {
    onClose()
    nav(`/analytics?tab=links&link=${link.id}`, { state: { back: location.pathname + location.search } })
  }
  return (
    <Modal onClose={onClose} className="center">
      <div className="sheet linkstats big" onClick={(e) => e.stopPropagation()} style={{ position: 'relative' }}>
        <button className="qrx" onClick={onClose} aria-label="Close"><X size={18} /></button>
        <h2>Link analytics <small className="lsdays">last 7 days</small></h2>
        <p className="lsname" title={link.title}>{link.title}</p>
        {err && <p>Could not load the numbers. Try again.</p>}
        {!data && !err && <p>Loading…</p>}
        {data && (
          <>
            <div className="atiles">
              {tiles.map(([label, n]) => <div className="atile" key={label}><b>{num(n)}</b><span>{label}</span></div>)}
            </div>
            <h3 className="lssub">Reactions</h3>
            {Object.keys(data.reactions).length
              ? <div className="lsrx">{Object.entries(data.reactions).map(([e, n]) => <span key={e} className="rx">{e} {n}</span>)}</div>
              : <p className="lsnone">No reactions from others yet.</p>}
            <h3 className="lssub">Day by day</h3>
            <div className="lstrend">
              {data.trend.map((d) => {
                const t = d.view + d.save + d.share
                return (
                  <div key={d.date} title={`${d.view} views, ${d.save} saves, ${d.share} shares`}>
                    <b className="lsn">{t || ''}</b>
                    <i style={{ height: `${Math.max(4, (t / peak) * 100)}%`, opacity: t ? 1 : 0.3 }} />
                    <small>{day(d.date)}</small>
                  </div>
                )
              })}
            </div>
            {!data.public && <p className="lsnone">This link is private, so nobody else can see it yet.</p>}
            <div className="lsmore"><button type="button" className="go" onClick={more}>View more</button></div>
          </>
        )}
      </div>
    </Modal>
  )
}
