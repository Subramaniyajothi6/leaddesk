import { Stage, Window, Phone, Bar, Text, Button, Badge, Avatar, Meter, Count, Roll, Swap, type Act } from '../../kit'
import './bde-call.css'

// "One call, seen by everyone": a device pair. The Team Lead's dashboard is
// pinned top-left and runs off the bottom; the BDE's phone straddles its right
// edge over the margin, so Priya's row and the Needs-leads card stay clear.
// Story: the BDE calls, ends the call, marks Converted and saves; the Team
// Lead's row for Priya rolls her conversions; the Team Lead then gives Priya
// 20 leads and her load bar fills. Plays once; the payoff holds.
//
// Real words: Team A, Needs leads, Priya K, Give 20, load, Conversions,
// Karthik Raj, Interested, Call, the timer, How did it go?, Converted, Save & next.

type Phase = 'lead' | 'call' | 'sheet' | 'saved'
type S = { phase: Phase; t: number; pick: string | null; conv: number; open: number; fresh: number; lead: number }

const START: S = { phase: 'lead', t: 0, pick: null, conv: 14, open: 22, fresh: 0, lead: 0 }
const LEADS = [
  { name: 'Karthik Raj', tel: '+91 98XXX XX210', status: 'Interested', note: 'Follow-up due · attempt 2' },
  { name: 'Anitha S', tel: '+91 90XXX XX118', status: 'Follow-up', note: 'Due today 10:00' },
]
const MAX = 50
const mmss = (t: number) => `0:${String(t).padStart(2, '0')}`

const script = async (a: Act<S>) => {
  await a.wait(900)
  a.mark('call')
  await a.click('call')
  a.put({ phase: 'call' })
  for (let i = 0; i < 3; i++) {
    await a.wait(800)
    a.put((s) => ({ t: s.t + 1 }))
  }
  a.mark('end')
  await a.click('end')
  a.put({ phase: 'sheet' })
  await a.wait(700)
  await a.click('pick-converted')
  a.put({ pick: 'Converted' })
  await a.wait(500)
  a.mark('save')
  await a.click('save')
  a.put({ phase: 'saved', lead: 1, t: 0 })
  await a.wait(450)
  a.put((s) => ({ conv: s.conv + 1 }))
  await a.wait(1100)
  if (a.rect('give')) {
    a.mark('give')
    await a.click('give')
    a.put((s) => ({ open: s.open + 20, fresh: s.fresh + 20 }))
    await a.wait(1600)
  }
}

export default function BdeCall({ look }: { look?: { theme: 'light' | 'dark' | 'glass' | 'blueprint'; palette: 'accent' | 'mono' } } = {}) {
  return (
    <Stage<S>
      width={980}
      height={520}
      compact={{ below: 720, width: 358, height: 560 }}
      initial={look ? { phase: 'saved', t: 0, pick: 'Converted', conv: 15, open: 42, fresh: 20, lead: 1 } : START}
      poster={{ phase: 'saved', t: 0, pick: 'Converted', conv: 15, open: 42, fresh: 20, lead: 1 }}
      script={look ? undefined : script}
      play="once"
      theme={look?.theme}
      palette={look?.palette}
      ground={look?.theme === 'glass' ? 'orbs' : undefined}
      accent={look?.palette === 'mono' ? undefined : '#2F5BEA'}
      cursor={look ? undefined : { at: { wide: { x: 900, y: 470 }, compact: { x: 300, y: 520 } }, style: 'arrow', ripple: true }}
      className="bc"
    >
      {(s, _rect, layout) => {
        const lead = LEADS[s.lead]
        const fill = s.open / MAX
        return (
          <>
            {layout === 'wide' && (
              <Window title="Team A" className="bc-window" sidebarWidth={176} sidebar={
                <div className="bc-side">
                  <span className="bc-brand"><span className="bc-brand__mark" />Leads</span>
                  {[52, 64, 44, 58, 40].map((w, i) => (
                    <div key={i} className="bc-nav" data-active={i === 0 || undefined}>
                      <Bar w={12} h={12} r={3} tone={i === 0 ? 4 : 2} />
                      <Bar w={w} h={6} tone={i === 0 ? 4 : 2} />
                    </div>
                  ))}
                </div>
              }>
                <div className="bc-main">
                  <section className="bc-need">
                    <div className="bc-need__head">
                      <Text className="bc-h">Needs leads</Text>
                      <Bar w={56} h={6} tone={2} />
                    </div>
                    <div className="bc-need__row">
                      <Avatar name="Priya K" size={28} tone="accent" />
                      <div className="bc-need__who">
                        <Text className="bc-name">Priya K</Text>
                        <span className="bc-sub"><span className="bc-fresh"><Count value={s.fresh} /></span> fresh</span>
                      </div>
                      <Button variant="primary" size="large" data-target="give" data-cursor="pointer">Give 20</Button>
                    </div>
                    <div className="bc-need__row bc-need__row--filler">
                      <Avatar size={28} plain />
                      <div className="bc-need__who" style={{ gap: 9 }}><Bar w={70} h={7} tone={3} /><Bar w={44} h={5} tone={2} /></div>
                      <Bar w={64} h={28} r={7} tone={1} />
                    </div>
                  </section>

                  <section className="bc-table">
                    <div className="bc-tr bc-th">
                      <Bar w={34} h={5} tone={2} /><Text className="bc-col">Load</Text><Text className="bc-col">Conversions</Text>
                    </div>
                    <div className="bc-tr bc-focus">
                      <span className="bc-who"><Avatar name="Priya K" size={26} tone="accent" /><Text className="bc-name">Priya K</Text></span>
                      <span className="bc-load">
                        <span className="bc-load__num"><Count value={s.open} />&thinsp;/&thinsp;{MAX}</span>
                        <Meter value={fill} className="bc-meter" tone={fill >= 0.8 ? 'warning' : 'accent'} />
                      </span>
                      <span className="bc-conv"><Count value={s.conv} /></span>
                    </div>
                    {[78, 62, 70].map((w, i) => (
                      <div key={i} className="bc-tr">
                        <span className="bc-who"><Avatar size={26} plain /><Bar w={w} h={7} tone={3} /></span>
                        <span className="bc-load"><Bar w={40} h={6} tone={2} /><span className="bc-track"><span style={{ width: `${[64, 30, 82][i]}%` }} /></span></span>
                        <Bar w={22} h={7} tone={3} />
                      </div>
                    ))}
                  </section>
                </div>
              </Window>
            )}

            <Phone width={layout === 'compact' ? 326 : 340} className="bc-phone">
              <div className="bc-app">
                <header className="bc-app__top">
                  <Bar w={84} h={7} tone={3} />
                  <Badge tone="success" dot>Punched in</Badge>
                </header>

                <div className="bc-lead">
                  <Swap id={s.lead}>
                    <div className="bc-lead__in">
                      <div className="bc-lead__row">
                        <span className="bc-lead__name">{lead.name}</span>
                        <Badge tone="accent">{lead.status}</Badge>
                      </div>
                      <span className="bc-lead__tel">{lead.tel}</span>
                    </div>
                  </Swap>
                  <Bar w={150} h={6} tone={2} />
                </div>

                <div className="bc-callzone">
                  <div className="bc-calls" data-hide={s.phase === 'call' || undefined}>
                    <Button variant="primary" size="large" className="bc-big" data-target="call" data-cursor="pointer">Call</Button>
                    <Button size="large" className="bc-big">WhatsApp</Button>
                  </div>
                  <div className="bc-oncall" data-show={s.phase === 'call' || undefined}>
                    <span className="bc-oncall__label">On call</span>
                    <span className="bc-oncall__t"><Roll>{mmss(s.t)}</Roll></span>
                    <Button variant="danger" size="large" className="bc-big" data-target="end" data-cursor="pointer">End call</Button>
                  </div>
                </div>

                <div className="bc-queue">
                  {[120, 96, 132].map((w, i) => (
                    <div key={i} className="bc-queue__row"><Bar w={w} h={7} tone={3} /><Bar w={52} h={16} r={8} tone={1} /></div>
                  ))}
                </div>

                <div className="bc-scrim" data-show={s.phase === 'sheet' || undefined} />
                <section className="bc-sheet" data-show={s.phase === 'sheet' || undefined}>
                  <span className="bc-grab" />
                  <Text className="bc-sheet__h">How did it go?</Text>
                  <div className="bc-picks">
                    {['Follow-up', 'Converted'].map((p) => (
                      <span key={p} className="bc-pick" data-on={s.pick === p || undefined} data-target={`pick-${p.toLowerCase()}`} data-cursor="pointer">{p}</span>
                    ))}
                    <span className="bc-pick bc-pick--filler"><Bar w={64} h={6} tone={2} /></span>
                  </div>
                  <Button variant="primary" size="large" className="bc-save" data-target="save" data-cursor="pointer">Save &amp; next</Button>
                </section>
              </div>
            </Phone>
          </>
        )
      }}
    </Stage>
  )
}
