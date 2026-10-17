/* Ready-made card backgrounds: an African print, blue, black, and any colour the person picks.
   Each is a tiny SVG stored as a data URL, so it saves exactly like an uploaded background picture. */
const svgUri = (body) => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" preserveAspectRatio="xMidYMid slice">${body}</svg>`)}`

export const solidBg = (color) => svgUri(`<rect width="100%" height="100%" fill="${color}"/>`)

// an Ankara-style tile (rust ground, yellow rings, green diamonds, cream zigzags) repeated across the whole page
const PRINT = svgUri(`<defs><pattern id="p" width="90" height="90" patternUnits="userSpaceOnUse">
  <rect width="90" height="90" fill="#b5390f"/>
  <circle cx="45" cy="45" r="30" fill="#f5b700"/><circle cx="45" cy="45" r="22" fill="#0b3d2e"/><circle cx="45" cy="45" r="14" fill="#f5b700"/><circle cx="45" cy="45" r="6" fill="#b5390f"/>
  <path d="M0 0l15 15-15 15zM90 0L75 15l15 15zM0 90l15-15-15-15zM90 90L75 75l15-15z" fill="#0b3d2e"/>
  <path d="M0 45h8l4-6 4 12 4-12 4 12 4-12 4 6h4M62 45h4l4-6 4 12 4-12 4 12 4-12 4 6" fill="none" stroke="#fbeed2" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="45" cy="5" r="3" fill="#fbeed2"/><circle cx="45" cy="85" r="3" fill="#fbeed2"/>
</pattern></defs><rect width="100%" height="100%" fill="url(#p)"/>`)

export const BG_PRESETS = [
  { key: 'print', name: 'African print', uri: PRINT },
  { key: 'blue', name: 'Blue', uri: solidBg('#1d6fe8') },
  { key: 'black', name: 'Black', uri: solidBg('#0a0a0a') },
]

// the colour of a background made with solidBg (so the colour picker can start from it), or ''
export const colorOf = (uri) => {
  try { return decodeURIComponent(uri).match(/^data:image\/svg\+xml,<svg[^>]*><rect width="100%" height="100%" fill="(#[0-9a-fA-F]{6})"\/><\/svg>$/)?.[1] || '' } catch { return '' }
}
