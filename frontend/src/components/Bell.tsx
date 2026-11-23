import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import clsx from 'clsx'
import { api, post, getAccessToken } from '../lib/api'
import { ago } from '../lib/format'
import { Icon } from './Icon'

interface Note { id: number; title: string; body: string | null; link: string | null; readAt: string | null; createdAt: string }

/** Notification bell: list + unread count, kept live with Server-Sent Events (falls back to polling). */
export function Bell() {
  const qc = useQueryClient()
  const nav = useNavigate()
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const q = useQuery({ queryKey: ['notifications'], queryFn: () => api<{ unread: number; rows: Note[] }>('/notifications'), refetchInterval: 60_000 })

  useEffect(() => {
    let es: EventSource | null = null
    let retry: ReturnType<typeof setTimeout>
    const connect = () => {
      const t = getAccessToken()
      if (!t) { retry = setTimeout(connect, 5000); return }
      es = new EventSource(`/api/events?access_token=${encodeURIComponent(t)}`)
      es.addEventListener('notification', () => { qc.invalidateQueries({ queryKey: ['notifications'] }); qc.invalidateQueries({ queryKey: ['dashboard'] }) })
      es.onerror = () => { es?.close(); retry = setTimeout(connect, 15_000) }
    }
    connect()
    return () => { es?.close(); clearTimeout(retry) }
  }, [qc])

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent | KeyboardEvent) => { if (e instanceof KeyboardEvent ? e.key === 'Escape' : !box.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', close); document.addEventListener('keydown', close)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', close) }
  }, [open])

  const unread = q.data?.unread ?? 0
  const openNote = async (n: Note) => {
    if (!n.readAt) await post(`/notifications/${n.id}/read`).catch(() => {})
    qc.invalidateQueries({ queryKey: ['notifications'] })
    setOpen(false)
    if (n.link) nav(n.link.startsWith('/') ? n.link : '/')
  }
  return (
    <div className="relative" ref={box}>
      <button className="btn-ghost btn-sm relative" aria-label={`Notifications, ${unread} unread`} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Icon name="bell" />
        {unread > 0 && <span className="absolute -top-1.5 -right-1.5 min-w-5 h-5 px-1 rounded-full bg-accent text-white text-[11px] font-bold grid place-items-center num">{unread > 99 ? '99+' : unread}</span>}
      </button>
      {open && (
        <div className="fade-in absolute right-0 mt-2 w-[min(380px,calc(100vw-24px))] card shadow-xl z-30 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-line">
            <b className="text-ink">Notifications</b>
            {unread > 0 && <button className="text-[13px] font-semibold text-accent-ink hover:underline cursor-pointer" onClick={async () => { await post('/notifications/read-all'); qc.invalidateQueries({ queryKey: ['notifications'] }) }}>Mark all read</button>}
          </div>
          <ul className="max-h-[60vh] overflow-auto">
            {!q.data?.rows.length && <li className="px-4 py-8 text-center text-muted text-sm">Nothing yet</li>}
            {q.data?.rows.map((n) => (
              <li key={n.id}>
                <button onClick={() => openNote(n)} className={clsx('w-full text-left px-4 py-3 flex gap-3 hover:bg-soft border-b border-line/70 cursor-pointer', !n.readAt && 'bg-accent-soft/40')}>
                  <span className={clsx('mt-1.5 size-2 rounded-full flex-none', n.readAt ? 'bg-transparent' : 'bg-accent')} aria-hidden />
                  <span className="min-w-0">
                    <span className="block text-[13.5px] text-ink font-medium">{n.title}</span>
                    {n.body && <span className="block text-[12.5px] text-muted">{n.body}</span>}
                    <span className="block text-[12px] text-faint mt-0.5">{ago(n.createdAt)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
