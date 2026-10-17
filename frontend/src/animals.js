/* Profile pictures people can pick when they have no photo of their own: a few illustrated scenes
   (universe, earth, circuit board, lab), each signed "art by OPIOW" at the bottom right.
   Each is a small SVG stored as a data URL, so it works anywhere a photo does. */

// small seeded random generator, so the stars are always in the same places
const rng = (seed) => () => (seed = (seed * 16807) % 2147483647) / 2147483647
const stars = (n, seed, max = 1.1) => {
  const r = rng(seed)
  let t = ''
  for (let i = 0; i < n; i++) t += `<circle cx="${(r() * 100).toFixed(1)}" cy="${(r() * 100).toFixed(1)}" r="${(0.2 + r() * max).toFixed(2)}" fill="#fff" opacity="${(0.4 + r() * 0.6).toFixed(2)}"/>`
  return t
}
// bottom right, kept inside the round crop
const sign = (fill) => `<text x="80" y="87" text-anchor="end" font-family="Georgia,serif" font-style="italic" font-weight="700" font-size="5.6" fill="${fill}">art by OPIOW</text>`

const universe = () => `<defs><radialGradient id="u" cx="50%" cy="45%" r="75%"><stop offset="0" stop-color="#3a1f6e"/><stop offset=".55" stop-color="#150f3a"/><stop offset="1" stop-color="#05061a"/></radialGradient>
  <filter id="b"><feGaussianBlur stdDeviation="7"/></filter><filter id="b2" x="-300%" y="-300%" width="700%" height="700%"><feGaussianBlur stdDeviation="2.2"/></filter></defs>
<rect width="100" height="100" fill="url(#u)"/>
<g filter="url(#b)"><ellipse cx="34" cy="38" rx="30" ry="16" fill="#d44bb0" opacity=".55" transform="rotate(-25 34 38)"/><ellipse cx="68" cy="62" rx="30" ry="14" fill="#3b82f6" opacity=".55" transform="rotate(-25 68 62)"/><ellipse cx="52" cy="50" rx="24" ry="8" fill="#ffb86b" opacity=".4" transform="rotate(-25 52 50)"/></g>
${stars(70, 11)}
<g filter="url(#b2)"><circle cx="50" cy="50" r="5" fill="#fff4d6" opacity=".9"/></g><circle cx="50" cy="50" r="1.6" fill="#fff"/>
<path d="M50 38v24M38 50h24" stroke="#fff" stroke-width=".4" opacity=".7"/>${sign('#e8e4ff')}`

const earth = () => `<defs><radialGradient id="sea" cx="38%" cy="32%" r="80%"><stop offset="0" stop-color="#5cc3ff"/><stop offset=".55" stop-color="#1c6fd0"/><stop offset="1" stop-color="#0a2f6e"/></radialGradient>
  <radialGradient id="shade" cx="35%" cy="30%" r="80%"><stop offset=".5" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".6"/></radialGradient>
  <radialGradient id="halo" cx="50%" cy="50%" r="50%"><stop offset=".82" stop-color="#6cc4ff" stop-opacity=".6"/><stop offset="1" stop-color="#6cc4ff" stop-opacity="0"/></radialGradient>
  <clipPath id="g"><circle cx="50" cy="48" r="31"/></clipPath></defs>
<rect width="100" height="100" fill="#04081c"/>${stars(55, 5, 0.9)}
<circle cx="50" cy="48" r="39" fill="url(#halo)"/><circle cx="50" cy="48" r="31" fill="url(#sea)"/>
<g clip-path="url(#g)"><path d="M30 30c6-6 16-6 20-1 3 4-2 8-6 10-3 5 2 9-1 14-3 6-9 8-12 4-5-6-4-20-1-27z" fill="#4caf50"/>
  <path d="M58 40c6-3 14 0 16 7 1 6-3 8-5 14-2 7-8 8-9 2-1-5 2-7 0-11-2-5-4-8-2-12z" fill="#3f9a45"/><path d="M66 24c5-2 11 1 10 5-3 3-8 2-10 0z" fill="#e8f2e8"/><path d="M40 70c6-2 14 0 18 4-6 4-14 3-18-4z" fill="#e8f2e8"/>
  <path d="M26 44q8-4 14 0M52 28q7-3 13 1M46 60q8-3 14 0M30 56q5-2 9 0" stroke="#fff" stroke-width="2.4" fill="none" opacity=".8" stroke-linecap="round"/></g>
<circle cx="50" cy="48" r="31" fill="url(#shade)"/>${sign('#cfe3ff')}`

const circuit = () => {
  const tr = 'fill="none" stroke="#f0b429" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"'
  const pad = ([x, y]) => `<circle cx="${x}" cy="${y}" r="1.7" fill="#0b3d2e" stroke="#f0b429" stroke-width=".9"/>`
  const pads = [[18, 22], [12, 36], [14, 64], [22, 80], [82, 22], [88, 36], [86, 64], [78, 80], [22, 14], [40, 18], [60, 18], [78, 14], [22, 86], [40, 82], [60, 82], [78, 86]]
  const pins = [36, 43, 50, 57, 64].map((v) => `<path d="M${v} 30v-3M${v} 70v3M30 ${v}h-3M70 ${v}h3" stroke="#f0b429" stroke-width="1.3" stroke-linecap="round"/>`).join('')
  return `<rect width="100" height="100" fill="#0b4a37"/><rect width="100" height="100" fill="#0e6b4d" opacity=".35"/>
<g ${tr}><path d="M0 22h18l6 6h14M0 36h12l8 8h10M0 64h14l6-6h10M0 80h22l8-8h8M100 22H82l-6 6H62M100 36H88l-8 8H70M100 64H86l-6-6H70M100 80H78l-8-8h-8M22 0v14l8 8v8M40 0v18M60 0v18M78 0v14l-8 8v8M22 100V86l8-8v-8M40 100V82M60 100V82M78 100V86l-8-8v-8"/></g>
${pads.map(pad).join('')}
<rect x="30" y="30" width="40" height="40" rx="3" fill="#1b1f27" stroke="#f0b429" stroke-width="1.2"/><rect x="35" y="35" width="30" height="30" rx="2" fill="#262c38"/>
${pins}
<circle cx="40" cy="40" r="1.6" fill="#7df9c0"/><text x="50" y="52" text-anchor="middle" font-family="monospace" font-weight="700" font-size="5.6" fill="#7df9c0">OPIOW</text>
<path d="M42 58h16M42 61h10" stroke="#7df9c0" stroke-width=".7" opacity=".7"/>${sign('#ffe9a8')}`
}

const lab = () => `<defs><linearGradient id="wall" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e9f7f4"/><stop offset="1" stop-color="#bfe6e0"/></linearGradient>
  <linearGradient id="liq" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7be495"/><stop offset="1" stop-color="#1f9d6b"/></linearGradient>
  <linearGradient id="liq2" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff9ad5"/><stop offset="1" stop-color="#c2338f"/></linearGradient></defs>
<rect width="100" height="100" fill="url(#wall)"/><rect y="74" width="100" height="26" fill="#6b4a33"/><rect y="72" width="100" height="3" fill="#8d6a4d"/>
<path d="M40 20h12v14l16 30c3 6 0 10-6 10H30c-6 0-9-4-6-10l16-30z" fill="#fff" opacity=".7" stroke="#2d5b66" stroke-width="1.4" stroke-linejoin="round"/>
<path d="M30 56c5-3 9 3 14 0s9 3 14 0l6 8c2 4 0 7-5 7H29c-5 0-7-3-5-7z" fill="url(#liq)" stroke="#2d5b66" stroke-width="1" stroke-linejoin="round"/>
<path d="M38 20h16" stroke="#2d5b66" stroke-width="1.8" stroke-linecap="round"/><circle cx="40" cy="62" r="1.6" fill="#fff" opacity=".8"/><circle cx="48" cy="58" r="1.1" fill="#fff" opacity=".8"/><circle cx="53" cy="65" r="1.4" fill="#fff" opacity=".8"/><circle cx="46" cy="44" r="1" fill="#7be495"/><circle cx="48" cy="38" r=".8" fill="#7be495"/>
<g stroke="#2d5b66" stroke-width="1.2" stroke-linejoin="round"><path d="M70 40h14v26c0 3-3 6-7 6s-7-3-7-6z" fill="#fff" opacity=".7"/><path d="M70 54h14v12c0 3-3 6-7 6s-7-3-7-6z" fill="url(#liq2)"/><path d="M12 34h8v34c0 3-2 5-4 5s-4-2-4-5z" fill="#fff" opacity=".7"/><path d="M12 50h8v18c0 3-2 5-4 5s-4-2-4-5z" fill="#4aa3ff"/></g>
${sign('#f3e4d3')}`

const ART = [['universe', 'Universe', universe], ['earth', 'Earth', earth], ['circuit', 'Circuit board', circuit], ['lab', 'Lab', lab]]

// uri is what gets saved as the profile photo
export const ANIMALS = ART.map(([id, name, draw]) => ({
  id, name, uri: `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${draw()}</svg>`)}`,
}))
