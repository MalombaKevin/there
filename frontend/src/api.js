import axios from 'axios'

export const api = axios.create({ baseURL: import.meta.env.VITE_API_URL || '/api' })

/* ---- tokens ---- */
const KEY = 'opio.tokens'
export const tokens = {
  get: () => { try { return JSON.parse(localStorage.getItem(KEY) || 'null') } catch { return null } },
  set: (t) => localStorage.setItem(KEY, JSON.stringify(t)),
  clear: () => localStorage.removeItem(KEY),
}

/* ---- unlock tokens for PIN-locked chats/boards (kept only for this browser session) ---- */
const unlocks = new Map()
export const unlockStore = {
  set: (kind, target, token) => unlocks.set(`${kind}:${target}`, token),
  clear: (kind, target) => unlocks.delete(`${kind}:${target}`),
  has: (kind, target) => unlocks.has(`${kind}:${target}`),
  all: () => [...unlocks.values()].join(','),
}

const API = import.meta.env.VITE_API_URL || '/api'
// when a token runs out (read from the token itself), true
const expired = (jwt) => { try { return JSON.parse(atob(jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).exp * 1000 < Date.now() + 5000 } catch { return false } }

let refreshing = null
/* One refresh at a time. Returns the new access token, or '' when the session is over (then everyone is logged out once). */
function refreshAccess() {
  const t = tokens.get()
  if (!t?.refresh) return Promise.resolve('')
  refreshing = refreshing || axios.post(`${API}/auth/refresh/`, { refresh: t.refresh })
    .then(({ data }) => { tokens.set({ ...t, access: data.access }); return data.access })
    .catch(() => { tokens.clear(); window.dispatchEvent(new Event('opio:logout')); return '' })
    .finally(() => { refreshing = null })
  return refreshing
}

api.interceptors.request.use(async (cfg) => {
  let t = tokens.get()
  // an out-of-date token is renewed before the request goes out, so the server never answers 401 for it
  if (t?.access && !cfg.url.includes('/auth/') && expired(t.access)) {
    if (!(await refreshAccess())) throw new axios.CanceledError('Your session ended')   // nothing is sent with a dead session
    t = tokens.get()
  }
  if (t?.access && !(expired(t.access) && !t.refresh)) cfg.headers.Authorization = `Bearer ${t.access}`
  const u = unlockStore.all()
  if (u) cfg.headers['X-Unlock'] = u
  return cfg
})

api.interceptors.response.use(
  (r) => r,
  async (error) => {
    const { config, response } = error
    if (response?.status === 401 && tokens.get()?.refresh && !config._retry && !config.url.includes('/auth/')) {
      config._retry = true
      if (await refreshAccess()) return api(config)
    }
    return Promise.reject(error)
  },
)

export const errMsg = (e) =>
  e?.response?.data?.detail || (typeof e?.response?.data === 'string' ? 'Server error' : e?.message) || 'Something went wrong'
export const isLocked = (e) => e?.response?.status === 403 && e?.response?.data?.locked

/* ---- helpers ---- */
export const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, '') } catch { return u } }
export const fav = (host) => `https://www.google.com/s2/favicons?sz=64&domain=${host}`
export const thum = (url) => `https://image.thum.io/get/width/700/crop/440/noanimate/${url}`

export function embedFor(url) {
  let u
  try { u = new URL(url) } catch { return '' }
  const h = u.hostname.replace(/^www\.|^m\./, '')
  let id = ''
  if (h === 'youtu.be') id = u.pathname.slice(1)
  else if (h === 'youtube.com' || h === 'music.youtube.com') {
    if (u.pathname === '/watch') id = u.searchParams.get('v') || ''
    else { const m = u.pathname.match(/^\/(shorts|embed|live)\/([\w-]{6,})/); if (m) id = m[2] }
  }
  if (id) return `https://www.youtube.com/embed/${id.split('&')[0]}?rel=0`
  if (h === 'vimeo.com') { const m = u.pathname.match(/^\/(?:channels\/[\w-]+\/|groups\/[\w-]+\/videos\/)?(\d+)/); if (m) return `https://player.vimeo.com/video/${m[1]}` }
  if (h === 'dailymotion.com' || h === 'dai.ly') { const m = u.pathname.match(/\/(?:video\/)?([a-z0-9]+)$/i); if (m) return `https://www.dailymotion.com/embed/video/${m[1]}` }
  if (h === 'tiktok.com') { const m = u.pathname.match(/\/video\/(\d+)/); if (m) return `https://www.tiktok.com/embed/v2/${m[1]}` }
  if (h === 'streamable.com') { const m = u.pathname.match(/^\/(?:e\/)?(\w+)/); if (m) return `https://streamable.com/e/${m[1]}` }
  if (h === 'loom.com') { const m = u.pathname.match(/^\/(?:share|embed)\/(\w+)/); if (m) return `https://www.loom.com/embed/${m[1]}` }
  if (h === 'twitch.tv') {
    const c = u.pathname.match(/^\/videos\/(\d+)/)
    if (c) return `https://player.twitch.tv/?video=${c[1]}&parent=${location.hostname}&autoplay=false`
    const ch = u.pathname.match(/^\/(\w+)\/?$/)
    if (ch) return `https://player.twitch.tv/?channel=${ch[1]}&parent=${location.hostname}&autoplay=false`
  }
  if (h === 'facebook.com' || h === 'fb.watch') {
    if (h === 'fb.watch' || /\/(videos|watch|reel)/.test(u.pathname)) return `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(url)}&show_text=false`
  }
  return ''
}

/* A direct video file (.mp4, .webm, .mov, .m4v, .ogv): played with the browser's own controls */
export function videoFileFor(url) {
  try { return /\.(mp4|webm|mov|m4v|ogv)$/i.test(new URL(url).pathname) ? url : '' } catch { return '' }
}

/* Is this link a video we can play in OPIOW (any supported site, or a direct video file)? */
export const isVideoUrl = (url) => !!(embedFor(url) || videoFileFor(url))

/* Resize an image file to a small JPEG data URL (avatars are square-cropped). */
export function readImage(file, { max = 720, square = false, size = 640, ratio = 0 } = {}) {
  return new Promise((res, rej) => {
    const fr = new FileReader()
    fr.onerror = () => rej(new Error('Could not read that image'))
    fr.onload = () => {
      const im = new Image()
      im.onerror = () => rej(new Error('Not a valid image'))
      im.onload = () => {
        const c = document.createElement('canvas')
        if (square) {
          const n = Math.min(im.width, im.height)
          const out = Math.min(n, size)   // sharp when viewed full screen, never enlarged past the original
          c.width = c.height = out
          const g = c.getContext('2d'); g.imageSmoothingQuality = 'high'
          g.drawImage(im, (im.width - n) / 2, (im.height - n) / 2, n, n, 0, 0, out, out)
        } else if (ratio) {
          // a wide crop from the middle (e.g. ratio 4 = a LinkedIn-style banner, four times as wide as tall)
          let w = im.width, h = w / ratio
          if (h > im.height) { h = im.height; w = h * ratio }
          const out = Math.min(w, max)
          c.width = Math.round(out); c.height = Math.round(out / ratio)
          const g = c.getContext('2d'); g.imageSmoothingQuality = 'high'
          g.drawImage(im, (im.width - w) / 2, (im.height - h) / 2, w, h, 0, 0, c.width, c.height)
        } else {
          const k = Math.min(1, max / Math.max(im.width, im.height))
          c.width = Math.round(im.width * k); c.height = Math.round(im.height * k)
          c.getContext('2d').drawImage(im, 0, 0, c.width, c.height)
        }
        res(c.toDataURL('image/jpeg', square ? 0.92 : 0.82))
      }
      im.src = fr.result
    }
    fr.readAsDataURL(file)
  })
}
