export const THEMES = [
  { id: 'classic', name: 'Classic', bg: '#f6f1e9', accent: '#e2542b' },
  { id: 'ocean', name: 'Ocean', bg: '#e9f1fb', accent: '#1f6feb' },
  { id: 'sunset', name: 'Sunset', bg: '#fff0e6', accent: '#f4400f' },
  { id: 'night', name: 'Night', bg: '#141120', accent: '#9d7dff' },
]
export const MAX_CUSTOM = 3
const KEY = 'opio_theme'
const CUSTOM_KEY = 'opio_themes_custom'
export const DEFAULT_CUSTOM = { bg: '#14202b', ink: '#f2f6fa', accent: '#ff8a3d', image: '', size: 'm', font: 'default', density: 'comfy' }
export const FONTS = {
  default: "'DM Sans', system-ui, sans-serif",
  serif: "'Fraunces', Georgia, serif",
  mono: "ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace",
  round: "ui-rounded, 'Trebuchet MS', 'Segoe UI', sans-serif",
}
export const SIZES = { s: '14.5px', m: '16px', l: '17.5px' }   // text size is part of a theme
const VARS = ['--font', '--bg', '--ink', '--accent', '--accent-2', '--card', '--line', '--muted', '--bgimg']

// Your own themes (max 3): [{ id: 'custom-1', bg, ink, accent, image }]
export function getCustoms() {
  try { const a = JSON.parse(localStorage.getItem(CUSTOM_KEY)); return Array.isArray(a) ? a.filter((c) => c && c.id && c.bg).slice(0, MAX_CUSTOM) : [] } catch { return [] }
}

export function saveCustoms(list) {
  try { localStorage.setItem(CUSTOM_KEY, JSON.stringify(list)); return true } catch { return false } // image too big for storage
}

export function getTheme() {
  try {
    const t = localStorage.getItem(KEY)
    return THEMES.some((x) => x.id === t) || getCustoms().some((c) => c.id === t) ? t : 'night'
  } catch { return 'night' }
}

const isDark = (hex) => {
  const n = parseInt(hex.slice(1), 16)
  return ((n >> 16) * 299 + ((n >> 8) & 255) * 587 + (n & 255) * 114) / 1000 < 140
}

// Paint a custom theme (also used for the live preview in the editor, without saving)
export function paintCustom(c) {
  const s = document.documentElement.style
  s.setProperty('--bg', c.bg)
  s.setProperty('--ink', c.ink)
  s.setProperty('--accent', c.accent)
  s.setProperty('--accent-2', c.accent)
  s.setProperty('--card', `color-mix(in srgb, ${c.bg} 92%, ${c.ink})`)
  s.setProperty('--line', `color-mix(in srgb, ${c.bg} 80%, ${c.ink})`)
  s.setProperty('--muted', `color-mix(in srgb, ${c.ink} 62%, ${c.bg})`)
  s.setProperty('--bgimg', c.image ? `url("${c.image}")` : 'none')
  s.colorScheme = isDark(c.bg) ? 'dark' : 'light'
  document.documentElement.style.fontSize = SIZES[c.size] || SIZES.m
  s.setProperty('--font', FONTS[c.font] || FONTS.default)
  if (c.density === 'compact') document.documentElement.setAttribute('data-density', 'compact')
  else document.documentElement.removeAttribute('data-density')
  document.documentElement.setAttribute('data-theme', 'custom')
}

function clearCustom() {
  const s = document.documentElement.style
  VARS.forEach((v) => s.removeProperty(v))
  s.colorScheme = ''
  document.documentElement.style.fontSize = ''   // built-in themes use the normal text size, font and spacing
  document.documentElement.removeAttribute('data-density')
}

export function applyTheme(id) {
  clearCustom()
  const c = getCustoms().find((x) => x.id === id)
  if (c) paintCustom(c)
  else if (id === 'classic') document.documentElement.removeAttribute('data-theme')
  else document.documentElement.setAttribute('data-theme', THEMES.some((t) => t.id === id) ? id : 'night')
  try { localStorage.setItem(KEY, id) } catch { /* private mode */ }
}
