import { Stage, Bar, Text, Button, Badge, Avatar, Meter, Count, Roll, Segmented, Tabs, Toast, Toggle, Field, Check, Chart, type Act } from '../kit'
import { AppShell, Kpi, Head, type Look } from './shell'

const W = 980, H = 640
const base = (look: Look) => ({ theme: look.theme, palette: look.palette, ground: look.theme === 'glass' ? ('orbs' as const) : undefined, width: W, height: H, className: 'sc' })

/* ---------------- Admin dashboard (still) ---------------- */
export function AdminDash({ look }: { look: Look }) {
  return (
    <Stage {...base(look)}>
      {() => (
        <AppShell role="admin" active="Dashboard" title="Dashboard" badge={<Badge tone="danger">3</Badge>}>
          <Head title="Good morning" sub="Whole company · November">
            <Button>Export</Button><Button variant="primary">Upload leads</Button>
          </Head>
          <section className="sc-card sc-attn">
            <div className="sc-card__title">Needs your action</div>
            <div className="sc-actions">
              <div className="sc-action"><b>Team B needs leads</b><span>2 BDEs have 0 fresh · company pool 1,180</span><Button variant="primary" size="small">Allocate leads</Button></div>
              <div className="sc-action"><b>Team C has no Team Lead</b><span>Since 14 Nov · you are acting as lead</span><Button size="small">Assign lead</Button></div>
              <div className="sc-action"><b>3 payments to confirm</b><span>Recorded by Team Leads · ₹75,000</span><Button size="small">Review</Button></div>
            </div>
          </section>
          <div className="sc-kpis">
            <Kpi label="Conversion %" value="7.6%" note="Target 8%" tone="bad" />
            <Kpi label="Conversions" value="96" note="+14 this week" tone="good" />
            <Kpi label="Allocated" value="1,300" note="1,180 in pool" />
            <Kpi label="Present today" value="25 / 28" note="3 absent" />
            <Kpi label="Overdue follow-ups" value="37" note="Needs action" tone="bad" />
          </div>
          <div className="sc-grid2">
            <section className="sc-card">
              <div className="sc-card__title">Teams</div>
              <div className="sc-table sc-table--teams">
                <div className="sc-tr sc-th"><span>Team</span><span>Lead</span><span>Conv. %</span><span>Overdue</span></div>
                {[['Team A', 'Rahul S', 9.1, 8], ['Team B', 'Divya M', 6.7, 14], ['Team C', '—', 6.3, 15]].map(([t, l, c, o]) => (
                  <div key={t as string} className="sc-tr"><b>{t}</b><span>{l}</span><span className="sc-convcell"><span className="sc-num">{(c as number).toFixed(1)}%</span><Meter value={(c as number) / 12} tone={(c as number) >= 8 ? 'success' : 'ink'} /></span><span className="sc-num">{o}</span></div>
                ))}
              </div>
            </section>
            <section className="sc-card">
              <div className="sc-card__title">Conversion by source</div>
              {[['Referral', 12.4], ['Website', 8.1], ['Walk-in', 6.9], ['Campaign', 4.2]].map(([s, v]) => (
                <div key={s as string} className="sc-hbar"><span>{s}</span><Meter value={(v as number) / 14} /><span className="sc-num">{v}%</span></div>
              ))}
            </section>
          </div>
        </AppShell>
      )}
    </Stage>
  )
}

/* ---------------- Upload: check results ---------------- */
type U = { tab: number; mode: number; done: boolean }
const uploadScript = async (a: Act<U>) => {
  await a.wait(900)
  await a.click('tab-dup'); a.put({ tab: 1 })
  await a.wait(900)
  await a.click('mode-merge'); a.put({ mode: 1 })
  await a.wait(800)
  await a.click('add'); a.put({ done: true })
  await a.wait(2200)
}
export function Upload({ look }: { look: Look }) {
  return (
    <Stage<U> {...base(look)} initial={{ tab: 1, mode: 1, done: false }}>
      {(s) => (
        <AppShell role="admin" active="Upload" title="Upload leads">
          <Head title="Upload leads" sub="nov-campaign-leads.xlsx · 1,240 rows · source: Campaign · Nov Instagram" />
          <div className="sc-steps"><span data-done>1 · Choose file</span><span data-done>2 · Match columns</span><span data-on>3 · Check and add</span></div>
          <div className="sc-kpis sc-kpis--3">
            <Kpi label="Ready to add" value="1,180" note="Go to company pool" tone="good" />
            <Kpi label="Duplicates" value="45" note="30 in system · 15 in file" />
            <Kpi label="Rows with errors" value="15" note="Download to fix" tone="bad" />
          </div>
          <section className="sc-card">
            <Tabs items={['Ready 1,180', 'Duplicates 45', 'Errors 15']} value={s.tab} targets={[undefined, 'tab-dup', undefined]} />
            <div className="sc-row-between" style={{ marginTop: 12 }}>
              <span className="sc-sub">For all duplicates</span>
              <Segmented items={['Skip, keep existing', 'Merge empty fields']} value={s.mode} targets={[undefined, 'mode-merge']} />
            </div>
            <div className="sc-table">
              <div className="sc-tr sc-th sc-tr--dup"><span>Row</span><span>In file</span><span>Matches</span><span>Existing lead · owner</span></div>
              {[['12', 'Karthik R', 'Phone', 'Priya K · Interested'], ['57', 'Sneha P', 'Email', 'Company pool · New'], ['58', 'Sneha P', 'Row 57', 'Only row 57 kept']].map((r) => (
                <div key={r[0]} className="sc-tr sc-tr--dup"><span className="sc-num">{r[0]}</span><b>{r[1]}</b><span>{r[2]}</span><span>{r[3]}</span></div>
              ))}
            </div>
          </section>
          <div className="sc-row-between"><Button>Back</Button><Button variant="primary" size="large" data-target="add">Add 1,180 leads</Button></div>
          <Toast show={s.done} className="sc-toast">1,180 leads added to the company pool</Toast>
        </AppShell>
      )}
    </Stage>
  )
}

/* ---------------- Allocate to teams ---------------- */
type A = { m: number; done: boolean }
const CAP = [210, 390, 160]
function split(n: number, m: number) {
  if (m === 0) { const b = Math.floor(n / 3), r = n % 3; return [0, 1, 2].map((i) => b + (i < r ? 1 : 0)) }
  const tot = CAP.reduce((x, y) => x + y, 0), raw = CAP.map((c) => (n * c) / tot), fl = raw.map(Math.floor)
  let left = n - fl.reduce((x, y) => x + y, 0)
  raw.map((v, i) => [v - fl[i], i]).sort((x, y) => y[0] - x[0]).forEach(([, i]) => { if (left > 0) { fl[i]++; left-- } })
  return fl
}
const allocScript = async (a: Act<A>) => {
  await a.wait(1000)
  await a.click('m-cap'); a.put({ m: 1 })
  await a.wait(1600)
  await a.click('allocate'); a.put({ done: true })
  await a.wait(2200)
}
export function Allocate({ look }: { look: Look }) {
  return (
    <Stage<A> {...base(look)} initial={{ m: 1, done: false }}>
      {(s) => {
        const g = split(300, s.m)
        return (
          <AppShell role="admin" active="Allocation" title="Allocate to teams">
            <Head title="Allocate leads to teams" sub="Company pool: 1,180 leads · highest score first, then oldest" />
            <div className="sc-grid2 sc-grid2--wide">
              <section className="sc-card sc-stack">
                <Field label="How many to give" value="300" />
                <div className="sc-label">How to split</div>
                <Segmented items={['Equal', 'By free capacity', 'Manual']} value={s.m} targets={[undefined, 'm-cap', undefined]} />
                <div className="sc-label">Teams</div>
                {['Team A · 10 BDEs · room 210', 'Team B · 9 BDEs · room 390', 'Team C · 9 BDEs · room 160'].map((t) => (
                  <div key={t} className="sc-checkrow"><Check on size={18} /><span>{t}</span></div>
                ))}
              </section>
              <section className="sc-card sc-attn">
                <div className="sc-card__title">Preview · 300 leads</div>
                <div className="sc-table">
                  <div className="sc-tr sc-th sc-tr--alloc"><span>Team</span><span>In pool now</span><span>Will receive</span><span>Pool after</span></div>
                  {['Team A', 'Team B', 'Team C'].map((t, i) => (
                    <div key={t} className="sc-tr sc-tr--alloc"><b>{t}</b><span className="sc-num">{[40, 0, 12][i]}</span><span className="sc-big sc-num"><Count value={g[i]} /></span><span className="sc-num"><Count value={g[i] + [40, 0, 12][i]} /></span></div>
                  ))}
                </div>
                <p className="sc-sub">{s.m === 0 ? 'Equal: 100 each. Any extra rotates between teams next time.' : 'By free capacity: more to teams with more room under BDE maxes.'}</p>
                <div className="sc-row-between"><span className="sc-toggle"><Toggle on={false} /> Also give to BDEs now</span><Button variant="primary" size="large" data-target="allocate">Allocate 300 leads</Button></div>
              </section>
            </div>
            <Toast show={s.done} className="sc-toast">300 leads allocated · run saved to history</Toast>
          </AppShell>
        )
      }}
    </Stage>
  )
}

/* ---------------- Teams & people with deactivate dialog ---------------- */
type T = { open: boolean; opt: number }
const teamsScript = async (a: Act<T>) => {
  await a.wait(900)
  await a.click('deact'); a.put({ open: true })
  await a.wait(900)
  await a.click('opt-keep'); a.put({ opt: 1 })
  await a.wait(1800)
}
export function Teams({ look }: { look: Look }) {
  return (
    <Stage<T> {...base(look)} initial={{ open: true, opt: 0 }}>
      {(s) => (
        <AppShell role="admin" active="Teams & people" title="Teams & people">
          <Head title="Teams & people"><Button>New team</Button><Button variant="primary">Add person</Button></Head>
          <div className="sc-split">
            <section className="sc-card sc-teamlist">
              {[['Team A', 'Rahul S · 10 BDEs', true], ['Team B', 'Divya M · 9 BDEs', false], ['Team C', 'No Team Lead · 9 BDEs', false]].map(([t, d, on]) => (
                <div key={t as string} className="sc-team" data-on={on || undefined}><b>{t}</b><span>{d}</span></div>
              ))}
            </section>
            <section className="sc-card">
              <div className="sc-row-between"><div className="sc-card__title">Team A · Rahul S</div><Badge>Default max 50</Badge></div>
              <div className="sc-table">
                <div className="sc-tr sc-th sc-tr--ppl"><span>BDE</span><span>Today</span><span>Load</span><span /></div>
                {[['Priya K', 'In 09:22', 42, 50], ['Arun V', 'Late 09:58', 50, 50], ['Kavin T', 'Absent', 22, 60]].map(([n, t, o, m]) => (
                  <div key={n as string} className="sc-tr sc-tr--ppl">
                    <span className="sc-who"><Avatar name={n as string} size={26} /><b>{n}</b></span><span>{t}</span>
                    <span className="sc-load"><span className="sc-num">{o} / {m}</span><Meter value={(o as number) / (m as number)} tone={(o as number) >= (m as number) ? 'danger' : 'accent'} /></span>
                    {n === 'Kavin T' ? <Button size="small" data-target="deact">Deactivate</Button> : <Button size="small" variant="ghost">Move</Button>}
                  </div>
                ))}
              </div>
            </section>
          </div>
          <div className="sc-scrim" data-show={s.open || undefined} />
          <section className="sc-dialog" data-show={s.open || undefined}>
            <div className="sc-card__title">Deactivate Kavin T?</div>
            <p className="sc-sub">Kavin has 22 open leads and 4 follow-ups scheduled.</p>
            <div className="sc-label">What happens to the open leads?</div>
            <div className={`sc-opt`} data-on={s.opt === 0 || undefined}><span className="sc-radio" />Return to Team A pool now, follow-ups go with them</div>
            <div className={`sc-opt`} data-on={s.opt === 1 || undefined} data-target="opt-keep"><span className="sc-radio" />Keep with Kavin, temporary leave</div>
            <div className="sc-row-between"><Badge tone="warning">Reason required</Badge><span className="sc-gap8"><Button>Cancel</Button><Button variant="danger">Deactivate</Button></span></div>
          </section>
        </AppShell>
      )}
    </Stage>
  )
}

/* ---------------- Settings: statuses (still) ---------------- */
export function Settings({ look }: { look: Look }) {
  const rows: [string, string, boolean, boolean][] = [['New', 'Open', false, false], ['Contacted', 'Open', true, false], ['Interested', 'Open', true, false], ['Follow-up', 'Open', true, true], ['Not reachable', 'Open', false, false], ['Converted', 'Won', true, false], ['Not interested', 'Lost', true, false], ['Do not call', 'Excluded', false, false]]
  return (
    <Stage {...base(look)}>
      {() => (
        <AppShell role="admin" active="Settings" title="Settings">
          <Head title="Lead statuses" sub="Groups decide the maths: Won = conversion, Excluded = left out of conversion %"><Button>Add status</Button></Head>
          <div className="sc-split">
            <section className="sc-card sc-teamlist">
              {['Company & labels', 'Allocation', 'Lead statuses', 'Attendance', 'Targets', 'Finance'].map((t) => <div key={t} className="sc-team" data-on={t === 'Lead statuses' || undefined}><b>{t}</b></div>)}
            </section>
            <section className="sc-card">
              <div className="sc-table">
                <div className="sc-tr sc-th sc-tr--st"><span>Status</span><span>Group</span><span>Counts as contact</span><span>Needs follow-up</span></div>
                {rows.map(([n, g, c, f]) => (
                  <div key={n} className="sc-tr sc-tr--st"><span className="sc-grip">⋮⋮</span><b>{n}</b><span><Badge tone={g === 'Won' ? 'success' : g === 'Lost' ? 'danger' : g === 'Excluded' ? 'warning' : 'neutral'}>{g}</Badge></span><span><Toggle on={c} /></span><span><Toggle on={f} /></span></div>
                ))}
              </div>
              <div className="sc-row-between"><span className="sc-sub">Last changed by Admin · 12 Nov, 16:05</span><Button variant="primary">Save changes</Button></div>
            </section>
          </div>
        </AppShell>
      )}
    </Stage>
  )
}

/* ---------------- Finance dashboard ---------------- */
type F = { confirmed: boolean }
const finScript = async (a: Act<F>) => {
  await a.wait(1000)
  await a.click('confirm'); a.put({ confirmed: true })
  await a.wait(2400)
}
const rupee = (n: number) => '₹' + n.toLocaleString('en-IN')
export function FinanceDash({ look }: { look: Look }) {
  return (
    <Stage<F> {...base(look)} initial={{ confirmed: true }}>
      {(s) => {
        const rev = 460000 + (s.confirmed ? 25000 : 0)
        return (
          <AppShell role="admin" active="Finance" title="Finance">
            <Head title="Finance" sub="Only confirmed payments count · company share 30%"><Button>Add investment</Button><Button variant="primary">Record payment</Button></Head>
            <div className="sc-kpis">
              <Kpi label="Confirmed revenue" value={<>₹<Count value={rev} /></>} />
              <Kpi label="Company share" value={<>₹<Count value={Math.round(rev * 0.3)} /></>} />
              <Kpi label="Remaining share" value={<>₹<Count value={rev - Math.round(rev * 0.3)} /></>} />
              <Kpi label="Investment" value="₹1,50,000" />
              <Kpi label="Profit" value={<>₹<Count value={rev - 150000} /></>} tone="good" note="Revenue − investment" />
            </div>
            <div className="sc-grid2">
              <section className="sc-card sc-attn">
                <div className="sc-card__title">Payments to confirm</div>
                <div className="sc-table">
                  {[['Karthik Raj', 'UPI · Rahul S', 25000], ['Anitha S', 'Cash · Divya M', 20000], ['Vignesh M', 'Card · Rahul S', 30000]].map(([n, v, amt], i) => (
                    <div key={n as string} className="sc-tr sc-tr--pay"><span><b>{n}</b><br /><span className="sc-sub">{v}</span></span><span className="sc-num">{rupee(amt as number)}</span>
                      {i === 0 && s.confirmed ? <Badge tone="success" dot>Confirmed</Badge> : <Button size="small" variant={i === 0 ? 'primary' : 'secondary'} data-target={i === 0 ? 'confirm' : undefined}>Confirm</Button>}
                    </div>
                  ))}
                </div>
              </section>
              <section className="sc-card">
                <div className="sc-card__title">Revenue by month</div>
                <Chart data={[210, 260, 240, 320, 380, rev / 1000]} kind="bars" width={300} height={130} />
                <p className="sc-sub">Converted, no payment yet: 7 leads · oldest 9 Nov</p>
              </section>
            </div>
          </AppShell>
        )
      }}
    </Stage>
  )
}

/* ---------------- Finance calculator ---------------- */
type C = { rev: string; tab: number }
const calcScript = async (a: Act<C>) => {
  await a.wait(800)
  await a.click('tab-profit'); a.put({ tab: 1 })
  await a.wait(600)
  await a.click('rev'); a.put({ rev: '' })
  await a.type('rev', '50000', { interval: 90 })
  await a.wait(2000)
}
export function FinanceCalc({ look }: { look: Look }) {
  return (
    <Stage<C> {...base(look)} initial={{ rev: '50000', tab: 1 }}>
      {(s) => {
        const rev = Number(s.rev || 0), inv = 20000, base2 = s.tab ? Math.max(0, rev - inv) : rev, share = Math.round(base2 * 0.3)
        return (
          <AppShell role="admin" active="Finance" title="Calculators">
            <Head title="Calculators" sub="Every saved calculation goes to history and cannot be edited" />
            <section className="sc-card">
              <Tabs items={['Revenue share', 'Profit share', 'Percent of', 'Discount', 'Growth']} value={s.tab} targets={[undefined, 'tab-profit']} />
              <div className="sc-grid2" style={{ marginTop: 16 }}>
                <div className="sc-stack">
                  {s.tab === 1 && <Field label="Total investment (₹)" value="20000" />}
                  <Field label="Total revenue (₹)" value={s.rev} focused={!!s.rev && s.rev !== '42000'} data-target="rev" box={{ 'data-target': 'rev' } as never} />
                  <Field label="Company share %" value="30" />
                </div>
                <div className="sc-result">
                  {s.tab === 1 && <div className="sc-line"><span>Profit = revenue − investment</span><b className="sc-num">₹<Count value={base2} /></b></div>}
                  <div className="sc-line"><span>Company share 30%</span><b className="sc-num">₹<Count value={share} /></b></div>
                  <div className="sc-line"><span>Remaining 70%</span><b className="sc-num">₹<Count value={base2 - share} /></b></div>
                  <Meter value={0.3} />
                  <Button variant="primary">Save to history</Button>
                </div>
              </div>
            </section>
          </AppShell>
        )
      }}
    </Stage>
  )
}
