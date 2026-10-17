import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, errMsg } from '../api'
import { useApp, useFetch, useTopBar } from '../context'
import LinkGrid from '../components/LinkGrid'
import { Gear, Grid4, LinkI, ListI, People } from '../icons'
import { BoardCover, Skel } from '../components/ui'
import { defaultView, unlockWithPin } from '../lib'
import { PullIndicator, usePullToRefresh, useSwipeTabs } from '../gestures'
const Stories = lazy(() => import('../components/Stories'))
import { AddLinkModal, AdvertiseModal, EditLinkModal, PickBoardModal, PickFriendModal } from '../components/LazyModals'

const viewKey = 'opio.view'
const scopeKey = 'opio.discoverScope'
const loadScope = () => { try { return localStorage.getItem(scopeKey) === 'interests' ? 'interests' : 'all' } catch { return 'all' } }
const loadView = () => { try { const v = localStorage.getItem(viewKey); return v === 'square' || v === 'list' ? v : defaultView() } catch { return defaultView() } }   // a choice you made wins; otherwise list on phones, larger view on PC

export function useLinkActions(reload) {
  const { toast, confirm, patchMe, user, refresh } = useApp()
  const nav = useNavigate()
  const [edit, setEdit] = useState(null)
  const [adv, setAdv] = useState(null)
  const [board, setBoard] = useState(null)
  const [friend, setFriend] = useState(null)
  const run = async (fn, ok) => { try { await fn(); ok && toast(ok); reload?.(); refresh() } catch (e) { toast(errMsg(e)) } }

  const menu = (tab, cats) => (l) => {
    if (!user) return [{ label: 'Log in to save', fn: () => nav('/login', { state: { from: '/discover' } }) }]   // guests can look, not save
    // links from public boards have no Link row of their own, so they're saved by URL
    const fromBoard = l.source === 'board'
    const ref = fromBoard ? { url: l.url, title: l.title, image: l.image, adult: l.adult, from_user_id: l.owner?.id } : { link_id: l.id }
    const toBoard = { label: 'Save to board', fn: () => setBoard({ title: l.title, body: ref }) }
    const send = { label: 'Send to an OPAL', fn: () => setFriend(l) }
    if (tab === 'discover') {
      const items = [
        { label: 'Save', fn: () => run(() => api.post('/links/save/', ref), 'Saved') }, toBoard, send,
      ]
      if (l.owner && l.owner.id !== user.id) {
        items.push({ label: `Block @${l.owner.username}`, danger: true, fn: async () => {
          if (await confirm({ title: 'Block user?', message: `You won't see @${l.owner.username} or their links.`, label: 'Block' }))
            run(() => api.post('/blocks/', { user_id: l.owner.id }), 'User blocked')
        } })
      }
      if (l.category) {
        const nm = cats?.find((c) => c.id === l.category)?.name || l.category
        items.push({ label: `Block category: ${nm}`, danger: true, fn: () =>
          run(() => patchMe({ blocked_categories: [...new Set([...(user.blocked_categories || []), l.category])] }), 'Category blocked') })
      }
      return items
    }
    const items = [{ label: 'Edit', fn: () => setEdit(l) }]
    // Advertise options are switched off for now (will be activated later)
    // if (tab === 'mine') {
    //   items.push(l.advertised
    //     ? { label: 'Stop advertising', fn: () => run(() => api.delete(`/links/${l.id}/advertise/`), 'Removed from Discover') }
    //     : { label: 'Advertise', fn: () => setAdv(l) })
    // }
    items.push(toBoard, send, { label: 'Delete', danger: true, fn: async () => {
      if (await confirm({ title: 'Delete this link?', message: 'It will be removed from your links. Boards keep their own copy.' }))
        run(() => api.delete(`/links/${l.id}/`), 'Deleted')
    } })
    return items
  }
  const modals = (
    <>
      <EditLinkModal link={edit} onClose={() => setEdit(null)} onSaved={reload} />
      {/* <AdvertiseModal link={adv} onClose={() => setAdv(null)} onDone={reload} /> */}
      <PickBoardModal payload={board} onClose={() => setBoard(null)} />
      <PickFriendModal link={friend} onClose={() => setFriend(null)} />
    </>
  )
  return { menu, modals }
}

export default function Home({ tab }) {
  const nav = useNavigate()
  const [q, setQ] = useState('')
  const [view, setViewState] = useState(loadView)
  const [adding, setAdding] = useState(false)
  const [scope, setScopeState] = useState(loadScope)
  const { user, ask, toast } = useApp()
  const [kind, setKind] = useState('links') // Discover results: links | boards
  const [dq, setDq] = useState('')          // search text, debounced for the boards lookup
  useEffect(() => { const t = setTimeout(() => setDq(q.trim()), 250); return () => clearTimeout(t) }, [q])
  useTopBar({}, [])
  const feedTab = tab === 'discover' || tab === 'friends' // both show links and open boards, switched by the Links / Boards toggle
  const path = tab === 'discover' ? '/discover/' : tab === 'friends' ? '/feed/' : `/links/?source=${tab}`
  const { data, loading, reload } = useFetch(path, [tab], { poll: feedTab ? 20000 : 0 }) // Discover updates live
  const { data: cats } = useFetch('/categories/')
  const searching = feedTab
  // only the Discover / OPALS tabs list boards. With My interests on, only boards that contain links in the interests you picked (and only when you are logged in).
  const interestsOnly = tab === 'discover' && scope === 'interests' && !!user
  const { data: foundBoards } = useFetch(feedTab ? `${tab === 'friends' ? '/feed/boards/' : '/discover/boards/'}?q=${encodeURIComponent(dq)}${interestsOnly ? `&interests=1&mine=${encodeURIComponent((user.interests || []).join(','))}` : ''}` : null, [tab, interestsOnly, (user?.interests || []).join(',')])   // changing your interests refreshes this list
  const interestsLocked = tab === 'discover' && scope === 'interests' && !user       // logged out: My interests has nothing to show, so its counts are zero
  const boardRows = searching && !interestsLocked ? (foundBoards || []) : []
  const openBoard = async (b) => {
    if (b.locked && !(await unlockWithPin({ kind: 'board', target: b.id, ask, toast, title: `Unlock “${b.name}”` }))) return
    nav(`/boards/${b.id}`)
  }
  const { menu, modals } = useLinkActions(reload)
  const ptr = usePullToRefresh(reload)                       // drag down at the top to refresh (phones)
  const tabPath = (k) => (k === 'mine' ? '/malinks' : `/${k}`)           // the links tab is at /malinks
  const order = ['discover', 'mine', 'friends']               // swipe the empty page to change tab (phones)
  const at = order.indexOf(tab)
  useSwipeTabs(() => at >= 0 && at < order.length - 1 && nav(tabPath(order[at + 1])), () => at > 0 && nav(tabPath(order[at - 1])))

  const setScope = (v) => { setScopeState(v); try { localStorage.setItem(scopeKey, v) } catch { /* ignore */ } }
  const setView = (v) => { setViewState(v); try { localStorage.setItem(viewKey, v) } catch { /* ignore */ } }
  const catName = (l) => cats?.find((c) => c.id === l.category)?.name || (l.category && l.category !== 'other' ? l.category.replace(/-/g, ' ') : undefined)
  // search matches the link name, site, description and its category
  const shown = useMemo(() => {
    const s = dq.toLowerCase()
    let rows = data || []
    if (tab === 'discover' && scope === 'interests') { const mine = user?.interests || []; rows = rows.filter((l) => mine.includes(l.category)) }
    return s ? rows.filter((l) => `${l.title} ${l.host} ${l.description} ${catName(l) || ''} ${l.category || ''}`.toLowerCase().includes(s)) : rows
  }, [data, dq, cats, tab, scope, user?.interests]) // eslint-disable-line

  const empty = tab === 'discover' ? (scope === 'interests' ? 'No links with your interests yet. Add more interests in Discover settings.' : 'Nothing here yet. Make a link public to share it on Discover.')
    : tab === 'friends' ? 'Nothing here yet. Follow people to see their public links and boards.'
    : tab === 'mine' ? 'No links yet. Tap + to add your first link.' : 'Nothing saved yet. Save links from Discover, boards or chats.'

  return (
    <>
      <PullIndicator {...ptr} />
      <div className="bar homebar">
        <div className="subrow">
          <div className="seg">
            {[['discover', 'Discover'], ['mine', 'Malinks'], ['friends', 'OPALS']].map(([k, t]) => (
              <button key={k} className={tab === k ? 'on' : ''} onClick={() => nav(tabPath(k), { replace: true })}>{t}</button>
            ))}
          </div>
          {tab === 'discover' && <button className="gear" aria-label="Discover settings" onClick={() => nav('/settings?t=interests')}><Gear size={20} /></button>}
        </div>
        {tab === 'discover' && (
          <div className="seg" role="tablist" aria-label="Discover scope">
            {[['all', 'All'], ['interests', 'My interests']].map(([k, t]) => (
              <button key={k} className={scope === k ? 'on' : ''} onClick={() => setScope(k)}>{t}</button>
            ))}
          </div>
        )}
        <input type="search" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="chip">{searching && kind === 'boards' ? `${boardRows.length} board${boardRows.length === 1 ? '' : 's'}` : `${shown.length} link${shown.length === 1 ? '' : 's'}`}</span>   {/* the count follows the Links / Boards toggle */}
        <div className="views">
          <button className={view === 'list' ? 'on' : ''} onClick={() => setView('list')} aria-label="List view"><ListI /></button>
          <button className={view === 'square' ? 'on' : ''} onClick={() => setView('square')} aria-label="Large view"><Grid4 /></button>
        </div>
      </div>
      {tab === 'friends' && <Suspense fallback={null}><Stories links={data} /></Suspense>}
      {searching && (
        <div className="bar kindbar">
          <div className="seg" role="tablist" aria-label="Discover results">
            {[['links', 'Links', shown.length], ['boards', 'Boards', boardRows.length]].map(([k, t, n]) => (
              <button key={k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>{t} <span className="kn">{n}</span></button>
            ))}
          </div>
        </div>
      )}
      {searching && kind === 'boards' && boardRows.length > 0 && (
        <main className={`folders ${view === 'list' ? 'compact' : ''}`}>
          {boardRows.map((b) => (
            <button key={b.id} className="folder" onClick={() => openBoard(b)}>
              <BoardCover b={b} />
              <span className="fname">{b.name}</span>
              {view === 'square' && (
                <span className="fmeta" style={{ display: 'inline-flex', gap: 8, alignItems: 'center', fontSize: '.9rem', marginTop: -2 }}>
                  <span title="Links" style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}><LinkI size={9} />{b.link_count}</span>
                  <span title="Collaborators" style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}><People size={9} />{b.member_count}</span>
                </span>
              )}
            </button>
          ))}
        </main>
      )}
      {tab === 'discover' && scope === 'interests' && user && !(user.interests || []).length ? (
        // logged in but nothing picked yet: the links and boards of your interests need some interests first
        <div className="empty interestsgate">
          <h3>Add your interests</h3>
          <p>Pick what you like and you will see only the {kind === 'boards' ? 'boards' : 'links'} that match.</p>
          <button type="button" className="gobtn" onClick={() => nav('/settings?t=interests')}>Add interests</button>
        </div>
      ) : tab === 'discover' && scope === 'interests' && !user ? (
        // the My interests tab is there for everyone; logged out, it asks you to log in to choose your interests
        <div className="empty interestsgate">
          <h3>Log in to add your interests</h3>
          <p>Your interests decide which {kind === 'boards' ? 'boards' : 'links'} you see first in Discover.</p>
          <button type="button" className="gobtn" onClick={() => nav('/login', { state: { from: '/discover' } })}>Log in</button>
        </div>
      )
        : searching && kind === 'boards' ? (boardRows.length === 0 && <div className="empty">{interestsOnly ? 'No boards with your interests yet. Add more interests in Discover settings.' : tab === 'friends' ? 'No boards from your OPALS yet.' : 'No open boards yet.'}</div>)
        : loading ? <Skel />
        : <LinkGrid links={shown} view={view} getMenu={menu(tab === 'friends' ? 'discover' : tab, cats)} tagFor={catName} empty={empty} />}
      <button className="fab" aria-label="Add link" onClick={() => (user ? setAdding(true) : nav('/login', { state: { from: '/malinks' } }))}>+</button>
      <AddLinkModal open={adding} onClose={() => setAdding(false)} onAdded={() => { reload(); nav('/malinks') }} />
      {modals}
    </>
  )
}
