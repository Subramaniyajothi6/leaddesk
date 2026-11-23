/** Status with its Admin-chosen colour as a dot; text stays dark for contrast (colour is never the only signal). */
export function StatusBadge({ label, colour }: { label: string; colour: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 h-6 px-2.5 rounded-full text-[12px] font-semibold whitespace-nowrap bg-soft text-ink border border-line">
      <span className="size-2 rounded-full" style={{ background: colour }} aria-hidden />{label}
    </span>
  )
}
