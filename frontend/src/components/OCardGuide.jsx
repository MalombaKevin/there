import { useState } from 'react'
import { Modal } from './ui'
import { X } from '../icons'

const STEPS = [
  { title: 'Welcome to OCARD', text: 'An OCARD is one page that holds everything about you: your picture, a short description and all your links. You share one address instead of many.' },
  { title: '1. Make your card', text: 'Tap “New card” and choose a name for its address (yoursite/name/ocard). Add a banner, your picture, a background and a short description of up to 28 words.' },
  { title: '2. Add your links', text: 'Add up to 30 links. Give each one a name and pick an icon from the list, or add your own picture. Mark a link 18+ if it needs it.' },
  { title: '3. Sort them into tabs', text: 'Use up to 4 tabs, for example Work, Social and Shop. The first tab holds every link; the others hold up to 6 each. Each tab can have a short description of up to 14 words, and you can drag tabs to reorder them.' },
  { title: '4. Add a status', text: 'The Status button lets you pick up to 10 links and boards that people see when they tap your picture on the card.' },
  { title: '5. Share it', text: 'Open the card’s menu to share the link, show its QR code or send it to an OPAL. “Show on profile” puts one card on your profile.' },
  { title: '6. See how it does', text: 'Analytics shows views, link clicks and shares for each card, plus your most clicked links. Your own visits are not counted.' },
]

/* A step-by-step guide to OCARD: read each step with Next and Back, or Skip it at any time. */
export default function OCardGuide({ onClose }) {
  const [i, setI] = useState(0)
  const last = i === STEPS.length - 1
  const s = STEPS[i]
  return (
    <Modal onClose={onClose} className="center">
      <div className="sheet ocguide" role="dialog" aria-label="OCARD guide" style={{ position: 'relative' }}>
        <button className="qrx" onClick={onClose} aria-label="Close the guide"><X size={18} /></button>
        <small className="ocstep">Step {i + 1} of {STEPS.length}</small>
        <h2>{s.title}</h2>
        <p>{s.text}</p>
        <div className="ocdots" aria-hidden="true">{STEPS.map((_, k) => <span key={k} className={k === i ? 'on' : ''} />)}</div>
        <div className="ocbtns">
          <button type="button" className="ocskip" onClick={onClose}>{last ? 'Close' : 'Skip'}</button>
          <span className="ocnav">
            {i > 0 && <button type="button" onClick={() => setI(i - 1)}>Back</button>}
            <button type="button" className="go" onClick={() => (last ? onClose() : setI(i + 1))}>{last ? 'Done' : 'Next'}</button>
          </span>
        </div>
      </div>
    </Modal>
  )
}
