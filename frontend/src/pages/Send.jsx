import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api, errMsg } from '../api'
import { useApp, useFetch, useTopBar } from '../context'
import { Avatar, Skel } from '../components/ui'
import { useBack } from '../routing'

/* Send to an OPAL, as a page: /send?url=...&title=... (a card's menu opens it in a new tab) */
export default function Send() {
  const [sp] = useSearchParams()
  const url = sp.get('url') || ''
  const title = sp.get('title') || url
  const { toast } = useApp()
  const back = useBack('/discover')
  const { data, loading } = useFetch('/friends/', [])
  const [sent, setSent] = useState({})
  useTopBar({ back, center: 'Send', hideTabs: true }, [])
  if (loading && !data) return <Skel />
  const friends = (data || []).filter((f) => f.status === 'accepted')
  const send = async (u) => {
    try { await api.post(`/messages/${u.id}/`, { url }); setSent((x) => ({ ...x, [u.id]: true })); toast(`Sent to ${u.nickname || u.name}`) }
    catch (e) { toast(errMsg(e)) }
  }
  return (
    <main className="sendpage">
      <h2>Send to an OPAL</h2>
      <p className="sendwhat"><b>{title}</b><small>{url}</small></p>
      {!url && <p className="hint">There is nothing to send. Open this from a card’s menu.</p>}
      {url && !friends.length && <p className="hint">You have no OPALS yet. Follow people to make some.</p>}
      {url && friends.map((f) => (
        <div className="frow" key={f.user.id}>
          <Avatar u={f.user} />
          <div className="n"><b>{f.user.nickname || f.user.name}</b><small>@{f.user.username}</small></div>
          <div className="b"><button className={`ghost ${sent[f.user.id] ? '' : 'bluebtn'}`} disabled={!!sent[f.user.id]} onClick={() => send(f.user)}>{sent[f.user.id] ? 'Sent ✓' : 'Send'}</button></div>
        </div>
      ))}
    </main>
  )
}
