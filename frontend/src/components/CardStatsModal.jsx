import { useEffect, useState } from 'react'
import { api } from '../api'
import { Modal } from './ui'
import { X } from '../icons'

const PERIODS = [[1, '1 day'], [7, '7 days'], [30, '30 days'], [90, '3 months'], [365, '1 year'], [0, 'All time']]
const num = (n) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n || 0))
const dayName = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short' })

/* The owner's numbers for a card: views, clicks on its links and shares over a chosen period, its most clicked links and the last 7 days.
   `cards` is [{ id, name }]; with several, a picker chooses which one. */
export default function CardStatsModal({ cards, initialId, onClose }) {
  const [id, setId] = useState(initialId || cards[0]?.id)
  const [days, setDays] = useState(7)
  const [data, setData] = useState(null)
  const [err, setErr] = useState(false)
  useEffect(() => {
    if (!id) return
    let live = true
    setErr(false)
    api.get(`/linkpage/${id}/stats/?days=${days}`).then((r) => live && setData(r.data)).catch(() => live && setErr(true))
    return () => { live = false }
  }, [id, days])
  const peak = Math.max(1, ...(data?.trend || []).map((d) => d.view + d.click + d.share))
  return (
    <Modal onClose={onClose} className="center">
      <div className="sheet linkstats" onClick={(e) => e.stopPropagation()} style={{ position: 'relative' }}>
        <button className="qrx" onClick={onClose} aria-label="Close"><X size={18} /></button>
        <h2>Card analytics</h2>
        {cards.length > 1
          ? <select className="cardpick" value={id} onChange={(e) => { setData(null); setId(Number(e.target.value)) }} aria-label="Which card">{cards.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          : <p className="lsname">{cards[0]?.name}</p>}
        <div className="arange" role="radiogroup" aria-label="Time period">
          {PERIODS.map(([d, label]) => <button key={d} type="button" role="radio" aria-checked={days === d} className={days === d ? 'on' : ''} onClick={() => setDays(d)}>{label}</button>)}
        </div>
        {err && <p>Could not load the numbers. Try again.</p>}
        {!data && !err && <p>Loading…</p>}
        {data && (
          <>
            <div className="atiles">
              {[['Views', data.view], ['Link clicks', data.click], ['Shares', data.share], ['Links', data.link_count]]
                .map(([label, n]) => <div className="atile" key={label}><b>{num(n)}</b><span>{label}</span></div>)}
            </div>
            <h3 className="lssub">Most clicked links</h3>
            {data.top.length
              ? data.top.map((t, k) => <p className="lsnone" key={k}><b>{t.name}</b> · {t.clicks} click{t.clicks === 1 ? '' : 's'}</p>)
              : <p className="lsnone">No clicks from others yet.</p>}
            <h3 className="lssub">Last 7 days</h3>
            <div className="lstrend">
              {data.trend.map((d) => {
                const t = d.view + d.click + d.share
                return (
                  <div key={d.date} title={`${d.view} views, ${d.click} clicks, ${d.share} shares`}>
                    <i style={{ height: `${Math.max(4, (t / peak) * 100)}%`, opacity: t ? 1 : 0.3 }} />
                    <small>{dayName(d.date)}</small>
                  </div>
                )
              })}
            </div>
            <p className="lsnone">Your own visits don’t count.</p>
          </>
        )}
      </div>
    </Modal>
  )
}
