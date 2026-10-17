import { useBack } from '../routing'
import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApp, useTopBar } from '../context'
import { BlockedBody, InterestsBody } from '../components/Modals'

/* Full pages opened from the profile drawer / Discover gear */
function Page({ title, sub, children }) {
  const nav = useNavigate()
  const back = useBack()
  useTopBar({ back, hideTabs: true, center: title, right: <span /> }, [title])
  return (
    <div className="spage">
      <h2>{title}</h2>
      <p className="sub">{sub}</p>
      {children}
    </div>
  )
}

export function InterestsPage() {
  const { user, patchMe } = useApp()
  // opening this page counts as finishing first-time setup
  useEffect(() => { if (user && !user.interests_set) patchMe({ interests_set: true }).catch(() => {}) }, [user?.interests_set]) // eslint-disable-line
  return <Page title="Interests" sub="Choose what shows up in Discover."><InterestsBody /></Page>
}

export function BlockedPage() {
  return <Page title="Blocked" sub="People you block can't see you, and you won't see them."><BlockedBody /></Page>
}
