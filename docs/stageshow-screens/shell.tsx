import type { ReactNode } from 'react'
import { Window, Bar, Text, Badge } from '../kit'

export type Look = { theme: 'light' | 'dark' | 'glass' | 'blueprint'; palette: 'accent' | 'mono' }
export type Role = 'admin' | 'tl' | 'bde'

const NAV: Record<Role, string[]> = {
  admin: ['Dashboard', 'Leads', 'Upload', 'Allocation', 'Teams & people', 'Attendance', 'Reports', 'Finance', 'Settings'],
  tl: ['Dashboard', 'Team pool', 'Leads', 'Follow-ups', 'Attendance', 'Reports'],
  bde: ['Today', 'My leads', 'Follow-ups', 'Attendance', 'Performance'],
}
const ROLE: Record<Role, string> = { admin: 'Admin', tl: 'Team Lead · Team A', bde: 'BDE · Priya K' }

/** One app window: a sidebar with the role's menu and the page in the content column. */
export function AppShell({ role, active, title, badge, children, className }: { role: Role; active: string; title: string; badge?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <Window
      title={title}
      className={`sc-window${className ? ` ${className}` : ''}`}
      sidebarWidth={188}
      sidebar={
        <div className="sc-side">
          <div className="sc-brand"><span className="sc-brand__mark" /><Text>LeadDesk</Text></div>
          <div className="sc-role">{ROLE[role]}</div>
          {NAV[role].map((n) => (
            <div key={n} className="sc-nav" data-active={n === active || undefined}>
              <span className="sc-nav__icon" />
              <span className="sc-nav__label">{n}</span>
              {n === active && badge}
            </div>
          ))}
          <div className="sc-side__foot"><Bar w={22} h={22} r={11} tone={2} /><Bar w={64} h={6} tone={2} /></div>
        </div>
      }
    >
      <div className="sc-page">{children}</div>
    </Window>
  )
}

export function Kpi({ label, value, note, tone }: { label: string; value: ReactNode; note?: string; tone?: 'good' | 'bad' }) {
  return (
    <div className="sc-kpi">
      <span className="sc-kpi__label">{label}</span>
      <span className="sc-kpi__value">{value}</span>
      {note && <span className="sc-kpi__note" data-tone={tone}>{note}</span>}
    </div>
  )
}

export function Head({ title, sub, children }: { title: string; sub?: string; children?: ReactNode }) {
  return (
    <div className="sc-head">
      <div>
        <div className="sc-title">{title}</div>
        {sub && <div className="sc-sub">{sub}</div>}
      </div>
      {children && <div className="sc-head__actions">{children}</div>}
    </div>
  )
}

export const Status = ({ s }: { s: string }) => (
  <Badge tone={s === 'Converted' ? 'success' : s === 'Interested' ? 'accent' : s === 'Follow-up' ? 'warning' : s === 'Not interested' ? 'danger' : 'neutral'} dot>{s}</Badge>
)
