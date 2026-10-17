import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useBack } from '../routing'
import { useFetch, useTopBar } from '../context'
import { Seg, Skel, usePopupMenu } from '../components/ui'
import { CountUp, Donut, RankBars, Spark, TrendChart } from '../components/Dash'

// the period shown: quick choices on the bar, the rest under "More"
const QUICK = [[1, '24 hours'], [7, '7 days'], [90, '3 months']]
const MORE = [[180, '6 months'], [365, '1 year'], [0, 'All time']]
const num = (n) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n))
const COLORS = { view: '#9d7dff', save: '#2dd4bf', share: '#f4b400', click: '#f0646e' }
const LINES = [{ key: 'view', name: 'Views', color: COLORS.view }, { key: 'save', name: 'Saves', color: COLORS.save }, { key: 'share', name: 'Shares', color: COLORS.share }, { key: 'click', name: 'Clicks', color: COLORS.click }]

/* Analytics: how your links and boards are doing. Views, saves and shares by other people; follows and followers. */
export default function Analytics() {
  const nav = useNavigate()
  const back = useBack()
  // opened from a link's analytics popup: ?tab=links&link=<id> goes straight to that link
  const [q, setQ] = useState('')
  const [params] = useSearchParams()
  const focusLink = params.get('link')
  const [tab, setTab] = useState(['overview', 'links', 'boards', 'cards', 'reactions'].includes(params.get('tab')) ? params.get('tab') : 'overview')
  const [days, setDays] = useState(7)
  const [openMenu, menuEl] = usePopupMenu()
  const { data, loading } = useFetch(`/analytics/?days=${days}`, [days], { poll: 15000 })
  useTopBar({ back, center: 'Analytics', hideTabs: true }, [])
  const loaded = !!data
  useEffect(() => { if (loaded && focusLink) document.querySelector('.arow.hl')?.scrollIntoView({ block: 'center' }) }, [loaded, focusLink, tab]) // eslint-disable-line
  if (loading && !data) return <Skel />
  // the search box filters whichever list is open
  const needle = q.trim().toLowerCase()
  const has = (...fields) => !needle || fields.join(' ').toLowerCase().includes(needle)
  const linkRows = (data?.links || []).filter((l) => has(l.title, l.host))
  const boardRows = (data?.boards || []).filter((b) => has(b.name))
  const cardRows = (data?.cards || []).filter((c) => has(c.name, c.handle))
  const rx = data?.reactions || { total: 0, by_emoji: [], items: [], recent: [] }
  const rxItems = rx.items.filter((i) => has(i.title, i.host))
  const o = data?.overview || {}
  const t = data?.totals || {}
  const moreOn = MORE.find(([d]) => d === days)
  // each tile: the number in the chosen period, and the all-time number under it
  const tr = data?.trend
  const saves = (o.save || 0) + (o.board_saves || 0)
  const tiles = [
    ['Views', o.view, t.view, COLORS.view, 'view'], ['Saves', saves, (t.save || 0) + (t.board_saves || 0), COLORS.save, 'save'],
    ['Shares', o.share, t.share, COLORS.share, 'share'], ['Reactions', o.reactions, t.reactions, '#e0559b'],
    ['New followers', o.followers, t.followers, '#1f6feb'], ['New following', o.following, t.following, '#0a9396'],
    ['OCARD views', o.card_view, t.card_view, '#9d7dff'], ['OCARD clicks', o.card_click, t.card_click, COLORS.click, 'click'],
  ]
  const mix = [{ name: 'Views', value: o.view || 0, color: COLORS.view }, { name: 'Saves', value: saves, color: COLORS.save }, { name: 'Shares', value: o.share || 0, color: COLORS.share }, { name: 'Reactions', value: o.reactions || 0, color: '#e0559b' }]
  const mixTotal = mix.reduce((s, p) => s + p.value, 0)
  const short = (t) => { const w = (t || '').trim().split(/\s+/).slice(0, 2).join(' '); return w.length > 12 ? w.slice(0, 12).trimEnd() + '…' : w }    // at most 2 words and 12 letters
  const topLinks = (data?.links || []).slice(0, 5).map((l) => ({ key: l.id, title: short(l.title), full: l.title, href: l.url, sub: l.host, value: l.view + l.save * 3 + l.share * 2 })).filter((r) => r.value > 0)
  const topBoards = (data?.boards || []).slice(0, 5).map((b) => ({ key: b.id, title: `${b.name} board`, sub: `${b.link_count} link${b.link_count === 1 ? '' : 's'}`, value: b.view + b.save * 3 + b.share * 2 })).filter((r) => r.value > 0)
  const topCards = (data?.cards || []).slice(0, 5).map((c) => ({ key: c.id, title: c.name || c.handle, sub: `${c.click} clicks`, value: c.view + c.click * 2 + c.share * 2 })).filter((r) => r.value > 0)
  return (
    <main className="anal">
      <input type="search" className="asearch" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search a link, board or card" aria-label="Search analytics" autoCapitalize="none" spellCheck={false} />
      <Seg value={tab} onChange={setTab} options={[['overview', 'Overview'], ['links', 'Links'], ['boards', 'Boards'], ['cards', 'OCARDs'], ['reactions', 'Reactions']]} />
      <div className="arange" role="radiogroup" aria-label="Time period">
        {QUICK.map(([d, label]) => <button key={d} type="button" role="radio" aria-checked={days === d} className={days === d ? 'on' : ''} onClick={() => setDays(d)}>{label}</button>)}
        <button type="button" className={moreOn ? 'on' : ''} aria-haspopup="menu" onClick={(e) => openMenu(e, MORE.map(([d, label]) => ({ label, fn: () => setDays(d) })))}>{moreOn ? moreOn[1] : 'More'} ▾</button>
      </div>
      {tab === 'overview' && (
        <div className="dash">
          <div className="dtiles">
            {tiles.map(([label, n, total, color, spark]) => (
              <div className="dtile" key={label} style={{ '--c': color }}>
                <span className="dlabel">{label}</span>
                <b className="dnum"><CountUp value={n || 0} /></b>
                {spark && <Spark data={tr?.series?.[spark] || []} color={color} />}
                <small>{num(total || 0)} all time</small>
              </div>
            ))}
          </div>
          <div className="dgrid2">
            <section className="dcard wide">
              <h3>Activity</h3>
              <TrendChart trend={tr} lines={LINES} />
            </section>
            <section className="dcard">
              <h3>Engagement mix</h3>
              <Donut caption="actions" total={mixTotal} parts={mix} />
            </section>
          </div>
          <div className="dgrid3">
            <section className="dcard"><h3>Top links</h3>
              <RankBars empty="Make a link public to see it here." rows={topLinks} /></section>
            <section className="dcard"><h3>Top boards</h3>
              <RankBars empty="No boards yet." rows={topBoards} onOpen={(r) => nav(`/boards/${r.key}`)} /></section>
            <section className="dcard"><h3>Top OCARDs</h3>
              <RankBars empty="No OCARDs yet." rows={topCards} onOpen={(r) => nav(`/ocard/${r.key}`)} /></section>
          </div>
        </div>
      )}
      {menuEl}
      {tab === 'links' && (
        (data?.links || []).length ? (!linkRows.length ? <div className="empty">No link matches “{q.trim()}”.</div> : (
          <div className="atable">
            <div className="arow ahead"><span>Public link</span><span>Views</span><span>Saves</span><span>Shares</span><span>React</span></div>
            {[...linkRows].sort((x, y) => (String(y.id) === focusLink) - (String(x.id) === focusLink)).map((l) => (
              <div className={`arow ${String(l.id) === focusLink ? 'hl' : ''}`} key={l.id}><span className="at" title={l.title}><b>{l.title}</b><small>{l.host}</small></span><span>{l.view}</span><span>{l.save}</span><span>{l.share}</span><span>{l.react}</span></div>
            ))}
          </div>
        )) : <div className="empty">No public links yet. Make a link public to see how it does.</div>
      )}
      {tab === 'boards' && (
        (data?.boards || []).length ? (!boardRows.length ? <div className="empty">No board matches “{q.trim()}”.</div> : (
          <div className="atable">
            <div className="arow b4 ahead"><span>Board</span><span>Views</span><span>Saves</span><span>Shares</span></div>
            {boardRows.map((b) => (
              <div className="arow b4" key={b.id} onClick={() => nav(`/boards/${b.id}`)} style={{ cursor: 'pointer' }}>
                <span className="at"><b>{b.name}</b><small>{b.is_public ? 'Public' : 'Private'} · {b.link_count} link{b.link_count === 1 ? '' : 's'}</small></span><span>{b.view}</span><span>{b.save}</span><span>{b.share}</span>
              </div>
            ))}
          </div>
        )) : <div className="empty">No boards yet.</div>
      )}
      {tab === 'cards' && (
        (data?.cards || []).length ? (!cardRows.length ? <div className="empty">No card matches “{q.trim()}”.</div> : (
          <div className="atable">
            <div className="arow b4 ahead"><span>OCARD</span><span>Views</span><span>Clicks</span><span>Shares</span></div>
            {cardRows.map((c) => (
              <div className="acard" key={c.id}>
                <div className="arow b4" onClick={() => nav(`/ocard/${c.id}`)} style={{ cursor: 'pointer' }}>
                  <span className="at"><b>{c.name || c.handle}</b><small>{c.link_count} link{c.link_count === 1 ? '' : 's'}</small></span><span>{c.view}</span><span>{c.click}</span><span>{c.share}</span>
                </div>
                {c.top.length > 0 && <small className="atop">Most clicked: {c.top.map((t) => `${t.name} (${t.clicks})`).join(' · ')}</small>}
              </div>
            ))}
          </div>
        )) : <div className="empty">No OCARDs yet. Create one from the sidebar to see how it does.</div>
      )}
      {tab === 'reactions' && (
        rx.total === 0 ? <div className="empty">No reactions from others in this period yet.</div> : (
          <>
            <div className="atiles">
              <div className="atile"><b>{num(rx.total)}</b><span>Reactions</span></div>
              <div className="atile"><b>{rx.by_emoji.length}</b><span>Different emojis</span></div>
              <div className="atile"><b>{rx.items.length}</b><span>Links reacted to</span></div>
            </div>
            <h3 className="asub">By emoji</h3>
            <div className="lsrx">{rx.by_emoji.map((e) => <span key={e.emoji} className="rx">{e.emoji} {e.n}</span>)}</div>
            <h3 className="asub">Most reacted links</h3>
            <div className="atable">
              {rxItems.length === 0 && <div className="empty">No link matches “{q.trim()}”.</div>}
              {rxItems.map((i) => (
                <div className="arow rxrow" key={`${i.kind}${i.id}`}>
                  <span className="at" title={i.title}><b>{i.title}</b><small>{i.host}</small></span>
                  <span className="rxemojis">{Object.entries(i.emojis).map(([e, n]) => <em key={e}>{e} {n}</em>)}</span>
                  <span>{i.n}</span>
                </div>
              ))}
            </div>
            <h3 className="asub">Latest reactions</h3>
            <div className="atable">
              {rx.recent.map((r, k) => (
                <div className="arow rxrow" key={k}>
                  <span className="at"><b>{r.who} {r.emoji}</b><small>{r.title}</small></span>
                  <span className="rxemojis" /><span>{new Date(r.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
                </div>
              ))}
            </div>
          </>
        )
      )}
    </main>
  )
}
