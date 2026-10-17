import { useEffect, useState } from 'react'
import { api, errMsg } from '../api'
import { useBack } from '../routing'
import { useApp, useFetch, useTopBar } from '../context'
import { Avatar, Seg, Skel } from '../components/ui'

const num = (n) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n ?? 0))

/* Admin (staff only): site totals, people (disable / enable) and public links (remove). */
export default function Admin() {
  const { confirm, toast } = useApp()
  const back = useBack()
  const [tab, setTab] = useState('overview')
  const [q, setQ] = useState('')
  const [dq, setDq] = useState('')
  useTopBar({ back, center: 'Admin', hideTabs: true }, [])
  useEffect(() => { const t = setTimeout(() => setDq(q.trim()), 250); return () => clearTimeout(t) }, [q])
  useEffect(() => setQ(''), [tab])
  const search = encodeURIComponent(dq)
  const { data: o, loading } = useFetch(tab === 'overview' ? '/admin/overview/' : null, [tab], { poll: 15000 })
  const { data: users, reload: reloadUsers } = useFetch(tab === 'users' ? `/admin/users/?q=${search}` : null, [tab])
  const { data: links, reload: reloadLinks } = useFetch(tab === 'links' ? `/admin/links/?q=${search}` : null, [tab])

  const toggle = async (u) => {
    const to = !u.is_active
    if (!to && !(await confirm({ title: 'Disable account?', message: `${u.name} (@${u.username}) will not be able to log in.`, label: 'Disable' }))) return
    try { await api.patch(`/admin/users/${u.id}/`, { is_active: to }); toast(to ? 'Account enabled' : 'Account disabled'); reloadUsers() }
    catch (e) { toast(errMsg(e)) }
  }
  const remove = async (l) => {
    if (!(await confirm({ title: 'Remove link?', message: `“${l.title}” will be deleted for good.`, label: 'Remove' }))) return
    try { await api.delete(`/admin/links/${l.id}/`); toast('Link removed'); reloadLinks() }
    catch (e) { toast(errMsg(e)) }
  }

  const tiles = o && [
    ['People', o.users, `+${o.users_7d} this week`], ['Active this week', o.active_7d, `${o.disabled} disabled`],
    ['Links', o.links, `+${o.links_7d} this week`], ['Public links', o.public_links, `${o.advertised} on Discover`],
    ['Boards', o.boards, `${o.public_boards} public`], ['Messages', o.messages, `+${o.messages_7d} this week`],
  ]
  return (
    <main className="anal">
      <Seg value={tab} onChange={setTab} options={[['overview', 'Overview'], ['users', 'People'], ['links', 'Links']]} />
      {tab !== 'overview' && <input className="adminq" type="search" placeholder={tab === 'users' ? 'Search name, username or email' : 'Search title, site or owner'} value={q} onChange={(e) => setQ(e.target.value)} />}
      {tab === 'overview' && (loading && !o ? <Skel /> : (
        <div className="atiles">
          {(tiles || []).map(([label, n, sub]) => <div className="atile" key={label}><b>{num(n)}</b><span>{label}</span><small>{sub}</small></div>)}
        </div>
      ))}
      {tab === 'users' && (!users ? <Skel /> : !users.length ? <div className="empty">Nobody found.</div> : users.map((u) => (
        <div className="frow fr" key={u.id}>
          <span className="fuser"><Avatar u={u} /><span className="fn"><b>{u.name}{u.is_staff ? ' · staff' : ''}</b><small>@{u.username} · {u.email || 'no email'} · {u.links} links, {u.boards} boards</small></span></span>
          <div className="b">
            {!u.is_staff && <button className={u.is_active ? 'ghost' : 'ghost primary'} onClick={() => toggle(u)}>{u.is_active ? 'Disable' : 'Enable'}</button>}
          </div>
        </div>
      )))}
      {tab === 'links' && (!links ? <Skel /> : !links.length ? <div className="empty">No public links found.</div> : links.map((l) => (
        <div className="frow fr" key={l.id}>
          <a className="fuser" href={l.url} target="_blank" rel="noreferrer"><span className="fn"><b>{l.title}</b><small>{l.host} · by @{l.owner}{l.adult ? ' · 18+' : ''}</small></span></a>
          <div className="b"><button className="ghost" onClick={() => remove(l)}>Remove</button></div>
        </div>
      )))}
    </main>
  )
}
