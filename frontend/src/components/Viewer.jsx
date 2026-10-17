import { useEffect, useRef, useState } from 'react'
import { useApp } from '../context'
import { api, embedFor, fav, thum, videoFileFor } from '../api'
import { clipWords } from '../lib'

const addParam = (src, kv) => `${src}${src.includes('?') ? '&' : '?'}${kv}`
const withAutoplay = (src) => (/youtube|vimeo|dailymotion|streamable|loom|twitch/.test(src) ? addParam(src, 'autoplay=1') : src)
// YouTube / Vimeo tell the page when a video ends, so the carousel can move on by itself
const withApi = (src) => (/youtube\.com\/embed/.test(src) ? addParam(src, 'enablejsapi=1') : /player\.vimeo\.com/.test(src) ? addParam(src, 'api=1') : src)

/* OPIOW viewer: preview a link (videos play inline) before opening it in the browser or app.
   A board made only of videos opens as a carousel: next / previous, autoplay, full mode and repeat. */
export default function Viewer() {
  const { viewer, setViewer, user } = useApp()
  const [tries, setTries] = useState(0)
  const playlist = viewer?.playlist || null
  const [idx, setIdx] = useState(0)
  const [auto, setAuto] = useState(true)
  const [repeat, setRepeat] = useState(false)
  const [full, setFull] = useState(false)
  const [replay, setReplay] = useState(0)   // bumped to start a single video again
  const [hideCtl, setHideCtl] = useState(false) // full mode: a tap on the screen hides / shows the controls
  const box = useRef()
  const frame = useRef()
  const link = playlist ? playlist[idx] || playlist[0] : viewer

  useEffect(() => { setTries(0) }, [link?.url])
  useEffect(() => { if (playlist) setIdx(Math.max(0, playlist.findIndex((l) => l.url === viewer.url))) }, [viewer]) // eslint-disable-line
  useEffect(() => { if (user && typeof link?.id === 'number') api.post('/events/', { kind: 'view', link_id: link.id }).catch(() => {}) }, [link?.id])
  useEffect(() => {
    const k = (e) => e.key === 'Escape' && !document.fullscreenElement && setViewer(null)
    addEventListener('keydown', k)
    return () => removeEventListener('keydown', k)
  }, [setViewer])
  useEffect(() => {
    const f = () => { setFull(document.fullscreenElement === box.current); setHideCtl(false) }
    document.addEventListener('fullscreenchange', f)
    return () => document.removeEventListener('fullscreenchange', f)
  }, [])
  useEffect(() => { if (!viewer && document.fullscreenElement) document.exitFullscreen?.() }, [viewer])

  const n = playlist?.length || 0
  const go = (d) => setIdx((i) => (i + d + n) % n)
  // a video finished: move on if autoplay is on (after the last one, only when repeat is on)
  const ended = () => {
    if (!playlist) return
    if (n === 1) { if (repeat) setReplay((r) => r + 1) }   // one video: repeat plays it again
    else if (auto && (idx < n - 1 || repeat)) go(1)
  }
  const endedRef = useRef(ended)
  endedRef.current = ended
  useEffect(() => {
    if (!playlist) return
    const onMsg = (e) => {
      if (!frame.current || e.source !== frame.current.contentWindow) return
      let d = e.data
      if (typeof d === 'string') { try { d = JSON.parse(d) } catch { return } }
      if ((d?.event === 'onStateChange' && d.info === 0) || d?.event === 'finish') endedRef.current()
    }
    addEventListener('message', onMsg)
    return () => removeEventListener('message', onMsg)
  }, [playlist])
  const hello = () => { // ask YouTube / Vimeo to report progress
    const w = frame.current?.contentWindow
    const src = frame.current?.src || ''
    if (!w) return
    if (/youtube/.test(src)) w.postMessage(JSON.stringify({ event: 'listening', id: 1 }), '*')
    if (/vimeo/.test(src)) w.postMessage(JSON.stringify({ method: 'addEventListener', value: 'finish' }), '*')
  }
  const toggleFull = () => { if (document.fullscreenElement) document.exitFullscreen(); else box.current?.requestFullscreen?.().catch(() => {}) }

  if (!viewer) return null
  const emb0 = embedFor(link.url)
  const emb = !emb0 ? '' : playlist ? withApi(auto || idx > 0 ? withAutoplay(emb0) : emb0) : withAutoplay(emb0)   // opening a video plays it
  const file = videoFileFor(link.url)
  const chain = [link.image, thum(link.url), `https://s.wordpress.com/mshots/v1/${encodeURIComponent(link.url)}?w=900`].filter(Boolean)
  const isVideo = !!(emb || file)
  return (
    <div className="modal on col" id="pvModal">
      <div className="pvtop">
        <button className="pvback" onClick={() => setViewer(null)} aria-label="Close viewer">←</button>
        <div className="pvttl"><b>{n > 1 ? `Video ${idx + 1} of ${n}` : 'OPIOW viewer'}</b><span>{link.host}</span></div>
        {!isVideo && <a className="pvopen" href={link.url} target="_blank" rel="noopener noreferrer">Open ↗</a>}
      </div>
      <div className="pvbody">
        <div className={`pvcar ${playlist ? 'on' : ''}`} ref={box} onClick={() => full && setHideCtl((h) => !h)}>
          <div className={`pvmedia ${!emb && !file && tries >= chain.length ? 'nofoto' : ''}`}>
            {file ? <video key={`${link.url}-${replay}`} src={file} poster={link.image || undefined} controls playsInline autoPlay={!playlist || auto} preload="metadata" onEnded={ended}
                style={{ width: '100%', height: '100%', background: '#000' }} />
              : emb ? <iframe key={`${emb}-${replay}`} ref={frame} title="player" src={emb} onLoad={hello} allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen />
              : tries < chain.length ? <img alt="" src={chain[tries]} referrerPolicy="no-referrer" onError={() => setTries((t) => t + 1)} />
              : <div className="pvfall"><img alt="" src={fav(link.host)} /><b>{link.host}</b></div>}
          </div>
          {playlist && full && !file && (<><div className="pvedge l" /><div className="pvedge r" /></>)}   {/* a video inside an iframe swallows taps, so the screen edges catch them */}
          {playlist && (
            <div className={`pvctl ${full && hideCtl ? 'hide' : ''}`} onClick={(e) => e.stopPropagation()}>
              <button onClick={() => go(-1)} disabled={n < 2} aria-label="Previous video">⏮ Prev</button>
              <span className="pvpos">{idx + 1} / {n}</span>
              <button onClick={() => go(1)} disabled={n < 2} aria-label="Next video">Next ⏭</button>
              <button className={auto ? 'on' : ''} aria-pressed={auto} onClick={() => setAuto(!auto)} title="Play the next video when one ends" disabled={n < 2}>Autoplay</button>
              <button className={repeat ? 'on' : ''} aria-pressed={repeat} onClick={() => setRepeat(!repeat)} title={n > 1 ? 'Start again from the first video after the last' : 'Play this video again when it ends'}>Repeat</button>
              <button onClick={toggleFull}>{full ? 'Exit full' : 'Full mode'}</button>
            </div>
          )}
        </div>
        <div className="pvinfo">
          <div className="pvrow"><img alt="" src={link.logo || fav(link.host)} /><div style={{ minWidth: 0 }}><div className="pvtitle" title={link.title}>{clipWords(link.title, 10)}</div><div className="pvhost">{link.host}</div></div></div>
          <p className="pvdesc">{clipWords(link.description, 12)}</p>
          <div className="pvbtns">
            {isVideo
              ? <button className="ghost primary" onClick={toggleFull}>{full ? 'Exit full mode' : '▶ Play in full mode'}</button>
              : <a className="ghost primary" href={link.url} target="_blank" rel="noopener noreferrer">Open in browser / app</a>}
          </div>
          <p className="hint">{isVideo ? <>Playing here in OPIOW. <a href={link.url} target="_blank" rel="noopener noreferrer">Open the original site</a></> : 'This is a preview. Use the button to open the real site.'}</p>
        </div>
      </div>
    </div>
  )
}
