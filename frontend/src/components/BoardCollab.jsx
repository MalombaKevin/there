import { useState } from 'react'
import { api, errMsg } from '../api'
import { useApp, useFetch } from '../context'
import { Avatar, Modal, Seg } from './ui'
import { Trash } from '../icons'

/* The extra things an editor can be allowed to do on a board. A co-owner can do all of them and more:
   everything the owner can, except delete the board or remove the owner. */
export const PERMS = [
  { key: 'delete', field: 'can_delete', label: 'Can delete other people’s links' },
  { key: 'invite', field: 'can_invite', label: 'Can add people' },
  { key: 'remove', field: 'can_remove', label: 'Can remove collaborators' },
  { key: 'coown', field: 'co_owner', label: 'Co-owner', hint: 'Can do anything on the board except delete it or remove you.' },
]

/* A tickable permission */
export function Check({ checked, disabled, onChange, label, hint }) {
  return (
    <label className={`bperm ${disabled ? 'off' : ''}`}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span><b>{label}</b>{hint && <small>{hint}</small>}</span>
    </label>
  )
}

/* Which extra permissions the person using the modal may hand out: the owner all of them, anyone else only the ones they hold (never co-owner) */
const grantable = (board, p) => (board.is_owner ? p.key !== undefined : p.key !== 'coown' && !!board.perms?.[p.key])

/* Ticked permissions -> the fields the server takes. A co-owner has every permission. */
export const permFields = (perms) => {
  const co = !!perms.coown
  return Object.fromEntries(PERMS.map((p) => [p.field, co || !!perms[p.key]]))
}

/* Invite an OPAL to the board: what they may do (view or edit, plus the extra checks for an editor) and whether they see its analytics.
   The choices start from Settings, Boards. */
export function InviteModal({ open, onClose, board, onDone }) {
  const { user: me, toast } = useApp()
  const { data: friends } = useFetch('/friends/', [open])
  const [role, setRole] = useState(me?.invite_role || 'edit')
  const [perms, setPerms] = useState(me?.invite_perms || {})
  const [analytics, setAnalytics] = useState(!!me?.invite_analytics)
  if (!open) return null
  const ids = new Set(board.members.map((m) => m.id))
  const cands = (friends || []).filter((f) => f.status === 'accepted' && !ids.has(f.user.id))
  const tick = (key) => (v) => setPerms({ ...perms, [key]: v })
  const send = async (u) => {
    const mine = Object.fromEntries(PERMS.filter((p) => grantable(board, p)).map((p) => [p.key, !!perms[p.key]]))
    try {
      await api.post(`/boards/${board.id}/invite/`, { user_id: u.id, role, can_analytics: analytics, ...(role === 'edit' ? permFields(mine) : {}) })
      toast(`Invite sent to ${u.nickname || u.name}`); onDone?.(); onClose()
    } catch (e) { toast(errMsg(e)) }
  }
  const co = !!perms.coown && board.is_owner
  return (
    <Modal onClose={onClose}>
      <div className="sheet invitesheet">
        <h2>Invite an OPAL</h2>
        <p>They get a “Board Collab Invite” in their Inbox. Choose what they can do on this board:</p>
        <Seg value={role} onChange={setRole} options={[['edit', 'Can edit'], ['view', 'View only']]} />
        {role === 'edit' && (
          <div className="bperms">
            {PERMS.filter((p) => grantable(board, p)).map((p) => (
              <Check key={p.key} label={p.label} hint={p.hint} checked={p.key === 'coown' ? co : co || !!perms[p.key]} disabled={p.key !== 'coown' && co} onChange={tick(p.key)} />
            ))}
          </div>
        )}
        <p>Who can see this board’s analytics:</p>
        <Seg value={co || analytics} onChange={setAnalytics} options={[[false, 'Only me'], [true, 'This person too']]} />
        <div className="invitelist">
          {cands.length ? cands.map((f) => (
            <div className="frow" key={f.user.id}>
              <Avatar u={f.user} /><div className="n"><b>{f.user.nickname || f.user.name}</b><small>@{f.user.username}</small></div>
              <div className="b"><button className="ghost primary" onClick={() => send(f.user)}>Invite</button></div>
            </div>
          )) : <p className="hint">No OPALS to invite.</p>}
        </div>
        <div className="btns"><button onClick={onClose}>Close</button></div>
      </div>
    </Modal>
  )
}

/* What one collaborator may do: the extra checks, the co-owner option (owner only) and the analytics */
function PermsModal({ board, member, onClose, onChanged }) {
  const { toast } = useApp()
  const name = member.nickname || member.name
  const [perms, setPerms] = useState({ delete: !!member.can_delete, invite: !!member.can_invite, remove: !!member.can_remove, coown: !!member.co_owner })
  const [analytics, setAnalytics] = useState(!!member.can_analytics)
  const [busy, setBusy] = useState(false)
  const tick = (key) => (v) => setPerms({ ...perms, [key]: v })
  const co = !!perms.coown
  const save = async () => {
    setBusy(true)
    try {
      const body = { can_analytics: co || analytics, ...(member.role === 'edit' || co ? permFields(Object.fromEntries(PERMS.filter((p) => board.is_owner || p.key !== 'coown').map((p) => [p.key, !!perms[p.key]]))) : {}) }
      if (!board.is_owner) delete body.co_owner
      await api.patch(`/boards/${board.id}/members/${member.id}/`, body)
      toast(`${name}’s access was saved`); onChanged?.(); onClose()
    } catch (e) { toast(errMsg(e)) } finally { setBusy(false) }
  }
  return (
    <Modal onClose={onClose}>
      <div className="sheet invitesheet">
        <h2>{name}</h2>
        {member.role === 'view' && !co && <p>{name} can only view this board. Allow them to edit to give them more.</p>}
        <div className="bperms">
          {PERMS.filter((p) => board.is_owner || p.key !== 'coown').map((p) => (
            <Check key={p.key} label={p.label} hint={p.hint} checked={p.key === 'coown' ? co : co || !!perms[p.key]} disabled={(p.key !== 'coown' && co) || (member.role === 'view' && p.key !== 'coown')} onChange={tick(p.key)} />
          ))}
          <Check label="Can see the board’s analytics" checked={co || analytics} disabled={co} onChange={setAnalytics} />
        </div>
        <div className="btns"><button onClick={onClose}>Cancel</button><button className="go" disabled={busy} onClick={save}>{busy ? '…' : 'Save'}</button></div>
      </div>
    </Modal>
  )
}

/* The people on the board. The owner and co-owners set what each may do; an editor with the remove permission can take people off. */
export function PeopleModal({ open, onClose, board, me, nav, onChanged }) {
  const { toast, confirm } = useApp()
  const [editing, setEditing] = useState(null)
  if (!open) return null
  const manage = board.is_owner || board.is_coowner                  // set what people may do
  const canRemove = manage || !!board.perms?.remove
  const ownerId = board.owner.id
  // a co-owner can only be changed or removed by the owner
  const mayTouch = (m) => m.id !== ownerId && (board.is_owner || !m.co_owner)
  const remove = async (m) => {
    if (!(await confirm({ title: 'Remove collaborator?', message: `${m.nickname || m.name} will no longer be on this board.`, label: 'Remove' }))) return
    try { await api.delete(`/boards/${board.id}/members/${m.id}/`); toast(`${m.nickname || m.name} was removed`); onChanged?.() }
    catch (e) { toast(errMsg(e)) }
  }
  const setRole = async (m, role) => {
    try { await api.patch(`/boards/${board.id}/members/${m.id}/`, { role }); toast(role === 'view' ? `${m.nickname || m.name} can now only view` : `${m.nickname || m.name} can now edit`); onChanged?.() }
    catch (e) { toast(errMsg(e)) }
  }
  const tags = (m) => {
    if (m.id === ownerId) return ' · owner'
    if (m.co_owner) return ' · co-owner'
    const extra = [m.can_delete && 'delete', m.can_invite && 'add people', m.can_remove && 'remove people', m.can_analytics && 'analytics'].filter(Boolean)
    return `${m.role === 'view' ? ' · view only' : ' · can edit'}${extra.length ? ` · ${extra.join(', ')}` : ''}`
  }
  return (
    <Modal onClose={onClose}>
      <div className="sheet peoplesheet">
        <h2>Collaborators</h2>
        <p>{manage ? 'Choose who can edit this board and what else they may do, or remove someone.' : canRemove ? 'You can remove collaborators from this board.' : 'Collaborators with edit access can add links to this board.'}</p>
        {board.members.map((m) => (
          <div className="frow" key={m.id}>
            <button className="fuser" onClick={() => { if (m.id !== me.id) { onClose(); nav(`/u/${m.username}`) } }}>
              <Avatar u={m} />
              <span className="fn"><b>{m.id === me.id ? 'Me' : m.nickname || m.name}</b><small>@{m.username}{tags(m)}</small></span>
            </button>
            {mayTouch(m) && (manage || canRemove) && (
              <div className="b">
                {manage && !m.co_owner && <button className="ghost" onClick={() => setRole(m, m.role === 'view' ? 'edit' : 'view')}>{m.role === 'view' ? 'Allow edit' : 'View only'}</button>}
                {manage && <button className="ghost" onClick={() => setEditing(m)}>Permissions</button>}
                {canRemove && <button className="ghost danger" aria-label="Remove collaborator" title="Remove from board" onClick={() => remove(m)}><Trash size={16} /></button>}
              </div>
            )}
          </div>
        ))}
        <div className="btns"><button onClick={onClose}>Close</button></div>
      </div>
      {editing && <PermsModal board={board} member={editing} onClose={() => setEditing(null)} onChanged={onChanged} />}
    </Modal>
  )
}
