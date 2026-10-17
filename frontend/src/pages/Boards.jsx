import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { NewBoardModal } from '../components/LazyModals'
import { useApp, useFetch, useTopBar } from '../context'
import { FolderBig, Lock, People } from '../icons'
import { BoardCover, Skel } from '../components/ui'
import { unlockWithPin } from '../lib'
import { burst } from '../gestures'

export default function Boards() {
  const nav = useNavigate()
  const { ask, toast, tick } = useApp()
  const { data: boards, loading, reload } = useFetch('/boards/', [tick])
  const { data: links } = useFetch('/links/')
  useTopBar({}, [])

  const open = async (b) => {
    if (b.locked && !(await unlockWithPin({ kind: 'board', target: b.id, ask, toast, title: `Unlock “${b.name}”` }))) return
    nav(`/boards/${b.id}`)
  }
  const [creating, setCreating] = useState(false)
  const create = () => setCreating(true)
  const created = () => { toast('Board created'); if (!(boards || []).length) burst(); reload() }

  if (loading) return <Skel />
  return (
    <main className="folders">
      <button className="folder" onClick={() => nav('/boards/all')}>
        <FolderBig />
        <span className="fname">All</span>
        <span className="fcount">{(links || []).length} links</span>
        <span className="fmeta prv">Malinks + Saved</span>
      </button>
      {(boards || []).map((b) => (
        <button key={b.id} className="folder" onClick={() => open(b)}>
          <BoardCover b={b} />
          <span className="fname">{b.name}</span>
          <span className="fcount">{b.link_count} link{b.link_count === 1 ? '' : 's'}</span>
          {b.category_name && <span className="fcat">{b.category_name}</span>}
          <span className={`fmeta ${b.is_public ? '' : 'prv'}`} style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
            {b.locked ? <Lock size={13} /> : b.is_public && !b.saved ? <>Public</> : null}
            {b.member_count > 1 && <><People size={13} />{b.member_count}</>}
            {b.saved ? (b.frozen ? 'Saved · paused' : 'Saved') : !b.locked && !b.is_public && b.member_count <= 1 && 'Private'}
          </span>
        </button>
      ))}
      <button className="folder newf" onClick={create}><span className="plus">+</span><span className="fname">New board</span></button>
      <button className="fab" aria-label="New board" onClick={create}>+</button>
      <NewBoardModal open={creating} onClose={() => setCreating(false)} onCreated={created} />
    </main>
  )
}
