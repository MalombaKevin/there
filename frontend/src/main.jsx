import React from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import { AppProvider, prefetch } from './context'
import App from './App'
import './styles.css'
import { applyTheme, getTheme } from './theme'

applyTheme(getTheme())

// start downloading the first screen now, in parallel with the sign-in check, then warm the other tabs when the browser is idle
const signedIn = !!localStorage.getItem('opio.tokens')
if (signedIn) import('./pages/Home')
// ...and its data, so it is already on its way when the page code arrives
const path = location.pathname
if (path === '/' || path === '/discover') ['/discover/', '/categories/', '/discover/boards/?q='].forEach(prefetch)
else if (signedIn && path === '/friends') ['/feed/', '/categories/', '/feed/boards/?q='].forEach(prefetch)
else if (signedIn && path === '/malinks') ['/links/?source=mine', '/categories/'].forEach(prefetch)
else if (signedIn && path === '/boards') ['/boards/', '/links/'].forEach(prefetch)
else if (signedIn && path === '/inbox') prefetch('/conversations/')
const idle = window.requestIdleCallback || ((f) => setTimeout(f, 1500))
idle(() => { import('./pages/Boards'); import('./pages/Inbox'); import('./components/LinkGrid') })

// a data router (instead of <BrowserRouter>) lets a page ask "save or discard?" before you leave it
const router = createBrowserRouter([{ path: '*', element: <AppProvider><App /></AppProvider> }])

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>,
)
