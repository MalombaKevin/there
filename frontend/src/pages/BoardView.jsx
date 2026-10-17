import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { api, errMsg, isLocked, isVideoUrl } from '../api'
import { useApp, useFetch, useTopBar } from '../context'
import LinkGrid from '../components/LinkGrid'
import { Avatar, Modal, Seg, Skel, usePopupMenu } from '../components/ui'
import { InviteModal, PeopleModal } from '../components/BoardCollab'
import { AddLinkModal, BoardActivityModal, BoardStyleModal, EditLinkModal, PickBoardModal, PickFriendModal, QrModal } from '../components/LazyModals'
import { Palette, Pulse, Eye, EyeOff, Globe, Grid4, LinkI, ListI, Bookmark, Lock, People, ShareI, Trash, UserPlus, Exit } from '../icons'
import { defaultView, toggleLock, unlockWithPin } from '../lib'
import { useLinkActions } from './Home'
import { RequireLogin, useBack } from '../routing'

/* A board opens at /boards/<owner>/<board name>. The older /boards/<number> still works and moves to the readable address. */
export default function BoardView() {
  const { id, owner, slug } = useParams()
  const nav = useNavigate()
  const { toast } = useApp()
  const [resolved, setResolved] = useState(null)
  useEffect(() => {
    if (!owner) return
    setResolved(null)
    api.get(`/boards/by/${encodeURIComponent(owner)}/${encodeURIComponent(slug)}/`)
      .then((r) => setResolved(String(r.data.id)))
      .catch(() => { toast('That board does not exist'); nav('/discover', { replace: true }) })
  }, [owner, slug]) // eslint-disable-line
  if (id === 'all') return <RequireLogin what="your links"><AllView /></RequireLogin>
  if (owner) return resolved ? <RealBoard id={resolved} /> : <Skel />
  return <RealBoard id={id} readable />
}

/* The virtual "All" folder: everything in Mine + Saved */
function AllView() {
  const nav = useNavigate()
  const { data, loading, reload } = useFetch('/links/')
  const { menu, modals } = useLinkActions(reload)
  const [view, setView] = useState(defaultView)
  useTopBar({ back: () => nav('/boards'), center: 'All', hideTabs: true, right: <span className="bstat"><LinkI size={16} />{(data || []).length}</span> }, [data?.length])
  const m = (l) => menu(l.source === 'saved' ? 'saved' : 'mine', [])(l)
  return (
    <>
      <div className="bar"><div className="views" style={{ marginLeft: 'auto' }}>
        <button className={view === 'list' ? 'on' : ''} onClick={() => setView('list')}><ListI /></button>
        <button className={view === 'square' ? 'on' : ''} onClick={() => setView('square')}><Grid4 /></button>
      </div></div>
      {loading ? <Skel /> : <LinkGrid links={data || []} view={view} getMenu={m} empty="Links you add or save appear here automatically." />}
      {modals}
    </>
  )
}

const boardCache = new Map()   // boards opened before show instantly while they refresh

function RealBoard({ id, readable }) {
  const nav = useNavigate()
  const { user, ask, confirm, toast, refresh, setViewer } = useApp()
  const back = useBack(user ? '/boards' : '/discover')
  const [board, setBoard] = useState(() => boardCache.get(id) || null)
  const [loading, setLoading] = useState(() => !boardCache.has(id))
  const [view, setView] = useState(defaultView)
  const [adding, setAdding] = useState(false)
  const [people, setPeople] = useState(false)
  const [invite, setInvite] = useState(false)
  const [edit, setEdit] = useState(null)
  const [toBoard, setToBoard] = useState(null)
  const [toFriend, setToFriend] = useState(null)
  const [styleOpen, setStyleOpen] = useState(false)
  const [actOpen, setActOpen] = useState(false)
  const [actTab, setActTab] = useState('activity')
  const openAct = (t) => { setActTab(t); setActOpen(true) }
  const [qrOpen, setQrOpen] = useState(false)
  const [openMenu, menuEl] = usePopupMenu()

  const load = async () => {
    try { const { data } = await api.get(`/boards/${id}/`); boardCache.set(id, data); setBoard(data) }
    catch (e) {
      if (isLocked(e)) {
        const ok = await unlockWithPin({ kind: 'board', target: id, ask, toast })
        return ok ? load() : nav(user ? '/boards' : '/discover')
      }
      toast(errMsg(e)); nav(user ? '/boards' : '/discover', { replace: true })
    } finally { setLoading(false) }
  }
  useEffect(() => { const hit = boardCache.get(id); setBoard(hit || null); setLoading(!hit); load() }, [id]) // eslint-disable-line

  const b = board
  // opened by number: swap the address for the board's name once we know it
  useEffect(() => { if (readable && b?.slug && b.owner?.username) nav(`/boards/${b.owner.username}/${b.slug}`, { replace: true }) }, [readable, b?.slug]) // eslint-disable-line
  const icon = b ? (b.locked ? <Lock size={18} /> : b.is_public ? <Globe size={18} /> : <EyeOff size={18} />) : null
  useTopBar({
    back, hideTabs: true,
    center: b ? `${b.emoji ? b.emoji + ' ' : ''}${b.name}` : '',
    // phones: public / private icon, collaborators and link count sit together at the far right; PC shows status + count
    right: b && <>
      <span className="bstat m-only" title={b.locked ? 'Locked' : b.is_public ? 'Public' : 'Private'} aria-label={b.locked ? 'Locked' : b.is_public ? 'Public' : 'Private'}>{icon}</span>
      {b.is_member && <button className="bstat bsbtn m-only" onClick={() => setPeople(true)} aria-label="Collaborators"><People size={16} />{b.member_count}</button>}
      <span className="bstat m-only" title="Links"><LinkI size={16} />{b.link_count}</span>
      <span className="bstat pc-only" title={b.locked ? 'Locked' : b.is_public ? 'Public' : 'Private'} aria-label={b.locked ? 'Locked' : b.is_public ? 'Public' : 'Private'}>{icon}{b.link_count}</span>
    </>,
  }, [b?.name, b?.emoji, b?.link_count, b?.is_public, b?.locked, b?.is_member, b?.member_count])

  const manage = !!b && (b.is_owner || b.is_coowner)                      // the owner and co-owners: everything but deleting the board
  const addedByMe = (l) => !!user && l.added_by?.id === user.id
  const mine = (l) => addedByMe(l) || manage                              // may edit it
  const canRemove = (l) => addedByMe(l) || manage || !!b?.perms?.delete    // may take it off the board
  const act = async (fn, ok) => { try { await fn(); ok && toast(ok); await load(); refresh() } catch (e) { toast(errMsg(e)) } }

  const menu = (l) => {
    if (!user) return [{ label: 'Log in to save', fn: () => nav('/login', { state: { from: `/boards/${id}` } }) }]
    const poster = l.owner || l.added_by
    const items = [
      { label: 'Save', fn: () => act(() => api.post('/links/save/', { url: l.url, title: l.title, image: l.image, adult: l.adult, from_user_id: poster?.id }), 'Saved') },
      { label: 'Save to another board', fn: () => setToBoard({ title: l.title, body: { url: l.url, title: l.title, adult: l.adult, from_user_id: poster?.id } }) },
      { label: 'Send to an OPAL', fn: () => setToFriend(l) },
    ]
    if (mine(l) && b.can_edit) items.push({ label: 'Edit', fn: () => setEdit(l) })
    if (canRemove(l) && b.can_edit) {
      items.push({ label: 'Remove from board', danger: true, fn: async () => {
        if (await confirm({ title: 'Remove link?', message: 'It will be removed from this board only.', label: 'Remove' })) act(() => api.delete(`/boards/${id}/links/${l.id}/`), 'Removed')
      } })
    }
    return items
  }

  const del = async () => {
    if (!(await confirm({ title: 'Delete board?', message: `“${b.name}” and its links will be deleted for everyone.` }))) return
    try { await api.delete(`/boards/${id}/`); toast('Board deleted'); refresh(); nav('/boards') } catch (e) { toast(errMsg(e)) }
  }
  const leave = async () => {
    if (!(await confirm({ title: 'Leave board?', message: 'You will no longer be able to add links.', label: 'Leave' }))) return
    try { await api.delete(`/boards/${id}/members/${user.id}/`); nav('/boards') } catch (e) { toast(errMsg(e)) }
  }
  const boardUrl = b?.slug && b.owner?.username ? `${location.origin}/boards/${b.owner.username}/${b.slug}` : `${location.origin}/boards/${id}`
  const shareOut = async () => {
    api.post('/events/', { kind: 'share', board_id: b.id }).catch(() => {})
    if (navigator.share) { try { await navigator.share({ title: `${b.name} on OPIOW`, url: boardUrl }) } catch { /* cancelled */ } return }
    try { await navigator.clipboard.writeText(boardUrl); toast('Board link copied') } catch { toast(boardUrl) }
  }
  // Public boards: Share (outside the app) or Send to an OPAL. Private boards can only go to a friend inside OPIOW, as an invite.
  const shareMenu = (e) => {
    const stats = b.can_analytics ? [{ label: 'Analytics', fn: () => openAct('analytics') }] : []     // the owner, and collaborators the owner allowed
    if (b.is_public) return openMenu(e, [{ label: 'Share', fn: shareOut }, { label: 'QR code', fn: () => setQrOpen(true) }, { label: 'Send to an OPAL', fn: () => setToFriend({ title: b.name, url: boardUrl, board_id: b.id }) }, ...stats])
    if (!b.is_owner) return toast('Only the owner can share a private board.')
    openMenu(e, [{ label: 'Send to an OPAL', fn: () => setInvite(true) }, ...stats])
  }
  const toggleSave = async () => {
    if (!user) return nav('/login', { state: { from: `/boards/${id}` } })
    try {
      if (b.is_saved) { await api.delete(`/boards/${id}/save/`); toast('Removed from your boards'); if (!b.is_public) return nav('/boards') }
      else { await api.post(`/boards/${id}/save/`); toast('Board saved. It updates as the owner updates it.') }
      await load(); refresh()
    } catch (e) { toast(errMsg(e)) }
  }
  const lock = async () => {
    const r = await toggleLock({ kind: 'board', target: id, locked: b.locked, ask, toast })
    if (r !== null) { setBoard({ ...b, locked: r }); refresh() }
  }

  const links = useMemo(() => b?.links || [], [b])
  // a board with nothing but videos previews as a carousel
  const playlist = useMemo(() => (links.length > 1 && links.every((l) => isVideoUrl(l.url)) ? links : null), [links])
  if (loading && !b) return <Skel />
  if (!b) return null
  return (
    <>
      <div className="bar">
        <div className="subrow" id="bActions" style={{ flexWrap: 'nowrap' }}>
          {manage && (
            <>
              <button className="ghost ibtn" aria-label={b.is_public ? 'Make private' : 'Make public'} title={b.is_public ? 'Public. Tap to make private' : 'Private. Tap to make public'}
                onClick={() => act(() => api.patch(`/boards/${id}/`, { is_public: !b.is_public }), b.is_public ? 'Now private' : 'Now public')}>
                <span className="m-only">{b.is_public ? <Globe /> : <EyeOff />}</span>
                <span className="pc-only">{b.is_public ? 'Public' : 'Private'}</span>
              </button>
            </>
          )}
          {(manage || b.perms?.invite) && <button className="ghost ibtn" aria-label="Invite OPALS" title="Invite an OPAL" onClick={() => setInvite(true)}><UserPlus /></button>}
          {!b.is_member && (b.is_public || b.is_saved) && (
            <button className={`ghost ibtn ${b.is_saved ? 'primary' : ''}`} aria-label={b.is_saved ? 'Unsave board' : 'Save board'} title={b.is_saved ? 'Saved. Tap to remove' : 'Save this board'} onClick={toggleSave}><Bookmark /></button>
          )}
          {manage && <button className="ghost ibtn" aria-label="Board style" title="Colour and emoji" onClick={() => setStyleOpen(true)}><Palette /></button>}
          {user && <button className="ghost ibtn" aria-label="Board activity" title={b.can_analytics ? 'Activity and analytics' : 'Activity'} onClick={() => openAct('activity')}><Pulse /></button>}
          <button className="ghost ibtn" aria-label="Share board" title="Share board" onClick={shareMenu}><ShareI /></button>
          {b.is_member && <button className="ghost ibtn" aria-label={b.locked ? 'Remove lock' : 'Lock board'} onClick={lock}><Lock /></button>}
          {b.is_owner && <button className="ghost ibtn danger" aria-label="Delete board" onClick={del}><Trash /></button>}
          {b.is_member && !b.is_owner && <button className="ghost ibtn danger" aria-label="Leave board" onClick={leave}><Exit /></button>}
          <span style={{ marginLeft: 'auto', display: 'flex', gap: 14 }}>
            <span className="bstat pc-only"><LinkI size={16} />{b.link_count}</span>
            {b.is_member && <button className="bstat bsbtn pc-only" onClick={() => setPeople(true)} aria-label="Collaborators"><People size={16} />{b.member_count}</button>}
          </span>
        </div>
        {playlist && <button className="ghost primary" style={{ marginLeft: 'auto' }} onClick={() => setViewer({ ...links[0], playlist })}>▶ Play all</button>}
        <div className="views" style={{ marginLeft: playlist ? 0 : 'auto' }}>
          <button className={view === 'list' ? 'on' : ''} onClick={() => setView('list')}><ListI /></button>
          <button className={view === 'square' ? 'on' : ''} onClick={() => setView('square')}><Grid4 /></button>
        </div>
      </div>
      {b.frozen && <p className="hint" style={{ margin: '10px 20px' }}>The owner made this board private, so it no longer updates. You are seeing it as it was.</p>}
      <LinkGrid links={links} view={view} getMenu={menu} playlist={playlist} empty={b.can_edit ? 'This board is empty. Tap + to add a link.' : 'Nothing here yet.'} />
      {b.can_edit && <button className="fab" aria-label="Add link" onClick={() => setAdding(true)}>+</button>}

      <AddLinkModal open={adding} onClose={() => setAdding(false)} board={b} onAdded={() => { load(); refresh() }} />
      <EditLinkModal link={edit} board={b} onClose={() => setEdit(null)} onSaved={load} />
      <PickBoardModal payload={toBoard} onClose={() => setToBoard(null)} />
      {menuEl}
      <PickFriendModal link={toFriend} onClose={() => setToFriend(null)} />
      <BoardStyleModal open={styleOpen} board={b} onClose={() => setStyleOpen(false)} onSaved={load} />
      <BoardActivityModal open={actOpen} tab={actTab} board={b} onClose={() => setActOpen(false)} />
      <QrModal open={qrOpen} url={boardUrl} title={b.name} onClose={() => setQrOpen(false)} />
      <PeopleModal open={people} onClose={() => setPeople(false)} board={b} me={user} nav={nav} onChanged={load} />
      <InviteModal open={invite} onClose={() => setInvite(false)} board={b} onDone={load} />
    </>
  )
}
