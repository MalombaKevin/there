import { useState } from 'react'
import { useApp, useFetch } from '../context'
import { errMsg } from '../api'
import { COUNTRIES, countryName, flagOf } from '../countries'

/* Discover settings: hide what you don't want to see in Discover, by interest, by country or by keyword. */
export default function DiscoverBlocks() {
  const { user, patchMe, toast } = useApp()
  const { data: cats } = useFetch('/categories/')
  const [q, setQ] = useState('')
  const [word, setWord] = useState('')
  const save = (patch) => patchMe(patch).catch((e) => toast(errMsg(e)))

  const blockedCats = user.blocked_categories || []
  const nameOf = (id) => (cats || []).find((c) => c.id === id)?.name || id.replace(/-/g, ' ')
  const term = q.trim().toLowerCase()
  const pickable = (cats || []).filter((c) => !blockedCats.includes(c.id) && (!term || c.name.toLowerCase().includes(term))).slice(0, term ? 30 : 14)

  const blockedCountries = user.blocked_countries || []
  const blockedWords = user.blocked_keywords || []
  const addWord = () => {
    const w = word.trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 40)
    if (!w) return
    if (blockedWords.includes(w)) return setWord('')
    if (blockedWords.length >= 60) return toast('You can block up to 60 keywords.')
    save({ blocked_keywords: [...blockedWords, w] }).then(() => setWord(''))
  }

  return (
    <div className="dblocks">
      <div className="srow">
        <label>Blocked interests</label>
        <div className="chiprow">
          {blockedCats.length === 0 && <small className="shint">None. Content with a blocked interest never shows in Discover.</small>}
          {blockedCats.map((id) => (
            <button key={id} type="button" className="chipx" onClick={() => save({ blocked_categories: blockedCats.filter((x) => x !== id) })} aria-label={`Unblock ${nameOf(id)}`}>{nameOf(id)} <b>✕</b></button>
          ))}
        </div>
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search an interest to block" autoCapitalize="none" spellCheck={false} />
        <div className="chiprow pick">
          {pickable.map((c) => <button key={c.id} type="button" className="chipadd" onClick={() => save({ blocked_categories: [...blockedCats, c.id] })}>+ {c.name}</button>)}
          {cats && !pickable.length && <small className="shint">{term ? 'No interest matches.' : 'Nothing left to block.'}</small>}
        </div>
      </div>

      <div className="srow">
        <label>Blocked countries</label>
        <div className="chiprow">
          {blockedCountries.length === 0 && <small className="shint">None. Hides what people from these countries post. It only works for people who show their country.</small>}
          {blockedCountries.map((c) => (
            <button key={c} type="button" className="chipx" onClick={() => save({ blocked_countries: blockedCountries.filter((x) => x !== c) })} aria-label={`Unblock ${countryName(c)}`}>{flagOf(c)} {countryName(c)} <b>✕</b></button>
          ))}
        </div>
        <select value="" onChange={(e) => e.target.value && save({ blocked_countries: [...blockedCountries, e.target.value] })} aria-label="Block a country">
          <option value="">Block a country…</option>
          {COUNTRIES.filter((c) => !blockedCountries.includes(c.code)).map((c) => <option key={c.code} value={c.code}>{flagOf(c.code)} {c.name}</option>)}
        </select>
      </div>

      <div className="srow">
        <label>Blocked keywords</label>
        <div className="chiprow">
          {blockedWords.length === 0 && <small className="shint">None. Links and boards with these words in their name, description or address are hidden.</small>}
          {blockedWords.map((w) => (
            <button key={w} type="button" className="chipx" onClick={() => save({ blocked_keywords: blockedWords.filter((x) => x !== w) })} aria-label={`Unblock ${w}`}>{w} <b>✕</b></button>
          ))}
        </div>
        <form className="kwform" onSubmit={(e) => { e.preventDefault(); addWord() }}>
          <input value={word} onChange={(e) => setWord(e.target.value)} placeholder="Type a word or phrase" maxLength={40} autoCapitalize="none" spellCheck={false} />
          <button type="submit" className="go" disabled={!word.trim()}>Add</button>
        </form>
      </div>
    </div>
  )
}
