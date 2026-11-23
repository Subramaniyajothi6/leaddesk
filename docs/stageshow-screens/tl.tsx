import { Stage, Bar, Button, Badge, Avatar, Meter, Count, Segmented, Toast, Toggle, Field, Check, Collapse, type Act } from '../kit'
import { AppShell, Kpi, Head, Status, type Look } from './shell'

const W = 980, H = 640
const base = (look: Look) => ({ theme: look.theme, palette: look.palette, ground: look.theme === 'glass' ? ('orbs' as const) : undefined, width: W, height: H, className: 'sc' })

const BDES = [
  { n: 'Arun V', st: 'Late 09:58', open: 50, max: 50, calls: '22 · 64%', fu: '3 · 5', conv: 10.0 },
  { n: 'Kavin T', st: 'Absent', open: 22, max: 60, calls: '—', fu: '4 · 2', conv: 4.2 },
  { n: 'Priya K', st: 'In 09:22', open: 42, max: 50, calls: '18 · 72%', fu: '6 · 0', conv: 11.2 },
  { n: 'Meena R', st: 'In 09:30', open: 10, max: 50, calls: '15 · 53%', fu: '2 · 1', conv: 7.3 },
]
const tone = (o: number, m: number) => (o >= m ? 'danger' : o / m >= 0.8 ? 'warning' : 'accent') as 'danger' | 'warning' | 'accent'

/* ---------------- Team Lead dashboard ---------------- */
type D = { meena: number; pool: number; done: boolean }
const dashScript = async (a: Act<D>) => {
  await a.wait(1000)
  await a.click('give'); a.put({ meena: 30, pool: 120, done: true })
  await a.wait(2600)
}
export function TLDash({ look }: { look: Look }) {
  return (
    <Stage<D> {...base(look)} initial={{ meena: 30, pool: 120, done: true }}>
      {(s) => (
        <AppShell role="tl" active="Dashboard" title="Dashboard" badge={<Badge tone="danger">2</Badge>}>
          <Head title="Good morning, Rahul" sub={`Team A · 4 of 5 punched in`}><Button variant="primary">Distribute leads</Button></Head>
          <div className="sc-grid2">
            <section className="sc-card sc-attn">
              <div className="sc-row-between"><div className="sc-card__title">Needs leads</div><span className="sc-sub">Team pool <b className="sc-num"><Count value={s.pool} /></b></span></div>
              <div className="sc-item"><span><b>Meena R</b> · 2 fresh · <span className="sc-num"><Count value={50 - s.meena} /></span> room</span>{s.done ? <Badge tone="success" dot>Gave 20</Badge> : <Button size="small" variant="primary" data-target="give">Give 20</Button>}</div>
              <div className="sc-item"><span><b>Priya K</b> · 0 fresh · 8 room</span><Button size="small">Give 8</Button></div>
            </section>
            <section className="sc-card sc-attn">
              <div className="sc-card__title">At risk</div>
              <div className="sc-item"><span><b>Arun V</b> · 5 overdue</span><Button size="small">Open</Button></div>
              <div className="sc-item"><span><b>Kavin T</b> absent · 4 due</span><Button size="small">Reassign</Button></div>
            </section>
          </div>
          <div className="sc-kpis">
            <Kpi label="Conversion %" value="9.1%" note="Target 8% met" tone="good" />
            <Kpi label="Calls today" value="71" note="62% connected" />
            <Kpi label="Time to first call" value="18 min" note="Target 30" tone="good" />
            <Kpi label="Overdue" value="8" note="Needs action" tone="bad" />
          </div>
          <section className="sc-card">
            <div className="sc-row-between"><div className="sc-card__title">BDEs</div><Segmented items={['All', 'Needs attention', 'At max']} value={0} /></div>
            <div className="sc-table">
              <div className="sc-tr sc-th sc-tr--bde"><span>BDE</span><span>Load</span><span>Calls · conn.</span><span>Due · overdue</span><span>Conv. %</span></div>
              {BDES.map((b) => {
                const o = b.n === 'Meena R' ? s.meena : b.open
                return (
                  <div key={b.n} className="sc-tr sc-tr--bde" data-hl={(b.n === 'Meena R' && s.done) || undefined}>
                    <span className="sc-who"><Avatar name={b.n} size={26} /><span><b>{b.n}</b><br /><span className="sc-sub">{b.st}</span></span></span>
                    <span className="sc-load"><span className="sc-num"><Count value={o} /> / {b.max}{o >= b.max ? ' · at max' : ''}</span><Meter value={o / b.max} tone={tone(o, b.max)} /></span>
                    <span className="sc-num">{b.calls}</span><span className="sc-num">{b.fu}</span>
                    <span className="sc-num">{b.conv.toFixed(1)}% {b.conv >= 9.1 ? '▲' : '▼'}</span>
                  </div>
                )
              })}
            </div>
          </section>
          <Toast show={s.done} className="sc-toast">Gave 20 leads to Meena R · reason saved</Toast>
        </AppShell>
      )}
    </Stage>
  )
}

/* ---------------- Distribute, automatic (Smart) ---------------- */
type S2 = { m: number; done: boolean }
const PLAN = [[36, 21, 3], [20, 20, 20], [23, 34, 3]] // Smart, Equal, Workload for Priya, Meena, Ravi (60 leads)
const distScript = async (a: Act<S2>) => {
  await a.wait(1000)
  await a.click('m-eq'); a.put({ m: 1 })
  await a.wait(1400)
  await a.click('m-smart'); a.put({ m: 0 })
  await a.wait(1200)
  await a.click('giveall'); a.put({ done: true })
  await a.wait(2200)
}
export function Distribute({ look }: { look: Look }) {
  return (
    <Stage<S2> {...base(look)} initial={{ m: 0, done: false }}>
      {(s) => (
        <AppShell role="tl" active="Team pool" title="Distribute">
          <Head title="Distribute leads" sub="Team A pool · 140 leads waiting"><Segmented items={['Automatic', 'Manual']} value={0} /></Head>
          <section className="sc-card sc-row-between">
            <Field label="How many to give" value="60" className="sc-narrow" />
            <Segmented items={['Smart', 'Equal', 'Workload']} value={s.m} targets={['m-smart', 'm-eq', undefined]} />
            <span className="sc-sub sc-desc">{['Smart: room left 85 + performance 15. Never above a max or the daily 40.', 'Equal: one each in turn, skipping anyone full.', 'Workload: fewest open leads first.'][s.m]}</span>
          </section>
          <section className="sc-card sc-attn">
            <div className="sc-card__title">Preview · 60 leads to 3 BDEs</div>
            <div className="sc-table">
              <div className="sc-tr sc-th sc-tr--dist"><span>BDE</span><span>Open → after</span><span>Today / 40</span><span>Gets</span><span>Why</span></div>
              {[['Priya K', 0, 'Most room · performance 1.0'], ['Meena R', 10, 'Good room · performance 0.4'], ['Ravi S', 30, 'Mostly full already']].map(([n, o, why], i) => {
                const g = PLAN[s.m][i]
                return (
                  <div key={n as string} className="sc-tr sc-tr--dist">
                    <b>{n}</b>
                    <span className="sc-load"><span className="sc-num">{o} → <Count value={(o as number) + g} /> / 50</span><Meter value={((o as number) + g) / 50} tone={tone((o as number) + g, 50)} /></span>
                    <span className="sc-num"><Count value={g} /> / 40</span>
                    <span className="sc-big sc-num">+<Count value={g} /></span>
                    <span className="sc-sub">{s.m === 0 ? why : s.m === 1 ? 'Takes turns' : `Started with ${o} open`}</span>
                  </div>
                )
              })}
            </div>
            <div className="sc-skip"><b>Skipped</b> · Arun V at max 50 / 50 · Kavin T absent · Sanjay P inactive</div>
            <div className="sc-row-between"><span className="sc-toggle"><Toggle on={false} /> Auto-refill when a BDE runs out</span><Button variant="primary" size="large" data-target="giveall">Give 60 leads</Button></div>
          </section>
          <Toast show={s.done} className="sc-toast">Gave 60 leads with Smart · each assignment saved its reason</Toast>
        </AppShell>
      )}
    </Stage>
  )
}

/* ---------------- Distribute, manual ---------------- */
type M = { sel: number; pick: boolean; reason: string; done: boolean }
const LEADS = [['Harish B', 'Referral', 70], ['Lakshmi N', 'Referral', 65], ['Rohit J', 'Website', 60], ['Divya P', 'Website', 55], ['Manoj K', 'Campaign', 50]]
const manualScript = async (a: Act<M>) => {
  await a.wait(800)
  for (let i = 0; i < 3; i++) { await a.click(`lead-${i}`); a.put({ sel: i + 1 }); await a.wait(250) }
  await a.wait(400)
  await a.click('pick-arun'); a.put({ pick: true })
  await a.wait(900)
  await a.click('reason')
  await a.type('reason', 'His own referral contacts', { interval: 45 })
  await a.wait(400)
  await a.click('assign'); a.put({ done: true })
  await a.wait(2200)
}
export function Manual({ look }: { look: Look }) {
  return (
    <Stage<M> {...base(look)} initial={{ sel: 3, pick: true, reason: 'His own referral contacts', done: false }}>
      {(s) => (
        <AppShell role="tl" active="Team pool" title="Distribute">
          <Head title="Distribute leads" sub="Team A pool · 140 leads waiting"><Segmented items={['Automatic', 'Manual']} value={1} /></Head>
          <div className="sc-grid2 sc-grid2--wide">
            <section className="sc-card">
              <div className="sc-row-between"><div className="sc-card__title">Leads in pool</div><span className="sc-sub">{s.sel} selected</span></div>
              <div className="sc-table">
                {LEADS.map(([n, src, sc], i) => (
                  <div key={n as string} className="sc-tr sc-tr--lead" data-target={`lead-${i}`} data-sel={i < s.sel || undefined}>
                    <Check on={i < s.sel} size={18} /><b>{n}</b><span>{src}</span><span className="sc-num">Score {sc}</span>
                  </div>
                ))}
              </div>
            </section>
            <section className="sc-card sc-attn sc-stack">
              <div className="sc-card__title">Assign {s.sel || ''} selected to</div>
              {[['Priya K', 42, 50], ['Meena R', 10, 50], ['Arun V', 50, 50]].map(([n, o, m]) => (
                <div key={n as string} className="sc-pickrow" data-on={(n === 'Arun V' && s.pick) || undefined} data-target={n === 'Arun V' ? 'pick-arun' : undefined}>
                  <span className="sc-radio" /><b>{n}</b><span className="sc-num sc-sub">{o} / {m}{o === m ? ' · at max' : ''}</span>
                </div>
              ))}
              <div className="sc-pickrow" data-off><span className="sc-radio" /><b>Sanjay P</b><span className="sc-sub">Inactive</span></div>
              <Collapse open={s.pick}>
                <div className="sc-warn">
                  <b>Arun will be at 53 / 50, over his max</b>
                  <Field label="Reason (saved in the audit log)" value={s.reason} focused={s.pick && !s.done} box={{ 'data-target': 'reason' } as never} />
                </div>
              </Collapse>
              <Button variant="primary" size="large" data-target="assign">Assign {s.sel} to {s.pick ? 'Arun' : '…'}</Button>
            </section>
          </div>
          <Toast show={s.done} className="sc-toast">Assigned 3 leads to Arun V · over-max reason saved</Toast>
        </AppShell>
      )}
    </Stage>
  )
}

/* ---------------- BDE Today (laptop) ---------------- */
type B = { punched: boolean }
const todayScript = async (a: Act<B>) => {
  await a.wait(900)
  await a.click('punch'); a.put({ punched: true })
  await a.wait(2200)
}
export function BDEToday({ look }: { look: Look }) {
  const Q: [string, string, string, string][] = [['Karthik Raj', 'Interested', 'Overdue · yesterday 16:00', 'over'], ['Anitha S', 'Follow-up', 'Overdue · today 10:00', 'over'], ['Vignesh M', 'Interested', 'Due 14:30 · weekend batch', 'due'], ['Harish B', 'New', 'Fresh · score 70 · Referral', 'fresh']]
  return (
    <Stage<B> {...base(look)} initial={{ punched: true }}>
      {(s) => (
        <AppShell role="bde" active="Today" title="Today">
          <section className="sc-card sc-attn sc-row-between">
            <div><div className="sc-title">Hi Priya</div><div className="sc-sub">{s.punched ? 'Punched in 09:22 · shift ends 18:30' : 'Not punched in yet · shift starts 09:30'}</div></div>
            {s.punched ? <Badge tone="success" dot>Working · 0 h 01 m</Badge> : <Button variant="primary" size="large" data-target="punch">Punch in</Button>}
          </section>
          <div className="sc-kpis sc-kpis--3">
            <Kpi label="Calls today" value="18 / 40" note="45% of target" />
            <Kpi label="Conversions today" value="1 / 2" note="Halfway" />
            <Kpi label="This month" value="11.2%" note="Rank #1 in team" tone="good" />
          </div>
          <section className="sc-card">
            <div className="sc-row-between"><div className="sc-card__title">Next to call</div><Button variant="primary">Start calling</Button></div>
            <div className="sc-table">
              {Q.map(([n, st, note, g]) => (
                <div key={n} className="sc-tr sc-tr--q" data-group={g}><span><b>{n}</b><br /><span className="sc-sub">{note}</span></span><Status s={st} /><Button size="small" variant={g === 'over' ? 'primary' : 'secondary'}>Call</Button></div>
              ))}
            </div>
          </section>
        </AppShell>
      )}
    </Stage>
  )
}
