import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import clsx from 'clsx'
import { avatarColor, initials } from '../lib/format'
import { Icon } from './Icon'

export function Card({ title, note, action, children, className, strong }: { title?: ReactNode; note?: ReactNode; action?: ReactNode; children: ReactNode; className?: string; strong?: boolean }) {
  return (
    <section className={clsx('card p-5', strong && 'border-ink/80', className)}>
      {(title || action) && (
        <header className="flex flex-wrap items-baseline justify-between gap-2 mb-4">
          <div className="min-w-0">
            {title && <h2 className="text-[15px] font-semibold">{title}</h2>}
            {note && <p className="text-[12.5px] text-faint mt-0.5">{note}</p>}
          </div>
          {action}
        </header>
      )}
      {children}
    </section>
  )
}

export function PageHeader({ title, sub, children }: { title: string; sub?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
      <div className="min-w-0">
        <h1 className="display text-[34px] leading-[1.05] sm:text-[40px]">{title}</h1>
        {sub && <p className="text-muted mt-1.5 text-[14px]">{sub}</p>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  )
}

/** A headline number: value, what it is compared with, and an optional bar to target. */
export function Kpi({ label, value, sub, meter, delta, href }: { label: string; value: ReactNode; sub?: ReactNode; meter?: number | null; delta?: { text: string; dir: -1 | 0 | 1; good?: boolean } | null; href?: string }) {
  const body = (
    <>
      <span className="text-[12.5px] font-medium text-muted">{label}</span>
      <span className="display num text-[30px] leading-tight text-ink">{value}</span>
      {sub && <span className="text-[12.5px] text-text">{sub}</span>}
      {meter != null && (
        <span className="block h-1.5 rounded-full bg-line overflow-hidden mt-1" aria-hidden>
          <i className="block h-full rounded-full bg-accent" style={{ width: `${Math.max(2, Math.min(100, meter))}%` }} />
        </span>
      )}
      {delta && <span className={clsx('text-[12px] font-medium', delta.good === undefined ? 'text-faint' : delta.good ? 'text-ok' : 'text-bad')}>{delta.text}</span>}
    </>
  )
  const cls = 'card p-4 flex flex-col gap-1 min-w-0'
  return href ? <a href={href} className={clsx(cls, 'hover:border-accent/50 transition-colors no-underline')}>{body}</a> : <div className={cls}>{body}</div>
}

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'ok' | 'warn' | 'bad' | 'accent' }) {
  const t = { neutral: 'bg-soft text-muted', ok: 'bg-ok-soft text-ok', warn: 'bg-warn-soft text-warn', bad: 'bg-bad-soft text-bad', accent: 'bg-accent-soft text-accent-ink' }[tone]
  return <span className={clsx('inline-flex items-center gap-1.5 h-6 px-2.5 rounded-full text-[12px] font-semibold whitespace-nowrap', t)}>{children}</span>
}

export function Avatar({ id, name, size = 30 }: { id: number; name: string; size?: number }) {
  return <span className="inline-grid place-items-center rounded-full text-white font-bold flex-none" style={{ width: size, height: size, background: avatarColor(id), fontSize: size * 0.36 }} aria-hidden>{initials(name)}</span>
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return <div role="status" className="flex items-center gap-3 text-muted py-10 justify-center"><span className="size-5 rounded-full border-2 border-line border-t-accent animate-spin" />{label}…</div>
}

export function ErrorBox({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div role="alert" className="card p-5 border-bad/40 bg-bad-soft/40 flex flex-wrap items-center justify-between gap-3">
      <span className="text-bad font-medium">{(error as Error)?.message ?? 'Something went wrong'}</span>
      {onRetry && <button className="btn-ghost btn-sm" onClick={onRetry}>Try again</button>}
    </div>
  )
}

export function Empty({ icon = 'check', title, children }: { icon?: Parameters<typeof Icon>[0]['name']; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center text-center gap-2 py-8 px-4 text-muted">
      <span className="size-10 rounded-full bg-ok-soft text-ok grid place-items-center"><Icon name={icon} /></span>
      <b className="text-ink">{title}</b>
      {children && <p className="text-[13px] max-w-sm">{children}</p>}
    </div>
  )
}

export function Segmented<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex p-1 rounded-xl bg-surface border border-line">
      {options.map((o) => (
        <button key={o.value} role="radio" aria-checked={value === o.value} onClick={() => onChange(o.value)}
          className={clsx('h-8 px-3 rounded-lg text-[13px] font-semibold transition-colors cursor-pointer', value === o.value ? 'bg-ink text-white' : 'text-muted hover:text-ink')}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

// ---------- toasts ----------
type Toast = { id: number; text: string; tone: 'ok' | 'bad' }
const ToastCtx = createContext<(text: string, tone?: 'ok' | 'bad') => void>(() => {})
export const useToast = () => useContext(ToastCtx)
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([])
  const push = useCallback((text: string, tone: 'ok' | 'bad' = 'ok') => {
    const id = Date.now() + Math.random()
    setItems((x) => [...x, { id, text, tone }])
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), 4200)
  }, [])
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div aria-live="polite" className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex flex-col gap-2 w-[min(440px,calc(100vw-32px))]">
        {items.map((t) => (
          <div key={t.id} className={clsx('fade-in rounded-xl px-4 py-3 text-sm font-medium shadow-lg flex items-center gap-2', t.tone === 'ok' ? 'bg-ink text-white' : 'bg-bad text-white')}>
            <Icon name={t.tone === 'ok' ? 'check' : 'x'} size={16} />{t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  )
}

/** Simple tab strip (role="tablist"). */
export function Tabs<T extends string>({ value, onChange, tabs, label }: { value: T; onChange: (v: T) => void; tabs: { value: T; label: string; count?: number }[]; label: string }) {
  return (
    <div role="tablist" aria-label={label} className="flex flex-wrap gap-1 border-b border-line mb-5">
      {tabs.map((t) => (
        <button key={t.value} role="tab" aria-selected={value === t.value} onClick={() => onChange(t.value)}
          className={clsx('h-10 px-3.5 -mb-px border-b-2 text-[14px] font-semibold cursor-pointer', value === t.value ? 'border-accent text-ink' : 'border-transparent text-muted hover:text-ink')}>
          {t.label}{t.count != null && <span className={clsx('ml-1.5 inline-grid place-items-center min-w-5 h-5 px-1 rounded-full text-[11px] num', t.count ? 'bg-accent text-white' : 'bg-soft text-faint')}>{t.count}</span>}
        </button>
      ))}
    </div>
  )
}

/** Plain data table with sticky header row; wraps in a scroll box on small screens. */
export function Table({ head, children, minWidth = 640 }: { head: string[]; children: ReactNode; minWidth?: number }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[13.5px]" style={{ minWidth }}>
        <thead><tr className="text-left text-[12px] text-faint border-b border-line">{head.map((h) => <th key={h} scope="col" className="py-2.5 pr-3 font-semibold whitespace-nowrap">{h}</th>)}</tr></thead>
        <tbody className="[&>tr]:border-b [&>tr]:border-line/70 [&_td]:py-2.5 [&_td]:pr-3">{children}</tbody>
      </table>
    </div>
  )
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return <label className="flex flex-col gap-1.5"><span className="label">{label}</span>{children}{hint && <span className="text-[12px] text-faint">{hint}</span>}</label>
}
