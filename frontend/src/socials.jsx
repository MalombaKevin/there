import {
  siInstagram, siFacebook, siX, siYoutube, siTiktok, siLinkedin, siGithub, siSnapchat, siPinterest, siReddit, siTelegram, siWhatsapp,
  siDiscord, siTwitch, siSpotify, siSoundcloud, siBehance, siDribbble, siMedium, siThreads, siMastodon, siBluesky, siTumblr, siVimeo,
  siPatreon, siSubstack, siFigma, siStackoverflow, siDevdotto, siApplemusic, siLinktree, siSignal, siMessenger, siWechat, siLine,
  siQuora, siFlickr, siKofi, siBuymeacoffee, siEtsy, siGmail, siNotion, siCashapp, siPaypal, siBandcamp, siKick, siSlack,
} from 'simple-icons'
import { fav } from './api'

/* Common social / web icons people can put on a card link. Each is stored as a short key like "instagram". */
export const SOCIALS = [
  siInstagram, siFacebook, siX, siYoutube, siTiktok, siLinkedin, siGithub, siSnapchat, siPinterest, siReddit, siTelegram, siWhatsapp,
  siDiscord, siTwitch, siSpotify, siSoundcloud, siBehance, siDribbble, siMedium, siThreads, siMastodon, siBluesky, siTumblr, siVimeo,
  siPatreon, siSubstack, siFigma, siStackoverflow, siDevdotto, siApplemusic, siLinktree, siSignal, siMessenger, siWechat, siLine,
  siQuora, siFlickr, siKofi, siBuymeacoffee, siEtsy, siGmail, siNotion, siCashapp, siPaypal, siBandcamp, siKick, siSlack,
].map((i) => ({ key: i.slug, name: i.title, hex: i.hex, path: i.path }))

const BY_KEY = Object.fromEntries(SOCIALS.map((s) => [s.key, s]))

// light brand colours (e.g. Snapchat yellow) need a dark glyph to stay readable
const isLight = (hex) => { const n = parseInt(hex, 16); return 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255) > 170 }

/* A link's icon: a brand glyph on its colour, an uploaded picture, or (when none was chosen) the site's own favicon. */
export function LinkIcon({ icon, host, size = 40 }) {
  const box = { width: size, height: size, borderRadius: size * 0.26, flex: 'none', display: 'grid', placeItems: 'center', overflow: 'hidden' }
  if (icon === 'board') {
    // a board shared as a link: a folder on blue
    return (
      <span style={{ ...box, background: '#1d6fe8' }} aria-hidden="true">
        <svg viewBox="0 0 24 24" width={size * 0.56} height={size * 0.56} fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></svg>
      </span>
    )
  }
  const s = BY_KEY[icon]
  if (s) {
    return (
      <span style={{ ...box, background: `#${s.hex}` }} aria-hidden="true">
        <svg viewBox="0 0 24 24" width={size * 0.58} height={size * 0.58} fill={isLight(s.hex) ? '#111' : '#fff'}><path d={s.path} /></svg>
      </span>
    )
  }
  if (icon?.startsWith('data:image/') || /^https?:\/\//.test(icon || '')) return <span style={box}><img src={icon} alt="" referrerPolicy="no-referrer" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /></span>
  return <span style={{ ...box, background: '#fff', border: '1px solid var(--line)' }}><img src={fav(host)} alt="" referrerPolicy="no-referrer" style={{ width: '60%', height: '60%', objectFit: 'contain' }} /></span>
}
