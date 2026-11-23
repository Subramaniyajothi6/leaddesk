import { useEffect, useRef, type ReactNode } from 'react'
import { Icon } from './Icon'

/** Native <dialog>: focus trap, Esc to close and backdrop for free. On phones it sits at the bottom like a sheet. */
export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null)
  const body = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) { d.showModal(); requestAnimationFrame(() => body.current?.focus()) } // focus the content, not the close button
    if (!open && d.open) d.close()
  }, [open])
  return (
    <dialog ref={ref} onClose={onClose} onCancel={(e) => { e.preventDefault(); onClose() }}
      className={`m-auto max-sm:mb-0 max-sm:w-full max-sm:max-w-full max-sm:rounded-b-none rounded-2xl p-0 backdrop:bg-ink/45 bg-surface text-text shadow-2xl ${wide ? 'w-[min(720px,calc(100vw-32px))]' : 'w-[min(520px,calc(100vw-32px))]'}`}>
      {open && (
        <div className="fade-in">
          <header className="flex items-center justify-between gap-3 px-5 py-4 border-b border-line">
            <h2 className="text-[16px] font-semibold">{title}</h2>
            <button className="p-1.5 rounded-lg hover:bg-soft cursor-pointer" aria-label="Close" onClick={onClose}><Icon name="x" /></button>
          </header>
          <div ref={body} className="p-5 max-h-[75dvh] overflow-y-auto outline-none" tabIndex={-1}>{children}</div>
        </div>
      )}
    </dialog>
  )
}
