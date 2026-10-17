import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useBack } from '../routing'
import { useApp, useFetch, useTopBar } from '../context'
import CardStatsModal from '../components/CardStatsModal'
import { errMsg } from '../api'
import { Seg } from '../components/ui'
import ChatSettingsPanel from '../components/ChatSettingsPanel'
import { AccountPanel, PrivacyPanel, Row } from '../components/SettingsPanels'
import { BlockedBody, InterestsBody } from '../components/Modals'
import { useNameCheck } from '../lib'
import DiscoverBlocks from '../components/DiscoverBlocks'
import { Check, PERMS } from '../components/BoardCollab'
import { COUNTRIES, flagOf } from '../countries'


const TOPICS = [
  { id: 'account', label: 'Account' },
  { id: 'interests', label: 'Interests' },
  { id: 'privacy', label: 'Privacy' },
  { id: 'chat', label: 'Chat' },
  { id: 'boards', label: 'Boards' },
  { id: 'blocked', label: 'Blocked' },
  { id: 'stuff', label: 'OMine' },
]
/* Everything you can find in Settings, for the search box: tapping a result opens its topic */
const INDEX = [
  ['account', 'Name', 'display name'], ['account', 'Username', 'handle @'], ['account', 'Contact', 'email address'], ['account', 'Change picture', 'photo avatar profile picture'],
  ['account', 'Gender', 'female male other'], ['account', 'Country', 'nation location flag'], ['account', 'Show gender or country on my profile', 'hide visible'],
  ['privacy', 'Profile public or private', 'account visibility followers'], ['privacy', 'Who can message you', 'dm messages anyone opals no one'], ['privacy', 'QR messages from others', 'allow qr code messages'],
  ['chat', 'QR code privacy', 'private destroy after viewing self-destruct'], ['chat', 'Disappear after (all)', 'auto-delete messages never day days'], ['chat', 'Links disappear after', 'auto-delete'],
  ['chat', 'Boards disappear after', 'auto-delete'], ['chat', 'QR codes disappear after', 'auto-delete'],
  ['boards', 'Board collaboration', 'collaborators invite edit view analytics default'], ['boards', 'What invited people can do', 'edit view only collaborators'], ['boards', 'Who sees a board’s analytics', 'collaborators invite'],
  ['interests', 'Interests', 'topics categories discover'], ['interests', '18+ content', 'adult hide show mature'], ['interests', 'Discover settings', 'block hide filter', 'discover'],
  ['interests', 'Blocked interests', 'block categories hide', 'discover'], ['interests', 'Blocked countries', 'block country hide', 'discover'], ['interests', 'Blocked keywords', 'block words hide filter', 'discover'],
  ['blocked', 'Blocked people', 'block users unblock'], ['blocked', 'Blocked categories', 'unblock interest'],
  ['stuff', 'My profile', 'shortcut'], ['stuff', 'OCARD', 'cards shortcut'], ['stuff', 'Analytics', 'stats shortcut'], ['stuff', 'Log out', 'sign out logout'],
]
/* One category: a titled card. Cards sit in one column on a phone and two or three side by side on a wide screen. */
function Section({ title, sub, children }) {
  return (
    <section className="setcard">
      <header><div><h3>{title}</h3>{sub && <small>{sub}</small>}</div></header>
      <div className="scbody">{children}</div>
    </section>
  )
}

/* A row that opens another page */
function LinkRow({ label, hint, onClick, danger }) {
  return (
    <button type="button" className={`slink ${danger ? 'danger' : ''}`} onClick={onClick}>
      
      <span className="slt"><b>{label}</b>{hint && <small>{hint}</small>}</span>
      <span className="chev" aria-hidden="true">›</span>
    </button>
  )
}

/* Settings: everything you can change in the app, in one place and sorted by what it is about */
export default function SettingsPage() {
  const { user, patchMe, toast, logout, setPhotoEdit } = useApp()
  const nav = useNavigate()
  const back = useBack()
  useTopBar({ back, hideTabs: true, center: 'Settings', right: <span /> }, [])
  // the topic open on the right lives in the address (/settings?t=chat), so coming back from another page lands on the same topic
  const [params, setParams] = useSearchParams()
  const cat = TOPICS.some((t) => t.id === params.get('t')) ? params.get('t') : 'account'
  const setCat = (id) => setParams({ t: id }, { replace: true })
  const { data: cards } = useFetch('/linkpage/', [])      // for the OCARD analytics shortcut
  const [cardStats, setCardStats] = useState(false)
  const [itab, setItab] = useState('mine')    // inside Interests: your interests, or the Discover settings
  const [q, setQ] = useState('')                // the search box above the topics
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const searching = words.length > 0
  const results = INDEX.filter(([, label, extra]) => words.every((w) => `${label} ${extra}`.toLowerCase().includes(w)))
  const topicName = (id) => TOPICS.find((t) => t.id === id)?.label
  const openResult = ([topic, , , sub]) => { setQ(''); setItab(sub === 'discover' ? 'discover' : 'mine'); setCat(topic) }
  // phone: the row of topics slides to keep the open one in view (hiding what has gone by, showing what is next),
  // and swiping the settings left or right moves to the next or previous topic
  const navRef = useRef(null)
  useEffect(() => {
    const row = navRef.current
    const btn = row?.querySelector('button.on')
    if (row && btn) row.scrollTo({ left: btn.offsetLeft - (row.clientWidth - btn.offsetWidth) / 2, behavior: 'smooth' })
  }, [cat])
  const swipe = useRef(null)
  const onTouchStart = (e) => { const t = e.touches[0]; swipe.current = { x: t.clientX, y: t.clientY, skip: !!e.target.closest('.seg, input, select, textarea, .chiprow, .themes') } }
  const onTouchEnd = (e) => {
    const s = swipe.current; swipe.current = null
    if (!s || s.skip) return
    const t = e.changedTouches[0]
    const dx = t.clientX - s.x, dy = t.clientY - s.y
    if (Math.abs(dx) < 70 || Math.abs(dx) < Math.abs(dy) * 1.6) return
    const i = TOPICS.findIndex((x) => x.id === cat) + (dx < 0 ? 1 : -1)
    if (TOPICS[i]) setCat(TOPICS[i].id)
  }
  const here = { state: { back: `/settings?t=${cat}` } }     // pages opened from here come back here
  // opening the interests counts as finishing first-time setup, as on the Interests page
  useEffect(() => { if (cat === 'interests' && !user.interests_set) patchMe({ interests_set: true }).catch(() => {}) }, [cat]) // eslint-disable-line
  const ad = user.auto_delete || {}
  const set = (patch, msg = 'Saved') => patchMe(patch).then(() => toast(msg)).catch((e) => toast(errMsg(e)))

  return (
    <div className="spage sethome">
      <div className="sset">
        <div className="sstick">
          <input type="search" className="ssearch" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search settings" aria-label="Search settings" autoCapitalize="none" spellCheck={false} />
          <nav className="snav" aria-label="Settings topics" ref={navRef}>
          {TOPICS.map((t) => (
            <button key={t.id} type="button" className={cat === t.id ? 'on' : ''} aria-current={cat === t.id ? 'page' : undefined} onClick={() => setCat(t.id)}>
              <span className="snt">{t.label}</span>
            </button>
          ))}
        </nav>
        </div>
        <div className="spanel" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
        {searching && (
          <Section title="Search results" sub={results.length ? `${results.length} found. Tap one to open it.` : ''}>
            {!results.length && <p className="shint">No setting matches “{q.trim()}”.</p>}
            {results.map((r) => (
              <LinkRow key={`${r[0]}-${r[1]}`} label={r[1]} hint={topicName(r[0])} onClick={() => openResult(r)} />
            ))}
          </Section>
        )}
        {!searching && cat === 'account' && <Section title="Account"><AccountPanel /></Section>}

        {!searching && cat === 'privacy' && <Section title="Privacy" sub="Who can see you and reach you"><PrivacyPanel /></Section>}

        {!searching && cat === 'chat' && <Section title="Chat" sub="Messages, QR codes and what disappears">
          <ChatSettingsPanel ad={ad} onChange={(p) => set({ auto_delete: p })} qrPrivate={!!user.qr_private} onQrPrivate={(v) => set({ qr_private: v })} />
        </Section>}

        {!searching && cat === 'boards' && <Section title="Boards" sub="How collaboration works when you invite people to a board">
          <Row label="People I invite can" hint="This is only the starting choice. You can change it for each person in the board's Collaborators list.">
            <Seg value={user.invite_role || 'edit'} onChange={(v) => set({ invite_role: v })} options={[['edit', 'Edit'], ['view', 'View only']]} />
          </Row>
          {(user.invite_role || 'edit') === 'edit' && (
            <Row label="Extra things an editor can do" hint="Only for people who can edit. A co-owner can do everything on the board except delete it or remove you.">
              <div className="bperms">
                {PERMS.map((p) => {
                  const perms = user.invite_perms || {}
                  const co = !!perms.coown
                  return (
                    <Check key={p.key} label={p.label} hint={p.hint} checked={p.key === 'coown' ? co : co || !!perms[p.key]} disabled={p.key !== 'coown' && co}
                      onChange={(v) => set({ invite_perms: { ...perms, [p.key]: v } })} />
                  )
                })}
              </div>
            </Row>
          )}
          <Row label="Who sees a board’s analytics" hint="You always can. Collaborators you allow can see them too, and you can change it for each person in the Collaborators list.">
            <Seg value={!!user.invite_analytics} onChange={(v) => set({ invite_analytics: v })} options={[[false, 'Only me'], [true, 'Collaborators too']]} />
          </Row>
        </Section>}
        {!searching && cat === 'interests' && <Section title={itab === 'discover' ? 'Discover settings' : 'Interests'} sub={itab === 'discover' ? 'Hide what you don’t want to see in Discover' : 'Choose what shows up in Discover'}>
          <Seg value={itab} onChange={setItab} options={[['mine', 'Interests'], ['discover', 'Discover settings']]} />
          {itab === 'discover' ? <DiscoverBlocks /> : <InterestsBody />}
        </Section>}

        {!searching && cat === 'blocked' && <Section title="Blocked" sub="People you block can’t see you, and you won’t see them">
          <BlockedBody />
        </Section>}

        

        {!searching && cat === 'stuff' && <Section title="OMine" sub="Shortcuts">
          <LinkRow label="My profile" onClick={() => nav(`/u/${user.username}`, here)} />
          <LinkRow label="OCARD" hint="Your cards" onClick={() => nav('/ocard', here)} />
          <LinkRow label="Analytics" onClick={() => nav('/analytics', here)} />
          <LinkRow label="OCARD analytics" hint={(cards?.pages || []).length ? 'Views, clicks and shares of your cards' : 'You have no cards yet'} onClick={() => ((cards?.pages || []).length ? setCardStats(true) : toast('Create a card first'))} />
          {user.is_staff && <LinkRow label="Admin" onClick={() => nav('/admin', here)} />}
          <LinkRow label="Log out" danger onClick={logout} />
        </Section>}
        </div>
      </div>
      {cardStats && <CardStatsModal cards={(cards?.pages || []).map((p) => ({ id: p.id, name: p.name || p.handle }))} onClose={() => setCardStats(false)} />}
    </div>
  )
}
