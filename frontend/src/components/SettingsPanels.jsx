import { useEffect, useState } from 'react'
import { useApp } from '../context'
import { errMsg } from '../api'
import { Seg } from './ui'
import { useNameCheck } from '../lib'
import { COUNTRIES, flagOf } from '../countries'

/* The settings forms that appear both on the Settings page and in the first-login setup. */

/* A setting: its name (and a hint) with the control under it */
export function Row({ label, hint, children }) {
  return (
    <div className="srow">
      <label>{label}</label>
      {children}
      {hint && <small className="shint">{hint}</small>}
    </div>
  )
}

/* Name, username, picture, gender and country. `saveRef.current()` saves a name / username change and resolves to true when all is saved
   (the setup wizard calls it before moving on). */
export function AccountPanel({ saveRef }) {
  const { user, patchMe, toast, setPhotoEdit } = useApp()
  const [name, setName] = useState(user.name || '')
  const [username, setUsername] = useState(user.username || '')
  const [busy, setBusy] = useState(false)
  const nameChk = useNameCheck('username', username, user.username)
  const set = (patch, msg = 'Saved') => patchMe(patch).then(() => toast(msg)).catch((e) => toast(errMsg(e)))
  const dirty = name.trim() !== (user.name || '') || username.trim() !== (user.username || '')
  const ok = !!name.trim() && nameChk.ok !== false
  const save = async () => {
    if (!dirty) return true
    if (!ok) { toast(nameChk.msg || 'Enter a name first.'); return false }
    setBusy(true)
    try { await patchMe({ name, username }); toast('Profile saved'); return true } catch (e) { toast(errMsg(e)); return false } finally { setBusy(false) }
  }
  useEffect(() => { if (saveRef) saveRef.current = save })
  return (
    <>
      <Row label="Name"><input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} /></Row>
      <Row label="Username"><input value={username} maxLength={20} autoCapitalize="none" onChange={(e) => setUsername(e.target.value)} /></Row>
      {nameChk.msg && <small className={`namechk ${nameChk.ok ? 'ok' : 'bad'}`}>{nameChk.ok ? '✓ ' : ''}{nameChk.msg}</small>}
      <Row label="Contact"><p className="sval">{user.email}</p></Row>
      <Row label="Gender" hint="Optional.">
        <Seg value={user.gender || ''} onChange={(v) => set({ gender: v })} options={[['', 'Not set'], ['female', 'Female'], ['male', 'Male'], ['other', 'Other']]} />
      </Row>
      <Row label="Country" hint="Optional.">
        <select value={user.country || ''} onChange={(e) => set({ country: e.target.value })} aria-label="Country">
          <option value="">Not set</option>
          {COUNTRIES.map((c) => <option key={c.code} value={c.code}>{flagOf(c.code)} {c.name}</option>)}
        </select>
      </Row>
      {(user.gender || user.country) && (
        <Row label="Show on my profile" hint="Others only see what you choose to show.">
          {user.gender && <Seg value={user.show_gender !== false} onChange={(v) => set({ show_gender: v })} options={[[true, 'Show gender'], [false, 'Hide gender']]} />}
          {user.country && <Seg value={user.show_country !== false} onChange={(v) => set({ show_country: v })} options={[[true, 'Show country'], [false, 'Hide country']]} />}
        </Row>
      )}
      <div className="sbtns">
        <button type="button" className="ghost" onClick={() => setPhotoEdit(true)}>Change picture</button>
        <button type="button" className="go" disabled={!dirty || busy || !ok} onClick={save}>{busy ? '…' : 'Save'}</button>
      </div>
    </>
  )
}

/* Who can see you and reach you */
export function PrivacyPanel() {
  const { user, patchMe, toast } = useApp()
  const set = (patch, msg = 'Saved') => patchMe(patch).then(() => toast(msg)).catch((e) => toast(errMsg(e)))
  return (
    <>
      <Row label="Profile" hint="A private profile can only be seen by people you accept.">
        <Seg value={!!user.is_private} onChange={(v) => set({ is_private: v }, v ? 'Your profile is now private' : 'Your profile is now public')} options={[[false, 'Public'], [true, 'Private']]} />
      </Row>
      {!user.is_private && (
        <>
          <Row label="Who can message you">
            <Seg value={user.message_privacy || 'friends'} onChange={(v) => set({ message_privacy: v })} options={[['anyone', 'Anyone'], ['friends', 'OPALS'], ['none', 'No one']]} />
          </Row>
          <Row label="QR messages from others">
            <Seg value={user.qr_messages !== false} onChange={(v) => set({ qr_messages: v })} options={[[true, 'Allow'], [false, 'Don’t allow']]} />
          </Row>
        </>
      )}
    </>
  )
}
