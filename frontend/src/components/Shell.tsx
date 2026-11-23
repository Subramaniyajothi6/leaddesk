import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import clsx from 'clsx'
import { useAuth, roleLabel } from '../lib/auth'
import { NAV } from './nav'
import { Icon } from './Icon'
import { Avatar } from './ui'
import { Bell } from './Bell'

function Logo() {
  return (
    <span className="flex items-center gap-2.5 font-bold text-[17px] text-white">
      <span className="size-7 rounded-lg grid place-items-center" style={{ background: 'linear-gradient(140deg,#ff86c2,#e11d48)' }} aria-hidden>
        <span className="size-[11px] bg-white" style={{ borderRadius: '3px 3px 3px 7px' }} />
      </span>
      LeadDesk
    </span>
  )
}

function SideNav({ onNavigate }: { onNavigate?: () => void }) {
  const { user } = useAuth()
  if (!user) return null
  return (
    <nav aria-label="Main menu" className="flex flex-col gap-0.5">
      {NAV[user.role].map((g, i) => (
        <div key={i} className="flex flex-col gap-0.5">
          {g.title && <p className="px-2.5 pt-4 pb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-side-muted">{g.title}</p>}
          {g.items.map((it) => (
            <NavLink key={it.to} to={it.to} end={it.to === '/'} onClick={onNavigate}
              className={({ isActive }) => clsx('flex items-center gap-2.5 px-2.5 py-2 rounded-xl font-medium transition-colors', isActive ? 'bg-white/12 text-white' : 'text-side-text hover:bg-white/6 hover:text-white')}>
              <Icon name={it.icon} size={17} />
              <span className="flex-1">{it.label}</span>
              {!it.built && <span className="text-[10.5px] font-semibold uppercase tracking-wide text-side-muted">soon</span>}
            </NavLink>
          ))}
        </div>
      ))}
    </nav>
  )
}

function UserMenu() {
  const { user, logout } = useAuth()
  const nav = useNavigate()
  const [open, setOpen] = useState(false)
  if (!user) return null
  return (
    <div className="relative">
      <button className="flex items-center gap-2 rounded-xl px-1.5 py-1 hover:bg-soft cursor-pointer" aria-expanded={open} aria-label="Account menu" onClick={() => setOpen((o) => !o)}>
        <Avatar id={user.id} name={user.name} />
        <span className="hidden sm:block text-left leading-tight"><b className="block text-[13px] text-ink">{user.name}</b><span className="text-[12px] text-faint">{roleLabel[user.role]}</span></span>
      </button>
      {open && (
        <div className="fade-in absolute right-0 mt-2 w-56 card shadow-xl z-30 p-1.5" onMouseLeave={() => setOpen(false)}>
          <button className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-soft text-sm cursor-pointer" onClick={() => { setOpen(false); nav('/change-password') }}><Icon name="key" size={16} />Change password</button>
          <button className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-soft text-sm cursor-pointer text-bad" onClick={async () => { await logout(); nav('/login') }}><Icon name="out" size={16} />Sign out</button>
        </div>
      )}
    </div>
  )
}

export function Shell() {
  const { user } = useAuth()
  const [menu, setMenu] = useState(false)
  const loc = useLocation()
  useEffect(() => setMenu(false), [loc.pathname])
  if (!user) return null
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[244px_minmax(0,1fr)]">
      <aside className="hidden lg:flex sticky top-0 h-dvh flex-col gap-3 bg-side px-3 py-4 overflow-y-auto">
        <div className="px-2 pb-2"><Logo /></div>
        <div className="mx-1 p-2.5 rounded-xl bg-white/6 flex items-center gap-2.5">
          <Avatar id={user.id} name={user.name} />
          <span className="min-w-0 leading-tight"><b className="block text-white text-[14px] truncate">{user.name}</b><span className="text-[12px] text-side-muted">{roleLabel[user.role]}</span></span>
        </div>
        <SideNav />
        <p className="mt-auto px-2.5 text-[11.5px] text-side-muted">One copy per company · all data stays in your database</p>
      </aside>

      {menu && (
        <div className="lg:hidden fixed inset-0 z-40 flex">
          <div className="fade-in w-[min(300px,85vw)] h-full bg-side px-3 py-4 overflow-y-auto flex flex-col gap-3">
            <div className="flex items-center justify-between px-2"><Logo /><button className="text-white p-2 cursor-pointer" aria-label="Close menu" onClick={() => setMenu(false)}><Icon name="x" /></button></div>
            <SideNav onNavigate={() => setMenu(false)} />
          </div>
          <button className="flex-1 bg-ink/40" aria-label="Close menu" onClick={() => setMenu(false)} />
        </div>
      )}

      <div className="min-w-0 flex flex-col">
        <header className="sticky top-0 z-20 flex items-center gap-3 px-4 sm:px-6 h-16 bg-bg/85 backdrop-blur border-b border-line">
          <button className="lg:hidden btn-ghost btn-sm" aria-label="Open menu" onClick={() => setMenu(true)}><Icon name="menu" /></button>
          <span className="lg:hidden"><span className="text-ink font-bold">LeadDesk</span></span>
          <div className="ml-auto flex items-center gap-2"><Bell /><UserMenu /></div>
        </header>
        <main className="px-4 sm:px-6 lg:px-8 py-6 lg:py-8 max-w-[1320px] w-full mx-auto"><Outlet /></main>
      </div>
    </div>
  )
}
