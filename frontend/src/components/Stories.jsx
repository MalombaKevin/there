import { useState } from 'react'
import { useFetch } from '../context'
import { Avatar } from './ui'
import { StoryViewer } from '../pages/MyLinks'

/* The OPALS status row: one picture per OPAL, with their latest links and boards (up to 10) as their status.
   It is built automatically from what they created lately. Tap a picture to see it. You never see your own here. */
export default function Stories() {
  const { data: feed } = useFetch('/status/feed/', [])
  const [open, setOpen] = useState(null)       // username of the OPAL being viewed
  const cur = (feed || []).find((g) => g.owner.username === open)
  if (!(feed || []).length) return null
  return (
    <>
      <div className="stories" aria-label="Status from your OPALS">
        {feed.map((g) => (
          <button key={g.owner.username} className="story fresh" onClick={() => setOpen(g.owner.username)}>
            <span className="ring"><Avatar u={g.owner} /></span>
            <small>{g.owner.nickname || g.owner.name}</small>
          </button>
        ))}
      </div>
      {cur && <StoryViewer key={cur.owner.username} owner={cur.owner} status={cur.status} onClose={() => setOpen(null)} />}
    </>
  )
}
