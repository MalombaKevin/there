import { useRef, useState } from 'react'
import { useApp } from '../context'
import { errMsg } from '../api'
import { Modal } from './ui'
import { AccountPanel, PrivacyPanel } from './SettingsPanels'
import { InterestsBody } from './Modals'
import ChatSettingsPanel from './ChatSettingsPanel'

const STEPS = [
  { id: 'account', title: 'Account', sub: 'Check your name and username, and tell people a little about you.' },
  { id: 'interests', title: 'Interests', sub: 'Choose the topics you like. You need at least one to continue.' },
  { id: 'privacy', title: 'Privacy', sub: 'Choose who can see you and who can message you.' },
  { id: 'chat', title: 'Chat', sub: 'Decide what disappears from your chats and how QR messages behave.' },
]

/* The first time someone logs in, their settings open here, one step at a time: Account, Interests, Privacy, Chat. Finish at the end. */
export default function SetupWizard() {
  const { user, settings, setSettings, patchMe, toast } = useApp()
  const [i, setI] = useState(0)
  const [busy, setBusy] = useState(false)
  const saveAccount = useRef(null)
  if (!settings || !user) return null
  const s = STEPS[i]
  const last = i === STEPS.length - 1
  const needInterest = s.id === 'interests' && (user.interests || []).length < 1

  const next = async () => {
    if (s.id === 'account' && saveAccount.current && !(await saveAccount.current())) return     // a changed name or username is saved first
    if (needInterest) return toast('Pick at least one interest to continue.')
    if (!last) return setI(i + 1)
    setBusy(true)
    try { await patchMe({ interests_set: true }); setSettings(false) } catch (e) { toast(errMsg(e)) } finally { setBusy(false) }
  }

  return (
    <Modal onClose={() => {}} className="center">
      <div className="sheet setupwiz" role="dialog" aria-label="Set up your account">
        <small className="wizstep">Set up your account · Step {i + 1} of {STEPS.length}</small>
        <div className="wizbar" aria-hidden="true">{STEPS.map((x, k) => <span key={x.id} className={k < i ? 'done' : k === i ? 'cur' : ''}>{x.title}</span>)}</div>
        <h2>{s.title}</h2>
        <p className="wizsub">{s.sub}</p>
        <div className="wizbody scbody">
          {s.id === 'account' && <AccountPanel saveRef={saveAccount} />}
          {s.id === 'interests' && <InterestsBody />}
          {s.id === 'privacy' && <PrivacyPanel />}
          {s.id === 'chat' && <ChatSettingsPanel ad={user.auto_delete || {}} onChange={(p) => patchMe({ auto_delete: p }).catch((e) => toast(errMsg(e)))} qrPrivate={!!user.qr_private} onQrPrivate={(v) => patchMe({ qr_private: v }).catch((e) => toast(errMsg(e)))} />}
        </div>
        <div className="wizbtns">
          {i > 0 ? <button type="button" onClick={() => setI(i - 1)}>Back</button> : <span />}
          <button type="button" className="go" disabled={busy || needInterest} onClick={next}>{last ? (busy ? '…' : 'Finish') : 'Next'}</button>
        </div>
      </div>
    </Modal>
  )
}
