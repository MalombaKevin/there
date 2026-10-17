import { lazy, Suspense, useEffect, useState } from 'react'
import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom'
import { useApp } from './context'
import { BottomNav, TopBar } from './components/Shell'
import { Dialogs, Skel, Toast } from './components/ui'
import { LoginRoute, NotFound, RequireLogin, RouteEffects, Staff } from './routing'

// Pages load on demand, so the first screen only downloads the code it needs
const Drawer = lazy(() => import('./components/Drawer'))
const Viewer = lazy(() => import('./components/Viewer'))
const GlobalModals = lazy(() => import('./components/GlobalModals'))
const Login = lazy(() => import('./pages/Login'))
const Home = lazy(() => import('./pages/Home'))
const Boards = lazy(() => import('./pages/Boards'))
const Otin = lazy(() => import('./pages/Otin'))
const ShortRedirect = lazy(() => import('./pages/ShortRedirect'))
const OGems = lazy(() => import('./pages/OGems'))
const Analytics = lazy(() => import('./pages/Analytics'))
const BoardView = lazy(() => import('./pages/BoardView'))
const Inbox = lazy(() => import('./pages/Inbox'))
const MyLinks = lazy(() => import('./pages/MyLinks'))
const Send = lazy(() => import('./pages/Send'))
const CardEditor = lazy(() => import('./pages/MyLinks').then((m) => ({ default: m.CardEditor })))
const PublicLinks = lazy(() => import('./pages/MyLinks').then((m) => ({ default: m.PublicLinks })))
const Admin = lazy(() => import('./pages/Admin'))
const Chat = lazy(() => import('./pages/Chat'))
const Profile = lazy(() => import('./pages/Profile'))
const SettingsHome = lazy(() => import('./pages/SettingsHome'))
const Loading = <Skel />

// Anyone can browse Discover and open a public board. Everything else needs an account.
const secure = (what, el) => <RequireLogin what={what}>{el}</RequireLogin>

function Layout() {
  const { user, ready, setSettings, drawer, viewer, settings, editProfile, photoEdit } = useApp()
  const [drawerSeen, setDrawerSeen] = useState(false)   // the sidebar is only downloaded the first time it is opened
  useEffect(() => { if (drawer) setDrawerSeen(true) }, [drawer])
  const loc = useLocation()
  // first login: the settings open one step at a time (account, interests, privacy, chat) until they are finished
  useEffect(() => { if (user && (!user.interests_set || (user.interests || []).length < 1)) setSettings(true) }, [user?.id]) // eslint-disable-line
  if (!ready) return <Skel />
  return (
    <>
      <RouteEffects />
      <TopBar />
      <div className="page pgin" key={loc.pathname}><Suspense fallback={Loading}><Outlet /></Suspense></div>
      <BottomNav />
      {user && drawerSeen && <Suspense fallback={null}><Drawer /></Suspense>}
      {viewer && <Suspense fallback={null}><Viewer /></Suspense>}
      {user && (settings || editProfile || photoEdit) && <Suspense fallback={null}><GlobalModals /></Suspense>}
    </>
  )
}

export default function App() {
  const { ready } = useApp()
  return (
    <Suspense fallback={Loading}>
      <Routes>
        {[['/login', 'login', 'choose'], ['/login/email', 'login', 'email'], ['/signup', 'signup', 'choose'], ['/signup/email', 'signup', 'email']].map(([path, mode, step]) => (
          <Route key={path} path={path} element={<LoginRoute ready={ready}><RouteEffects /><Login mode={mode} step={step} /></LoginRoute>} />
        ))}
        {/* a shared card is an independent page: no OPIOW bars, title or links */}
        <Route path="/:handle/ocard" element={<PublicLinks />} />
        <Route path="/l/:handle/ocard" element={<PublicLinks />} />
        <Route path="/l/:handle" element={<PublicLinks />} />
        <Route element={<Layout />}>
          <Route path="/" element={<Navigate to="/discover" replace />} />
          {/* open to everyone */}
          <Route path="/discover" element={<Home tab="discover" />} />
          <Route path="/boards/:owner/:slug" element={<BoardView />} />
          <Route path="/boards/:id" element={<BoardView />} />
          {/* need an account */}
          <Route path="/malinks" element={secure('your links', <Home tab="mine" />)} />
          <Route path="/mine" element={<Navigate to="/malinks" replace />} />
          <Route path="/friends" element={secure('your OPALS', <Home tab="friends" />)} />
          <Route path="/saved" element={<Navigate to="/friends" replace />} />
          <Route path="/boards" element={secure('your boards', <Boards />)} />
          <Route path="/inbox" element={secure('your messages', <Inbox />)} />
          <Route path="/inbox/:uid" element={secure('this chat', <Chat />)} />
          <Route path="/u/:username" element={secure('profiles', <Profile />)} />
          <Route path="/admin" element={secure('the admin page', <Staff><Admin /></Staff>)} />
          <Route path="/send" element={secure('this', <Send />)} />
          <Route path="/ocard" element={secure('your cards', <MyLinks />)} />
          <Route path="/ocard/:id" element={secure('your card', <CardEditor />)} />
          <Route path="/mylinks/*" element={<Navigate to="/ocard" replace />} />
          <Route path="/otin" element={secure('Otin', <Otin />)} />
          <Route path="/shortlink" element={<Navigate to="/otin" replace />} />
          <Route path="/s/:code" element={<ShortRedirect />} />
          <Route path="/ogems" element={<OGems />} />
          <Route path="/oguide" element={<Navigate to="/ogems" replace />} />
          <Route path="/ohacks" element={<Navigate to="/ogems" replace />} />
          <Route path="/analytics" element={secure('your analytics', <Analytics />)} />
          <Route path="/settings" element={secure('your settings', <SettingsHome />)} />
          <Route path="/settings/interests" element={<Navigate to="/settings?t=interests" replace />} />
          <Route path="/settings/blocked" element={<Navigate to="/settings?t=blocked" replace />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
      <Dialogs />
      <Toast />
    </Suspense>
  )
}
