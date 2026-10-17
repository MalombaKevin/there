import { memo, useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { api, errMsg, unlockStore } from '../api'
import { useApp, useFetch, useTopBar } from '../context'
import { Avatar, Empty, Modal, Seg, Skel } from '../components/ui'
import { ChatI, Check, Lock, Mail, UserPlus, X } from '../icons'
import { unlockWithPin, when } from '../lib'

/* a chat's address shows the person's name (their number only if the name is all digits, which could be mistaken for a number) */
const chatId = (u) => (/^\d+$/.test(u.username) ? u.id : u.username)

export default function Inbox() {
  const [sp, setSp] = useSearchParams()
  const t = sp.get('tab')
  const tab = t === 'friends' || t === 'network' || t === 'followers' ? 'network' : 'messages'
  const { counts } = useApp()
  useTopBar({}, [])
  const withCount = (label, n) => (n > 0 ? <>{label} <span className="ubadge">{n > 99 ? '99+' : n}</span></> : label)
  return (
    <div className="fwrap">
      <Seg value={tab} onChange={(v) => setSp(v === 'messages' ? {} : { tab: v })}
        options={[['messages', withCount('Messages', counts.messages)], ['network', withCount('Network', (counts.requests || 0) + (counts.followers || 0))]]} />
      {tab === 'messages' ? <Messages /> : <Network />}
      {tab === 'messages' && <StartChat />}
    </div>
  )
}

/* Round button on the Messages tab: pick a friend to start a chat with */
function StartChat() {
  const nav = useNavigate()
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const { data } = useFetch(open ? '/friends/' : null, [open])        // only loaded when the picker opens
  const friends = (data || []).filter((r) => r.status === 'accepted').map((r) => r.user)
    .filter((u) => `${u.nickname || ''} ${u.name} ${u.username}`.toLowerCase().includes(q.trim().toLowerCase().replace('@', '')))
  const close = () => { setOpen(false); setQ('') }
  // portal: the inbox wrapper has a backdrop-filter, which would otherwise pin a fixed button inside it instead of the screen corner
  return createPortal(
    <>
      <button className="fab chatfab" aria-label="Start chat" title="Start chat" onClick={() => setOpen(true)}><ChatI size={24} /></button>
      <Modal open={open} onClose={close} className="center">
        <div className="sheet">
          <h2>Start chat</h2>
          <input type="search" placeholder="Search your OPALS" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
          {friends.length ? friends.map((u) => (
            <div className="frow fr" key={u.id}>
              <button className="fuser" onClick={() => { close(); nav(`/inbox/${chatId(u)}`) }}>
                <Avatar u={u} /><span className="fn"><b>{u.nickname || u.name}</b><small>@{u.username}</small></span>
              </button>
            </div>
          )) : <p className="hint">{data && !(data || []).some((r) => r.status === 'accepted') ? 'You have no OPALS yet. Follow people to make some.' : 'No OPALS match.'}</p>}
          <div className="btns"><button onClick={close}>Cancel</button></div>
        </div>
      </Modal>
    </>,
    document.body
  )
}

/* Network: people search on top, then Followers / Following / Updates. Updates has its own Updates / Suggestions toggle. */
function Network() {
  const [sub, setSub] = useState('updates')
  const [upTab, setUpTab] = useState('updates') // inside Updates: updates | suggestions
  const [q, setQ] = useState('')
  const { counts } = useApp()
  const searching = q.trim().replace('@', '').length >= 2
  const badge = (label, n) => (n > 0 ? <>{label} <span className="ubadge">{n > 99 ? '99+' : n}</span></> : label)
  return (
    <>
      <Search q={q} setQ={setQ} />
      <div className="subtoggle">
        <Seg value={sub} onChange={setSub}
          options={[['followers', 'Followers'], ['following', 'Following'], ['updates', badge('Updates', (counts.requests || 0) + (counts.followers || 0))]]} />
      </div>
      <SearchResults q={q} />
      {sub === 'followers' ? <PeopleTab kind="followers" /> : sub === 'following' ? <PeopleTab kind="following" />
        : searching ? null : (
          <>
            <div className="subtoggle">
              <Seg value={upTab} onChange={setUpTab} options={[['updates', 'Updates'], ['suggestions', 'Suggestions']]} />
            </div>
            {upTab === 'updates' ? <Updates /> : <Suggestions />}
          </>
        )}
    </>
  )
}

/* Your followers / the people you follow, with Follow back / Following buttons */
function PeopleTab({ kind }) {
  const nav = useNavigate()
  const { user, toast, confirm, refresh, tick } = useApp()
  const { data, loading, reload } = useFetch(`/users/${user.username}/${kind}/`, [tick, kind])
  const run = async (fn, ok) => { try { await fn(); ok && toast(ok); reload(); refresh() } catch (e) { toast(errMsg(e)) } }
  if (loading) return <Skel rows={4} />
  if (!data?.length) return <Empty>{kind === 'followers' ? 'No followers yet.' : 'You are not following anyone yet. Find people above or in Suggestions.'}</Empty>
  return data.map((u) => (
    <div className="frow fr" key={u.id}>
      <button className="fuser" onClick={() => nav(`/u/${u.username}`)}>
        <Avatar u={u} /><span className="fn"><b>{u.id === user.id ? 'Me' : u.nickname || u.name}</b><small>@{u.username}</small></span>
      </button>
      <div className="b">
        {u.i_follow && u.follows_me && <button className="ghost msgico" aria-label="Message" title="Message" onClick={() => nav(`/inbox/${chatId(u)}`)}><span className="m-only"><Mail size={24} /></span><span className="pc-only">Message</span></button>}
        {u.i_follow ? (kind === 'following' ? null : (    // in the Following list everyone is already followed: no Following button there
          <button className={`ghost ${u.follows_me ? 'mutual' : ''}`} aria-label={u.follows_me ? 'Following each other' : 'Following'} title={u.follows_me ? 'Following each other' : 'Following'} onClick={async () => {
            if (await confirm({ title: 'Unfollow?', message: `Stop following ${u.nickname || u.name}?`, label: 'Unfollow' })) run(() => api.delete(`/users/${u.username}/follow/`), 'Unfollowed')
          }}><span className="m-only"><Check size={18} /></span><span className="pc-only">Following</span></button>
        )) : <button className="ghost bluebtn" aria-label="Follow back" title="Follow back" onClick={() => run(async () => { const { data: f } = await api.post(`/users/${u.username}/follow/`); toast(f.friends ? 'You are now friends' : 'Following') })}><span className="m-only"><UserPlus size={18} /></span><span className="pc-only">Follow back</span></button>}
      </div>
    </div>
  ))
}

/* People search results, shown above whichever Network tab is open */
function SearchResults({ q }) {
  const nav = useNavigate()
  const { user, toast, refresh, tick } = useApp()
  const searching = q.trim().replace('@', '').length >= 2
  const { data, reload } = useFetch(searching ? '/friends/' : null, [tick, searching])          // only needed while people are being searched
  const { data: following, reload: reloadFollowing } = useFetch(searching ? `/users/${user.username}/following/` : null, [tick, searching])
  const [found, setFound] = useState([])
  useEffect(() => {
    if (q.trim().replace('@', '').length < 2) return setFound([])
    const t = setTimeout(async () => { try { const { data: d } = await api.get('/users/search/', { params: { q } }); setFound(d) } catch { setFound([]) } }, 250)
    return () => clearTimeout(t)
  }, [q])
  const run = async (fn, ok) => { try { await fn(); ok && toast(ok); reload(); reloadFollowing(); refresh() } catch (e) { toast(errMsg(e)) } }
  const rel = (u) => (data || []).find((r) => r.user.id === u.id)?.status
  const followed = (u) => (following || []).some((f) => f.id === u.id)
  return found.map((u) => {
    const r = rel(u)
    return (
      <div className="frow fr" key={u.id}>
        <button className="fuser" onClick={() => nav(`/u/${u.username}`)}>
          <Avatar u={u} /><span className="fn"><b>{u.id === user.id ? 'Me' : u.nickname || u.name}</b><small>@{u.username}</small></span>
        </button>
        <div className="b">
          {r === 'accepted' ? <button className="ghost" aria-label="Message" title="Message" onClick={() => nav(`/inbox/${chatId(u)}`)}><span className="m-only"><Mail size={18} /></span><span className="pc-only">Message</span></button>
            : followed(u) ? <button className="ghost" disabled>Following</button>
            : <button className="ghost primary" onClick={() => run(async () => { const { data: f } = await api.post(`/users/${u.username}/follow/`); toast(f.status === 'pending' ? 'Follow request sent' : f.friends ? 'You are now friends' : 'Following') })}>Follow</button>}
        </div>
      </div>
    )
  })
}

function Search({ q, setQ }) {
  return (
    <div className="finder" style={{ marginTop: 14 }}>
      <input type="search" placeholder="Find people by name or @username" value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: 1 }} />
    </div>
  )
}

/* New followers and follow requests. Opening this list marks the new ones as seen. */
function Updates() {
  const nav = useNavigate()
  const { toast, refresh, tick, loadCounts } = useApp()
  const { data, loading, reload } = useFetch('/followers/alerts/', [tick])
  // once the list is on screen, mark the new ones as seen (the 'New' tags stay until you leave)
  useEffect(() => { if (data?.some((r) => r.new)) api.post('/followers/alerts/').then(loadCounts).catch(() => {}) }, [data]) // eslint-disable-line
  const respond = async (r, action) => {
    try { await api.post(`/follow-requests/${r.id}/${action}/`); toast(action === 'accept' ? 'Accepted' : 'Declined'); reload(); refresh() }
    catch (e) { toast(errMsg(e)) }
  }
  // "Follow back" can be dismissed: they keep following you and you just don't follow them. Remembered on this device.
  const [skipped, setSkipped] = useState(() => { try { return new Set(JSON.parse(localStorage.getItem('opio_fb_skip') || '[]')) } catch { return new Set() } })
  const skip = (id) => { const n = new Set(skipped).add(id); setSkipped(n); try { localStorage.setItem('opio_fb_skip', JSON.stringify([...n])) } catch { /* ignore */ } }
  const followBack = async (r) => {
    try { const { data: f } = await api.post(`/users/${r.user.username}/follow/`); toast(f.friends ? `You and ${r.user.nickname || r.user.name} are now friends` : 'Following'); reload(); refresh() }
    catch (e) { toast(errMsg(e)) }
  }
  if (loading) return <Skel rows={4} />
  if (!data?.length) return <Empty>No updates yet. When someone follows you, you'll see it here.</Empty>
  return <>{data.map((r) => (
    <div className={`frow fr ${r.new ? 'newrow' : ''}`} key={r.id}>
      <button className="fuser" onClick={() => nav(`/u/${r.user.username}`)}>
        <Avatar u={r.user} />
        <span className="fn"><b>{r.user.nickname || r.user.name}</b><small>{r.status === 'pending' ? 'wants to follow you' : 'started following you'} · {when(r.created)}</small></span>
      </button>
      <div className="b">
        {r.status === 'pending' ? (
          <>
            <button className="ghost primary" onClick={() => respond(r, 'accept')}>Accept</button>
            <button className="ghost" aria-label="Decline" onClick={() => respond(r, 'decline')}><X size={14} /></button>
          </>
        ) : !r.i_follow && !skipped.has(r.id) ? (
          <>
            <button className="ghost bluebtn" onClick={() => followBack(r)}>Follow back</button>
            <button className="ghost" aria-label="Not now" title="Not now. They keep following you" onClick={() => skip(r.id)}><X size={14} /></button>
          </>
        ) : r.i_follow ? <small className="muted">OPALS</small> : r.new && <span className="ubadge">New</span>}
      </div>
    </div>
  ))}</>
}

/* People you may know: mutual friends first, then shared interests. Each shows their interests. */
function Suggestions() {
  const nav = useNavigate()
  const { toast, refresh } = useApp()
  const { data, loading, reload } = useFetch('/friends/suggestions/', [])
  if (loading) return <Skel rows={4} />
  if (!data?.length) return <Empty>No suggestions right now. Check back as more people join.</Empty>
  const add = async (u) => {
    try { const { data: f } = await api.post(`/users/${u.username}/follow/`); toast(f.status === 'pending' ? 'Follow request sent' : 'Following'); reload(); refresh() }
    catch (e) { toast(errMsg(e)) }
  }
  return <>{data.map((r) => (
    <div className="frow fr sugg" key={r.user.id}>
      <button className="fuser" onClick={() => nav(`/u/${r.user.username}`)}>
        <Avatar u={r.user} />
        <span className="fn">
          <b>{r.user.nickname || r.user.name}</b>
          <small>{r.reason}</small>
          {r.interests?.length > 0 && (
            <span className="pbio sbio">{r.interests.map((i) => <span key={i.id} className={`pchip ${i.shared ? 'shared' : ''}`}>{i.name}</span>)}</span>
          )}
        </span>
      </button>
      <div className="b"><button className="ghost bluebtn" onClick={() => add(r.user)}>Follow</button></div>
    </div>
  ))}</>
}

function Messages() {
  const nav = useNavigate()
  const { ask, toast, tick, counts } = useApp()
  const { data, loading } = useFetch('/conversations/', [tick, counts.messages], { poll: 4000 }) // new messages appear live
  const open = useCallback(async (c) => {
    if (c.locked && !unlockStore.has('chat', c.user.id) && !(await unlockWithPin({ kind: 'chat', target: c.user.id, ask, toast, title: `Unlock chat with ${c.user.nickname || c.user.name}` }))) return
    nav(`/inbox/${chatId(c.user)}`)
  }, [nav, ask, toast])
  if (loading) return <Skel rows={4} />
  if (!data?.length) return <Empty>No conversations yet. Follow people to become OPALS, then send them links.</Empty>
  return data.map((c) => <ConversationRow key={c.user.id} c={c} onOpen={open} />)
}

/* one row of the Messages list; memoised so the 4-second refresh only redraws the rows that changed */
const ConversationRow = memo(function ConversationRow({ c, onOpen }) {
  const last = c.last
  const preview = c.locked ? 'Locked chat' : !last ? 'Say hi with a link' : last.kind === 'board_invite' ? `Board Collab Invite: ${last.title}` : last.kind === 'qr' ? 'QR message' : last.title || last.url
  return (
    <div className="frow" style={{ cursor: 'pointer' }} onClick={() => onOpen(c)}>
      <Avatar u={c.user} />
      <div className="n"><b>{c.user.nickname || c.user.name}</b><small>{preview}</small></div>
      <small style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        {c.locked && <Lock size={14} />}{when(c.last_at)}
        {c.unread > 0 && <span className="ubadge" aria-label={`${c.unread} new`}>{c.unread > 99 ? '99+' : c.unread}</span>}
      </small>
    </div>
  )
})