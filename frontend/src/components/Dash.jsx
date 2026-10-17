import { useEffect, useRef, useState } from 'react'

/* Small chart pieces for the analytics dashboard: all plain SVG, no chart library. */
export const num = (n) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n || 0))

// a number that counts up to its value when it appears or changes
export function CountUp({ value = 0 }) {
  const [shown, setShown] = useState(0)
  const from = useRef(0)
  useEffect(() => {
    const start = from.current, t0 = performance.now(), ms = 700
    let raf
    const tick = (now) => {
      const k = Math.min(1, (now - t0) / ms)
      setShown(Math.round(start + (value - start) * (1 - Math.pow(1 - k, 3))))
      if (k < 1) raf = requestAnimationFrame(tick); else from.current = value
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [value])
  return <>{num(shown)}</>
}

// a smooth line through the points (Catmull-Rom turned into cubic curves)
function smooth(pts) {
  if (pts.length < 2) return pts.length ? `M${pts[0][0]},${pts[0][1]}` : ''
  let d = `M${pts[0][0]},${pts[0][1]}`
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2
    d += ` C${p1[0] + (p2[0] - p0[0]) / 6},${p1[1] + (p2[1] - p0[1]) / 6} ${p2[0] - (p3[0] - p1[0]) / 6},${p2[1] - (p3[1] - p1[1]) / 6} ${p2[0]},${p2[1]}`
  }
  return d
}

/* A tiny trend line for a tile */
export function Spark({ data = [], color = '#9d7dff' }) {
  const w = 120, h = 36, max = Math.max(1, ...data)
  const pts = data.map((v, i) => [data.length < 2 ? 0 : (i / (data.length - 1)) * w, h - 3 - (v / max) * (h - 8)])
  const line = smooth(pts)
  const id = useRef(`sp${Math.random().toString(36).slice(2, 8)}`).current
  return (
    <svg className="dspark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true">
      <defs><linearGradient id={id} x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor={color} stopOpacity=".45" /><stop offset="1" stopColor={color} stopOpacity="0" /></linearGradient></defs>
      {line && <path d={`${line} L${w},${h} L0,${h} Z`} fill={`url(#${id})`} />}
      {line && <path d={line} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" vectorEffect="non-scaling-stroke" />}
    </svg>
  )
}

const label = (iso, unit) => {
  const d = new Date(iso)
  if (unit === 'hour') return d.toLocaleTimeString(undefined, { hour: 'numeric' })
  if (unit === 'month') return d.toLocaleDateString(undefined, { month: 'short' })
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

/* The big chart: views as a filled curve with saves, shares and clicks as lines; hover or touch shows the numbers for that point */
export function TrendChart({ trend, lines }) {
  const [hover, setHover] = useState(-1)
  const box = useRef()
  if (!trend) return null
  const n = trend.labels.length
  const W = 640, H = 220, L = 34, R = 10, T = 12, B = 26
  const all = lines.flatMap((l) => trend.series[l.key] || [])
  const max = Math.max(4, ...all)
  const nice = Math.ceil(max / 4) * 4
  const x = (i) => L + (n < 2 ? 0 : (i / (n - 1)) * (W - L - R))
  const y = (v) => T + (1 - v / nice) * (H - T - B)
  const pts = (k) => (trend.series[k] || []).map((v, i) => [x(i), y(v)])
  const move = (e) => {
    const r = box.current.getBoundingClientRect()
    const px = ((e.touches ? e.touches[0].clientX : e.clientX) - r.left) / r.width * W
    setHover(Math.max(0, Math.min(n - 1, Math.round(((px - L) / (W - L - R)) * (n - 1)))))
  }
  const every = Math.max(1, Math.ceil(n / 7))
  const first = lines[0]
  const fp = pts(first.key), fl = smooth(fp)
  return (
    <div className="dchart" ref={box} onMouseMove={move} onTouchMove={move} onMouseLeave={() => setHover(-1)} onTouchEnd={() => setHover(-1)}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Activity over time">
        <defs><linearGradient id="dfill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor={first.color} stopOpacity=".5" /><stop offset="1" stopColor={first.color} stopOpacity="0" /></linearGradient></defs>
        {[0, 1, 2, 3, 4].map((g) => (
          <g key={g}><line x1={L} x2={W - R} y1={y((nice / 4) * g)} y2={y((nice / 4) * g)} className="dgrid" /><text x={L - 6} y={y((nice / 4) * g) + 4} className="dax" textAnchor="end">{num((nice / 4) * g)}</text></g>
        ))}
        {fl && <path d={`${fl} L${x(n - 1)},${y(0)} L${x(0)},${y(0)} Z`} fill="url(#dfill)" />}
        {lines.slice(1).map((l) => <path key={l.key} d={smooth(pts(l.key))} fill="none" stroke={l.color} strokeWidth="2" strokeLinecap="round" opacity=".9" />)}
        {fl && <path d={fl} fill="none" stroke={first.color} strokeWidth="3" strokeLinecap="round" />}
        {trend.labels.map((iso, i) => i % every === 0 && <text key={iso} x={x(i)} y={H - 6} className="dax" textAnchor="middle">{label(iso, trend.unit)}</text>)}
        {hover >= 0 && <g><line x1={x(hover)} x2={x(hover)} y1={T} y2={H - B} className="dcursor" />{lines.map((l) => <circle key={l.key} cx={x(hover)} cy={y(trend.series[l.key][hover] || 0)} r="4.5" fill={l.color} stroke="var(--card)" strokeWidth="2" />)}</g>}
      </svg>
      {hover >= 0 && (
        <div className="dtip" style={{ left: `${Math.min(76, Math.max(2, (x(hover) / W) * 100 - 12))}%` }}>
          <b>{label(trend.labels[hover], trend.unit)}</b>
          {lines.map((l) => <span key={l.key}><i style={{ background: l.color }} />{l.name} <em>{trend.series[l.key][hover] || 0}</em></span>)}
        </div>
      )}
      <div className="dkey">{lines.map((l) => <span key={l.key}><i style={{ background: l.color }} />{l.name}</span>)}</div>
    </div>
  )
}

/* A ring split into coloured parts, with the total in the middle */
export function Donut({ parts, total, caption }) {
  const R = 52, C = 2 * Math.PI * R
  const sum = parts.reduce((s, p) => s + p.value, 0)
  let acc = 0
  return (
    <div className="ddonut">
      <svg viewBox="0 0 140 140" role="img" aria-label={caption}>
        <circle cx="70" cy="70" r={R} fill="none" strokeWidth="16" className="dring" />
        {sum > 0 && parts.map((p) => {
          const len = (p.value / sum) * C, off = -acc
          acc += len
          return p.value > 0 && <circle key={p.name} cx="70" cy="70" r={R} fill="none" stroke={p.color} strokeWidth="16" strokeDasharray={`${Math.max(0, len - 2)} ${C}`} strokeDashoffset={off} transform="rotate(-90 70 70)" strokeLinecap="butt" />
        })}
        <text x="70" y="68" textAnchor="middle" className="dbig">{num(total)}</text>
        <text x="70" y="86" textAnchor="middle" className="dsmall">{caption}</text>
      </svg>
      <ul>{parts.map((p) => <li key={p.name}><i style={{ background: p.color }} />{p.name}<b>{num(p.value)}</b></li>)}</ul>
    </div>
  )
}

/* A ranked list as bars: the longest is the leader */
export function RankBars({ rows, empty, onOpen }) {
  const max = Math.max(1, ...rows.map((r) => r.value))
  if (!rows.length) return <p className="dempty">{empty}</p>
  return (
    <ol className="drank">
      {rows.map((r, i) => (
        <li key={r.key} onClick={onOpen ? () => onOpen(r) : undefined} style={onOpen ? { cursor: 'pointer' } : undefined}>
          <span className="dpos">{i + 1}</span>
          <div className="dbarwrap">
            <div className="dbarhead">{r.href ? <a className="dlink" href={r.href} target="_blank" rel="noopener noreferrer" title={r.full || r.title}>{r.title}</a> : <b title={r.title}>{r.title}</b>}<span>{num(r.value)}</span></div>
            <div className="dbar"><div style={{ width: `${Math.max(4, (r.value / max) * 100)}%` }} /></div>
            {r.sub && <small>{r.sub}</small>}
          </div>
        </li>
      ))}
    </ol>
  )
}
