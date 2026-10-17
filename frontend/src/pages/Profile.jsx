import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { api, errMsg, readImage } from '../api'
import { ANIMALS } from '../animals'
import { useApp, useFetch, useTopBar } from '../context'
import { Avatar, BoardCover, Empty, Modal, Seg, Skel, usePopupMenu } from '../components/ui'
import LinkGrid from '../components/LinkGrid'
import { useBack } from '../routing'
import { InterestsModal, PickBoardModal, PickFriendModal, QrModal } from '../components/LazyModals'
import { Dots, Lock, Pen, Trash, X } from '../icons'
import { countryName, flagOf } from '../countries'

export default function Profile() {
  const { username } = useParams()
  const nav = useNavigate()
  const { user, toast, confirm, ask, refresh, setUser, setEditProfile, patchMe, tick } = useApp()
  const { data: p, loading, error, reload } = useFetch(`/users/${username}/`, [tick])
  const { data: reqs, reload: reloadReqs } = useFetch('/follow-requests/', [tick])
  const [tab, setTab] = useState('links')
  const [nickOpen, setNickOpen] = useState(false)
  const [interestsOpen, setInterestsOpen] = useState(false)
  const [list, setList] = useState(null) // 'followers' | 'following'
  const [photo, setPhoto] = useState(false)
  const photoFile = useRef()
  const [toBoard, setToBoard] = useState(null)
  const [toFriend, setToFriend] = useState(null)
  const back = useBack()
  const [qrOpen, setQrOpen] = useState(false)
  const me = p && user && p.id === user.id

  const block = async () => {
    if (!(await confirm({ title: `Block @${p.username}?`, message: 'You will no longer see each other’s links, profile or messages.', label: 'Block' }))) return
    try { await api.post('/blocks/', { user_id: p.id }); toast('Blocked'); refresh(); back() } catch (e) { toast(errMsg(e)) }
  }
  const [openMenu, menuEl] = usePopupMenu()
  const profileUrl = `${location.origin}/u/${username}`
  const share = async () => {
    const title = `${p.nickname || p.name} (@${p.username}) on OPIOW`
    if (navigator.share) { try { await navigator.share({ title, url: profileUrl }) } catch { /* cancelled */ } return }
    try { await navigator.clipboard.writeText(profileUrl); toast('Profile link copied') } catch { toast(profileUrl) }
  }
  const profileMenu = () => [
    { label: me ? 'Share my profile' : 'Share profile', fn: share },
    { label: 'QR code', fn: () => setQrOpen(true) },
    { label: 'Copy link', fn: async () => { try { await navigator.clipboard.writeText(profileUrl); toast('Profile link copied') } catch { toast(profileUrl) } } },
    ...(me ? [] : [{ label: 'Block', danger: true, fn: block }]),
  ]
  useTopBar({
    back, hideTabs: true, center: <>OPIOW<span>.</span></>,
    right: p ? <button className="cbtn" aria-label="More options" onClick={(e) => openMenu(e, profileMenu(), { top: true })}><Dots size={18} /></button> : <span />,
  }, [p?.id, me])

  useEffect(() => setTab('links'), [username])
  const act = async (fn, ok) => { try { await fn(); ok && toast(ok); reload(); reloadReqs(); refresh() } catch (e) { toast(errMsg(e)) } }

  if (loading && !p) return <Skel />
  if (error || !p) return <Empty>User not found.</Empty>
  const rel = p.relation || {}
  const name = p.nickname || p.name

  const changePhoto = async (e) => {
    const f = e.target.files?.[0]; e.target.value = ''
    if (!f) return
    try { await patchMe({ photo: await readImage(f, { square: true }) }); toast('Profile picture saved'); reload(); refresh() } catch (x) { toast(x.message || errMsg(x)) }
  }
  const pickAnimal = async (a) => {
    try { await patchMe({ photo: a.uri }); toast('Profile picture saved'); reload(); refresh() } catch (x) { toast(errMsg(x)) }
  }
  const deletePhoto = async () => {
    try { await patchMe({ photo: '' }); toast('Profile picture removed'); setPhoto(false); reload(); refresh() } catch (x) { toast(errMsg(x)) }
  }

  const saveNick = async (value) => {
    try {
      const { data } = await api.post(`/nicknames/${p.id}/`, { nickname: value })
      setUser({ ...user, nicknames: data.nicknames }); reload(); refresh(); setNickOpen(false)
    } catch (e) { toast(errMsg(e)) }
  }

  const followBtn = rel.follow === 'accepted'
    ? <button className="ghost" onClick={() => act(() => api.delete(`/users/${p.username}/follow/`), 'Unfollowed')}>Following</button>
    : rel.follow === 'pending'
      ? <button className="ghost" onClick={() => act(() => api.delete(`/users/${p.username}/follow/`), 'Request cancelled')}>Requested</button>
      : <button className="ghost bluebtn" onClick={() => act(() => api.post(`/users/${p.username}/follow/`), p.is_private ? 'Follow request sent' : 'Following')}>Follow</button>
  // Message replaces the friend-request button; hidden when they don't accept messages from you
  const msgBtn = p.can_message ? <button className="ghost" onClick={() => nav(`/inbox/${/^\d+$/.test(p.username) ? p.id : p.username}`)}>Message</button> : null

  const menu = (l) => [
    { label: 'Save', fn: () => act(() => api.post('/links/save/', { link_id: l.id }), 'Saved') },
    { label: 'Save to board', fn: () => setToBoard({ title: l.title, body: { link_id: l.id } }) },
    { label: 'Send to an OPAL', fn: () => setToFriend(l) },
  ]

  return (
    <div className="pwrap">
      <div className="pside">
      <div className="phead">
        <Avatar u={p} big plain={!(me || (p.photo && p.can_see))} onClick={me || (p.photo && p.can_see) ? () => setPhoto(true) : undefined} />
        <div className="pinfo">
          <b>{name}{!me && <button className="pen" aria-label="Edit nickname" title="Nickname" onClick={() => setNickOpen(true)}><Pen size={15} /></button>}</b>
          <small>@{p.username}{p.nickname ? ` · ${p.name}` : ''} {p.is_private && <Lock size={12} />}</small>
          {(p.gender || p.country) && (
            <small className="pabout">{[p.gender && { female: 'Female', male: 'Male', other: 'Other' }[p.gender], p.country && `${flagOf(p.country)} ${countryName(p.country)}`].filter(Boolean).join(' · ')}</small>
          )}
          {((p.interests || []).length > 0 || me) && (
            <div className="pbio" aria-label="Interests">
              {(p.interests || []).map((i) => <span key={i.id} className="pchip">{i.name}</span>)}
              {me && <button className="pen" aria-label="Edit my interests" title="Edit my interests" onClick={() => setInterestsOpen(true)}><Pen size={15} /></button>}
            </div>
          )}
          <div className="pcounts">
            <button onClick={() => (p.can_see ? setList('followers') : toast('This account is private'))}><b>{p.followers}</b> followers</button>
            <button onClick={() => (p.can_see ? setList('following') : toast('This account is private'))}><b>{p.following}</b> following</button>
          </div>
          <div className="pact">
            {me ? <><button className="ghost" onClick={() => setEditProfile(true)}>Edit profile</button><button className="ghost" onClick={() => nav('/ocard')}>Edit Card</button></>
              : rel.blocked ? <button className="ghost" onClick={() => act(() => api.delete(`/blocks/${p.id}/`), 'Unblocked')}>Unblock</button>
              : <>{followBtn}{msgBtn}{p.card && <button className="ghost" onClick={() => window.open(`/${p.card}/ocard`, '_blank', 'noopener')}>View Card</button>}</>}
          </div>
        </div>
      </div>

      {me && (reqs || []).length > 0 && (
        <div className="preq">
          <h3 className="sec">Follow requests</h3>
          {reqs.map((r) => (
            <div className="frow fr" key={r.id}>
              <button className="fuser" onClick={() => nav(`/u/${r.user.username}`)}><Avatar u={r.user} /><span className="fn"><b>{r.user.name}</b><small>@{r.user.username}</small></span></button>
              <div className="b">
                <button className="ghost primary" onClick={() => act(() => api.post(`/follow-requests/${r.id}/accept/`), 'Accepted')}>Accept</button>
                <button className="ghost" aria-label="Decline" onClick={() => act(() => api.post(`/follow-requests/${r.id}/decline/`))}><X size={14} /></button>
              </div>
            </div>
          ))}
        </div>
      )}

      </div>

      <div className="pmain">
      {!p.can_see ? (
        <div className="locked"><Lock size={28} /><p>{rel.blocked ? 'You blocked this user.' : 'This account is private. Follow to see their links and boards once approved.'}</p></div>
      ) : (
        <>
          <div style={{ textAlign: 'center', marginTop: 18 }}>
            <Seg value={tab} onChange={setTab} options={[['links', `Links (${p.links.length})`], ['boards', `Boards (${p.boards.length})`]]} />
          </div>
          {tab === 'links'
            ? <LinkGrid links={p.links.map((l) => ({ ...l, owner: p }))} view="list" getMenu={me ? undefined : menu} empty="No public links yet." />
            : (
              <main className="folders">
                {p.boards.length ? p.boards.map((b) => (
                  <button key={b.id} className="folder" onClick={() => nav(`/boards/${b.id}`)}>
                    <BoardCover b={b} /><span className="fname">{b.name}</span><span className="fcount">{b.link_count} links</span>
                    <span className="fmeta">Public</span>
                  </button>
                )) : <Empty>No public boards.</Empty>}
              </main>
            )}
        </>
      )}

      </div>

      <NicknameModal open={nickOpen} person={p} onClose={() => setNickOpen(false)} onSave={saveNick} />
      <PeopleList kind={list} username={p.username} onClose={() => setList(null)} onKind={setList} nav={nav} />
      {photo && (
        <div className="modal on" id="imgModal" style={{ display: 'flex' }}>
          <div className="imgwrap">
            <b>{name}</b>
            {p.photo ? <img src={p.photo} alt={p.name} /> : <Avatar big plain u={p} />}
            {me && (
              <div className="pickrow" role="radiogroup" aria-label="Choose a picture">
                <button type="button" className="plus" aria-label="Upload a photo" title="Upload a photo" onClick={() => photoFile.current.click()}>+</button>
                {ANIMALS.map((a) => (
                  <button key={a.id} type="button" role="radio" aria-checked={p.photo === a.uri} aria-label={a.name} title={a.name} className={p.photo === a.uri ? 'on' : ''} onClick={() => pickAnimal(a)}><img src={a.uri} alt="" /></button>
                ))}
                {p.photo && <button type="button" className="del" aria-label="Delete picture" title="Delete picture" onClick={deletePhoto}><Trash size={20} /></button>}
              </div>
            )}
            {me && (
              <div className="imgacts">
                <input ref={photoFile} type="file" accept="image/*" hidden onChange={changePhoto} />
              </div>
            )}
          </div>
          <button className="imgclose" aria-label="Close" onClick={() => setPhoto(false)}><X size={22} /></button>
        </div>
      )}
      {menuEl}
      <QrModal open={qrOpen} url={profileUrl} title={me ? 'My profile' : p.nickname || p.name} onClose={() => setQrOpen(false)} />
      <PickBoardModal payload={toBoard} onClose={() => setToBoard(null)} />
      <InterestsModal open={interestsOpen} onClose={() => { setInterestsOpen(false); refresh() }} />
      <PickFriendModal link={toFriend} onClose={() => setToFriend(null)} />
    </div>
  )
}

function PeopleList({ kind, username, onClose, onKind, nav }) {
  const { user } = useApp()
  const { data, loading } = useFetch(kind ? `/users/${username}/${kind}/` : null, [kind])
  if (!kind) return null
  return (
    <Modal onClose={onClose} col className="pfull">
      <div className="sheet">
        <div className="pfhead"><h2>OPALS</h2><button className="pfx" onClick={onClose} aria-label="Close">✕</button></div>
        <Seg value={kind} onChange={onKind} options={[['following', 'Following'], ['followers', 'Followers']]} />
        <div className="pflist">
          {loading ? null : !(data || []).length ? <p>Nobody yet.</p> : data.map((u) => (
            <div className="frow" key={u.id}>
              <button className="fuser" onClick={() => { onClose(); nav(`/u/${u.username}`) }}><Avatar u={u} /><span className="fn"><b>{user?.id === u.id ? 'Me' : u.nickname || u.name}</b><small>@{u.username}</small></span></button>
            </div>
          ))}
        </div>
        <div className="btns pfclose"><button onClick={onClose}>Close</button></div>
      </div>
    </Modal>
  )
}

/* Nickname: only you see it. With a nickname set, the left button deletes it instead of cancelling. */
function NicknameModal({ open, person, onClose, onSave }) {
  const [v, setV] = useState('')
  useEffect(() => { if (open) setV(person.nickname || '') }, [open]) // eslint-disable-line
  if (!open) return null
  return (
    <Modal onClose={onClose}>
      <div className="sheet">
        <h2>Nickname</h2>
        <p>Only you see this name for {person.name}.</p>
        <label>Nickname</label>
        <input value={v} maxLength={30} placeholder={person.name} autoFocus onChange={(e) => setV(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && v.trim() && onSave(v.trim())} />
        <div className="btns">
          {person.nickname ? <button className="danger" onClick={() => onSave('')}>Delete</button> : <button onClick={onClose}>Cancel</button>}
          <button className="go" onClick={() => onSave(v.trim())} disabled={!v.trim()}>Save</button>
        </div>
      </div>
    </Modal>
  )
}
