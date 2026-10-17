import { useState } from 'react'
import { Seg } from './ui'

export const AUTO_OPTIONS = [[0, 'Never'], [1, '1 day'], [7, '7 days'], [30, '30 days']]

/* The chat settings, shared by the ⚙ popup in a chat and the Settings page: a toggle (All | Links & boards | QR code)
   with what disappears after how long, and QR code privacy. */
export default function ChatSettingsPanel({ ad, onChange, qrPrivate, onQrPrivate }) {
  const [tab, setTab] = useState('all')
  const same = ['link', 'qr', 'board'].every((k) => (ad[k] || 0) === (ad.link || 0)) ? (ad.link || 0) : null     // all three the same?
  return (
    <div className="chatpanel">
      <Seg value={tab} onChange={setTab} options={[['all', 'All'], ['lb', 'Links & boards'], ['qr', 'QR code']]} />
      <div className="csbodyset">
        {tab === 'all' && (
          <>
            <label>Disappear after</label>
            <Seg value={same} onChange={(d) => onChange({ link: d, qr: d, board: d })} options={AUTO_OPTIONS} />
            <p className="hint">One time for links, boards and QR codes. They disappear from your side only. The other person keeps their copy.</p>
          </>
        )}
        {tab === 'lb' && (
          <>
            <label>Links disappear after</label>
            <Seg value={ad.link || 0} onChange={(d) => onChange({ link: d })} options={AUTO_OPTIONS} />
            <label>Boards disappear after</label>
            <Seg value={ad.board || 0} onChange={(d) => onChange({ board: d })} options={AUTO_OPTIONS} />
            <p className="hint">They disappear from your side only. The other person keeps their copy.</p>
          </>
        )}
        {tab === 'qr' && (
          <>
            <label>QR codes disappear after</label>
            <Seg value={ad.qr || 0} onChange={(d) => onChange({ qr: d })} options={AUTO_OPTIONS} />
            <label>QR code privacy</label>
            <Seg value={qrPrivate} onChange={onQrPrivate} options={[[false, 'Normal'], [true, 'Private']]} />
            <p className="hint">{qrPrivate ? 'Your QR messages destroy themselves, for both of you, once the other person has viewed them.' : 'Your QR messages stay in the chat after they are opened.'}</p>
          </>
        )}
      </div>
    </div>
  )
}
