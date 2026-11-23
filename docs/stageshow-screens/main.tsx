import { StrictMode, useState, type ComponentType, type CSSProperties } from 'react'
import { createRoot } from 'react-dom/client'
import '../kit/stageshow.css'
import './screens.css'
import './looks.css'
import type { Look } from './shell'
import { AdminDash, Upload, Allocate, Teams, Settings, FinanceDash, FinanceCalc } from './admin'
import { TLDash, Distribute, Manual, BDEToday } from './tl'
import BdeCall from '../examples/bde-call'

type L = { id: string; name: string; desc: string; base: Look; sw: string[]; font: string }
const LOOKS: L[] = [
  { id: 'clean', name: 'Clean Light', desc: 'Warm grays, blue accent, medium corners. The safe default.', base: { theme: 'light', palette: 'accent' }, sw: ['#f6f5f2', '#ffffff', '#2f6fed'], font: 'Inter' },
  { id: 'ocean', name: 'Ocean', desc: 'Cool grays and teal. Calm and clinical, like a health app.', base: { theme: 'light', palette: 'accent' }, sw: ['#eef3f5', '#ffffff', '#0e7c86'], font: 'DM Sans' },
  { id: 'marigold', name: 'Marigold', desc: 'Deep green with a marigold highlight, big soft corners. Warm and friendly.', base: { theme: 'light', palette: 'accent' }, sw: ['#f1efe6', '#fbfaf5', '#1e6b48'], font: 'Figtree' },
  { id: 'sunrise', name: 'Sunrise', desc: 'Warm sand with burnt orange. Energetic, sales-floor feel.', base: { theme: 'light', palette: 'accent' }, sw: ['#f6efe8', '#fffdfb', '#d9480f'], font: 'Outfit' },
  { id: 'soft', name: 'Soft Rounded', desc: 'Pale blue-gray, very round, airy spacing. Friendly for new users.', base: { theme: 'light', palette: 'accent' }, sw: ['#eef2f8', '#ffffff', '#3b82f6'], font: 'Nunito Sans' },
  { id: 'graphite', name: 'Graphite', desc: 'Black ink, no color accent, sharp corners. Serious and dense.', base: { theme: 'light', palette: 'mono' }, sw: ['#efefed', '#ffffff', '#111111'], font: 'IBM Plex Sans' },
  { id: 'contrast', name: 'High Contrast', desc: 'Black lines on white, electric blue. Easiest to read anywhere.', base: { theme: 'light', palette: 'accent' }, sw: ['#ffffff', '#ffffff', '#0040e8'], font: 'Atkinson Hyperlegible' },
  { id: 'midnight', name: 'Midnight', desc: 'Neutral dark with blue. Comfortable in dim rooms.', base: { theme: 'dark', palette: 'accent' }, sw: ['#151617', '#1c1d1f', '#5b8cff'], font: 'Inter' },
  { id: 'slate', name: 'Slate Pro', desc: 'Navy dark with sky blue, tight rows. A power-user control room.', base: { theme: 'dark', palette: 'accent' }, sw: ['#0b1220', '#111a2e', '#38bdf8'], font: 'Manrope' },
  { id: 'forest', name: 'Forest Dark', desc: 'Deep green dark with mint. Distinctive and easy on the eyes.', base: { theme: 'dark', palette: 'accent' }, sw: ['#0d1712', '#13201a', '#4cc38a'], font: 'Plus Jakarta Sans' },
  { id: 'glass', name: 'Glass', desc: 'Frosted windows over soft color. Most modern, least dense.', base: { theme: 'glass', palette: 'accent' }, sw: ['#dfe7ff', '#f7f8ff', '#4f6bff'], font: 'Instrument Sans' },
  { id: 'blueprint', name: 'Blueprint', desc: 'Technical drawing look. For specs and handover, not daily use.', base: { theme: 'blueprint', palette: 'accent' }, sw: ['#0f3c8a', '#164aa3', '#ffffff'], font: 'Space Grotesk' },
]

const FONTS = ['Inter', 'DM Sans', 'Figtree', 'Outfit', 'Nunito Sans', 'IBM Plex Sans', 'Atkinson Hyperlegible', 'Manrope', 'Plus Jakarta Sans', 'Instrument Sans', 'Space Grotesk', 'Source Sans 3', 'Lexend', 'Poppins']

const SCREENS: { group: string; items: { name: string; note: string; C: ComponentType<{ look: Look }> }[] }[] = [
  { group: 'Admin', items: [
    { name: 'Dashboard', note: 'Things waiting on Admin first, then numbers with targets.', C: AdminDash },
    { name: 'Upload leads', note: 'Step 3 of the wizard: duplicates and errors before anything is saved.', C: Upload },
    { name: 'Allocate to teams', note: 'The preview shows each team’s share before you commit.', C: Allocate },
    { name: 'Teams & people', note: 'Deactivating asks what happens to the open leads.', C: Teams },
    { name: 'Settings · lead statuses', note: 'Groups decide the maths; every change is audited.', C: Settings },
    { name: 'Finance dashboard', note: 'Only confirmed payments count in the totals.', C: FinanceDash },
    { name: 'Finance calculators', note: 'Formula shown with the result; history is read-only.', C: FinanceCalc },
  ] },
  { group: 'Team Lead', items: [
    { name: 'Dashboard', note: 'Needs leads and At risk first, then the BDE table with load bars.', C: TLDash },
    { name: 'Distribute · automatic', note: 'Smart preview: how many each BDE gets, and why.', C: Distribute },
    { name: 'Distribute · manual', note: 'Going over a max needs a reason, saved in the audit log.', C: Manual },
  ] },
  { group: 'BDE', items: [
    { name: 'Today (laptop)', note: 'Punched in, then a call queue instead of a dashboard.', C: BDEToday },
    { name: 'Calling (phone) + Team Lead view', note: 'After a conversion: the phone moves on, the Team Lead’s row rolls.', C: BdeCall as unknown as ComponentType<{ look: Look }> },
  ] },
]

function readHash() {
  const [l, f] = decodeURIComponent(location.hash.slice(1)).split('|')
  return { look: LOOKS.find((x) => x.id === l) ?? LOOKS[0], font: FONTS.includes(f) ? f : '' }
}

function App() {
  const init = readHash()
  const [look, setLook] = useState<L>(init.look)
  const [font, setFont] = useState<string>(init.font) // '' = the look's own font
  const used = font || look.font
  const save = (l: L, f: string) => history.replaceState(null, '', '#' + encodeURIComponent(l.id + (f ? '|' + f : '')))
  const style = { ['--g-font' as string]: `"${used}", system-ui, -apple-system, "Segoe UI", sans-serif` } as CSSProperties
  return (
    <div className={`g-page look-${look.id}`} data-dark={look.base.theme !== 'light' || undefined} style={style}>
      <header className="g-head">
        <h1>LeadDesk design samples</h1>
        <p>Every wireframe screen in 12 different looks. Pick a look, then try any font on it. Your choice is in the page address, so you can send it to the team. Sample data only.</p>
        <div className="g-looks" role="radiogroup" aria-label="Look">
          {LOOKS.map((l) => (
            <button key={l.id} type="button" role="radio" aria-checked={l.id === look.id} className="g-look" onClick={() => { setLook(l); save(l, font) }}>
              <span className="g-sw" aria-hidden="true">{l.sw.map((c) => <i key={c} style={{ background: c }} />)}</span>
              <b>{l.name}</b><span>{l.desc}</span>
            </button>
          ))}
        </div>
        <div className="g-fonts">
          <label htmlFor="g-font">Font</label>
          <select id="g-font" value={font} onChange={(e) => { setFont(e.target.value); save(look, e.target.value) }}>
            <option value="">The look’s own ({look.font})</option>
            {FONTS.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
          <div className="g-fontrow" role="radiogroup" aria-label="Quick font">
            {FONTS.map((f) => (
              <button key={f} type="button" role="radio" aria-checked={used === f} className="g-fontchip" style={{ fontFamily: `"${f}", system-ui, sans-serif` }} onClick={() => { setFont(f); save(look, f) }}>{f}</button>
            ))}
          </div>
          <p className="g-now">Showing <b>{look.name}</b> in <b>{used}</b></p>
        </div>
      </header>
      {SCREENS.map((g) => (
        <section key={g.group} className="g-group">
          <h2>{g.group}</h2>
          {g.items.map(({ name, note, C }) => (
            <article key={name} className="g-item">
              <div className="g-item__head"><h3>{name}</h3><p>{note}</p></div>
              <div className="g-frame"><C key={look.id} look={look.base} /></div>
            </article>
          ))}
        </section>
      ))}
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)
