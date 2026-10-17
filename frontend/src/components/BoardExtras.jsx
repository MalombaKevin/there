import { useEffect, useRef, useState } from 'react'
import { api, errMsg, readImage } from '../api'
import { useApp, useFetch } from '../context'
import { Avatar, Modal, Seg } from './ui'
import { when } from '../lib'
import { DownloadI, SendI, ShareI, X } from '../icons'
import { CategorySelect, PickFriendModal } from './Modals'

const COLORS = ['#e2542b', '#f4b400', '#0a9396', '#1f6feb', '#9d7dff', '#e0559b', '#3b3b3b']

/* Owner picks a colour and can attach a picture, which is used as the board's preview image */
export function BoardStyleModal({ open, board, onClose, onSaved }) {
  const { toast } = useApp()
  const [color, setColor] = useState('')
  const [image, setImage] = useState('')
  const file = useRef()
  const [category, setCategory] = useState('')
  const { data: cats } = useFetch(open ? '/categories/?options=1' : null, [open])
  useEffect(() => { if (open) { setColor(board.color || ''); setImage(board.image || ''); setCategory(board.category || '') } }, [open]) // eslint-disable-line
  if (!open) return null
  const save = async () => {
    try { await api.patch(`/boards/${board.id}/`, { color, image, category }); toast('Board style saved'); onSaved?.(); onClose() } catch (e) { toast(errMsg(e)) }
  }
  const pick = async (e) => {
    const f = e.target.files?.[0]; e.target.value = ''
    if (f) try { setImage(await readImage(f)) } catch (x) { toast(x.message || 'Could not use that image') }
  }
  return (
    <Modal onClose={onClose}>
      <div className="sheet">
        <h2>Board style</h2>
        <p>Give “{board.name}” a colour and a preview picture.</p>
        <label>Colour</label>
        <div className="swatches">
          {COLORS.map((c) => <button key={c} type="button" aria-label={c} className={`dot ${color === c ? 'on' : ''}`} style={{ background: c }} onClick={() => setColor(color === c ? '' : c)} />)}
          <button type="button" className={`dot none ${!color ? 'on' : ''}`} aria-label="No colour" onClick={() => setColor('')}>∅</button>
          {/* a + circle opens the device colour picker; a custom colour shows in the circle once chosen */}
          <label className={`dot custom ${color && !COLORS.includes(color) ? 'on' : ''}`} title="Choose your own colour" style={color && !COLORS.includes(color) ? { background: color, color: '#fff' } : undefined}>
            +<input type="color" aria-label="Choose your own colour" value={color || '#1f6feb'} onChange={(e) => setColor(e.target.value)} />
          </label>
        </div>
        <CategorySelect value={category} onChange={setCategory} cats={cats} placeholder="Pick or type a category (optional)" />
        <label>Preview picture</label>
        <input ref={file} type="file" accept="image/*" hidden onChange={pick} />
        <div className="photorow">
          {image && <img alt="Board preview" src={image} />}
          <button type="button" onClick={() => file.current.click()}>{image ? 'Change image' : 'Attach image'}</button>
          {image && <button type="button" onClick={() => setImage('')}>Remove</button>}
        </div>
        <div className="btns"><button onClick={onClose}>Cancel</button><button className="go" onClick={save}>Save</button></div>
      </div>
    </Modal>
  )
}

const PERIODS = [[1, '1 day'], [7, '7 days'], [30, '30 days'], [90, '3 months'], [365, '1 year'], [0, 'All time']]
const num = (n) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n || 0))
const dayName = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short' })

/* The owner's summary of a board: views, saves, shares and reactions over a chosen period, the last 7 days and the most reacted links */
function BoardStats({ board }) {
  const [days, setDays] = useState(7)
  const [data, setData] = useState(null)
  const [err, setErr] = useState(false)
  useEffect(() => {
    let live = true
    setErr(false)
    api.get(`/boards/${board.id}/stats/?days=${days}`).then((r) => live && setData(r.data)).catch(() => live && setErr(true))
    return () => { live = false }
  }, [board.id, days])
  const peak = Math.max(1, ...(data?.trend || []).map((d) => d.view + d.save + d.share))
  return (
    <div className="linkstats">
      <div className="arange" role="radiogroup" aria-label="Time period">
        {PERIODS.map(([d, label]) => <button key={d} type="button" role="radio" aria-checked={days === d} className={days === d ? 'on' : ''} onClick={() => setDays(d)}>{label}</button>)}
      </div>
      {err && <p>Could not load the numbers. Try again.</p>}
      {!data && !err && <p>Loading…</p>}
      {data && (
        <>
          <div className="atiles">
            {[['Views', data.view], ['Saves', data.save], ['Shares', data.share], ['Reactions', data.react], ['Links', data.link_count], ['People', data.member_count]]
              .map(([label, n]) => <div className="atile" key={label}><b>{num(n)}</b><span>{label}</span></div>)}
          </div>
          <h3 className="lssub">Reactions on its links</h3>
          {Object.keys(data.reactions).length
            ? <div className="lsrx">{Object.entries(data.reactions).map(([e, n]) => <span key={e} className="rx">{e} {n}</span>)}</div>
            : <p className="lsnone">No reactions from others yet.</p>}
          {data.top.length > 0 && (
            <>
              <h3 className="lssub">Most reacted links</h3>
              {data.top.map((t, i) => <p className="lsnone" key={i}><b>{t.title}</b> · {t.n}</p>)}
            </>
          )}
          <h3 className="lssub">Last 7 days</h3>
          <div className="lstrend">
            {data.trend.map((d) => {
              const t = d.view + d.save + d.share
              return (
                <div key={d.date} title={`${d.view} views, ${d.save} saves, ${d.share} shares`}>
                  <i style={{ height: `${Math.max(4, (t / peak) * 100)}%`, opacity: t ? 1 : 0.3 }} />
                  <small>{dayName(d.date)}</small>
                </div>
              )
            })}
          </div>
          {!data.public && <p className="lsnone">This board is private, so only its members see it.</p>}
        </>
      )}
    </div>
  )
}

/* The board's activity icon: two toggles, what has happened on the board lately, and (for the owner and the collaborators allowed) its analytics */
export function BoardActivityModal({ open, board, onClose, tab: start = 'activity' }) {
  const [tab, setTab] = useState(start)
  useEffect(() => { if (open) setTab(start) }, [open, start])
  const { data, loading } = useFetch(open ? `/boards/${board.id}/activity/` : null, [open])
  if (!open) return null
  const owner = !!board.can_analytics        // the owner, and collaborators the owner allowed to see the analytics
  return (
    <Modal onClose={onClose}>
      <div className="sheet boardact">
        <h2>{board.name} board</h2>
        {owner && <Seg value={tab} onChange={setTab} options={[['activity', 'Activity'], ['analytics', 'Analytics']]} />}
        <div className="boardbody">{tab === 'analytics' && owner ? <BoardStats board={board} /> : (
          <div className="actlist">
            {loading ? null : !(data || []).length ? <p>Nothing yet.</p> : data.map((a, i) => (
              <div className="actrow" key={i}>
                <Avatar u={a.who} />
                <span><b>{a.who.nickname || a.who.name}</b> {a.kind === 'join' ? 'joined the board' : <>added <a href={a.url} target="_blank" rel="noopener noreferrer">{a.title}</a></>}<small>{when(a.at)}</small></span>
              </div>
            ))}
          </div>
        )}</div>
        <div className="btns"><button onClick={onClose}>Close</button></div>
      </div>
    </Modal>
  )
}

/* Scan to open it. Download the code, share the link, or send it to an OPAL. */
export function QrModal({ open, url, title, onClose, hint = 'Scan this code to open it on OPIOW.' }) {
  const { toast } = useApp()
  const [img, setImg] = useState('')
  const [toFriend, setToFriend] = useState(null)
  useEffect(() => { if (open) import('qrcode').then((m) => m.default.toDataURL(url, { margin: 1, width: 420 })).then(setImg).catch(() => setImg('')) }, [open, url])
  if (!open) return null
  const download = () => {
    const a = document.createElement('a')
    a.href = img; a.download = `${(title || 'opio').replace(/[^\w-]+/g, '-')}-qr.png`
    document.body.appendChild(a); a.click(); a.remove()
  }
  const share = async () => {
    if (navigator.share) { try { await navigator.share({ title: `${title} on OPIOW`, url }) } catch { /* cancelled */ } return }
    try { await navigator.clipboard.writeText(url); toast('Link copied') } catch { toast(url) }
  }
  return (
    <Modal onClose={onClose} className="center">
      <div className="sheet" style={{ textAlign: 'center', position: 'relative' }}>
        <button className="qrx" onClick={onClose} aria-label="Close"><X size={18} /></button>
        <h2>{title}</h2>
        <p>{hint}</p>
        {img ? <img alt="QR code" src={img} style={{ width: '100%', maxWidth: 280, borderRadius: 12, background: '#fff', padding: 8 }} /> : <p>Making the code…</p>}
        <div className="qracts">
          <button className="ghost ibtn" onClick={download} disabled={!img} aria-label="Download" title="Download"><DownloadI /></button>
          <button className="ghost ibtn" onClick={share} aria-label="Share" title="Share"><ShareI /></button>
          <button className="ghost ibtn" onClick={() => setToFriend({ title, url })} aria-label="Send to an OPAL" title="Send to an OPAL"><SendI /></button>
        </div>
      </div>
      <PickFriendModal link={toFriend} onClose={() => setToFriend(null)} />
    </Modal>
  )
}
