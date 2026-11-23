import type { IconName } from './Icon'

export interface NavItem { to: string; label: string; icon: IconName; built?: boolean }
export interface NavGroup { title?: string; items: NavItem[] }

/** Menus per role, as in the approved screen map. `built: false` pages show what is coming next. */
export const NAV: Record<'ADMIN' | 'TEAM_LEAD' | 'BDE', NavGroup[]> = {
  ADMIN: [
    { items: [{ to: '/', label: 'Dashboard', icon: 'home', built: true }, { to: '/leads', label: 'Leads', icon: 'leads', built: true }] },
    { title: 'Leads in', items: [{ to: '/upload', label: 'Upload', icon: 'upload', built: true }, { to: '/allocation', label: 'Allocation', icon: 'split', built: true }] },
    { title: 'People', items: [{ to: '/teams', label: 'Teams & people', icon: 'team', built: true }, { to: '/attendance', label: 'Attendance', icon: 'clock', built: true }, { to: '/follow-ups', label: 'Follow-ups', icon: 'calendar', built: true }] },
    { title: 'Results', items: [{ to: '/reports', label: 'Reports', icon: 'chart', built: true }, { to: '/leaderboard', label: 'Leaderboard', icon: 'trophy', built: true }, { to: '/finance', label: 'Finance', icon: 'rupee', built: true }] },
    { title: 'Admin', items: [{ to: '/settings', label: 'Settings', icon: 'cog', built: true }, { to: '/audit', label: 'Audit log', icon: 'log', built: true }] },
  ],
  TEAM_LEAD: [
    { items: [{ to: '/', label: 'Dashboard', icon: 'home', built: true }, { to: '/distribute', label: 'Team pool', icon: 'split', built: true }, { to: '/leads', label: 'Leads', icon: 'leads', built: true }] },
    { title: 'Team', items: [{ to: '/follow-ups', label: 'Follow-ups', icon: 'calendar', built: true }, { to: '/attendance', label: 'Attendance', icon: 'clock', built: true }, { to: '/payments', label: 'Payments', icon: 'rupee', built: true }] },
    { title: 'Results', items: [{ to: '/reports', label: 'Reports', icon: 'chart', built: true }, { to: '/leaderboard', label: 'Leaderboard', icon: 'trophy', built: true }] },
  ],
  BDE: [
    { items: [{ to: '/', label: 'Today', icon: 'home', built: true }, { to: '/leads', label: 'My leads', icon: 'leads', built: true }, { to: '/follow-ups', label: 'Follow-ups', icon: 'calendar', built: true }] },
    { title: 'Me', items: [{ to: '/attendance', label: 'Attendance', icon: 'clock', built: true }, { to: '/performance', label: 'My performance', icon: 'chart', built: true }, { to: '/leaderboard', label: 'Leaderboard', icon: 'trophy', built: true }] },
  ],
}

export const allItems = (role: keyof typeof NAV) => NAV[role].flatMap((g) => g.items)
