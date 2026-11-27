import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { api, ApiError } from '../lib/api'
import { useCustomFields, useSources } from '../lib/refdata'
import { useAction, download } from '../lib/hooks'
import { int, ago } from '../lib/format'
import { Card, PageHeader, Table, Field, Badge, useToast } from '../components/ui'
import { Icon } from '../components/Icon'
import { AddLead } from '../components/AddLead'
import { Modal } from '../components/Modal'

interface Preview { fileName: string; rowCount: number; headers: string[]; sample: Record<string, string>[]; suggestedMapping: Record<string, string> }
interface Result { batchId: number; totalRows: number; added: number; duplicates: number; rejected: number; merged: number; summary: string }
interface Check {
  totalRows: number; ready: number; merged: number; duplicates: number; errors: number
  groups: { reason: string; kind: 'ERROR' | 'DUPLICATE'; count: number }[]
  rows: { rowNumber: number; kind: 'ERROR' | 'DUPLICATE'; reason: string; name: string; phone: string; existingLeadId: number | null }[]
}
interface Batch { id: number; fileName: string; totalRows: number; accepted: number; duplicates: number; rejected: number; createdAt: string }

const STEPS = ['Choose file', 'Match columns', 'Check results']

export function Upload() {
  const [step, setStep] = useState(0)
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [mapping, setMapping] = useState<Record<string, string>>({})
  const [dupAction, setDupAction] = useState<'SKIP' | 'MERGE'>('SKIP')
  const [defaultSource, setDefaultSource] = useState('')
  const [result, setResult] = useState<Result | null>(null)
  const fields = useCustomFields()
  const sources = useSources()
  const toast = useToast()
  const batches = useQuery({ queryKey: ['imports'], queryFn: () => api<Batch[]>('/imports') })

  const read = useAction(async (f: File) => { const fd = new FormData(); fd.append('file', f); return api<Preview>('/imports/preview', { method: 'POST', body: fd }) }, {
    onDone: (p) => { setPreview(p); setMapping(p.suggestedMapping); setStep(1) },
  })
  const form = () => {
    const fd = new FormData(); fd.append('file', file!); fd.append('mapping', JSON.stringify(Object.fromEntries(Object.entries(mapping).filter(([, v]) => v)))); fd.append('dupAction', dupAction)
    if (defaultSource) fd.append('defaultSource', defaultSource)
    return fd
  }
  // First a check that saves nothing (popup with the problems), then the real upload.
  const [checked, setChecked] = useState<Check | null>(null)
  const check = useAction(() => api<Check>('/imports/check', { method: 'POST', body: form() }), { onDone: setChecked })
  const run = useAction(() => api<Result>('/imports', { method: 'POST', body: form() }), {
    invalidate: ['imports', 'leads', 'dashboard'], onDone: (r) => { setChecked(null); setResult(r); setStep(2) },
  })

  const pick = (f: File | undefined) => { if (!f) return; setFile(f); setResult(null); read.mutate(f) }
  const targets = [
    { key: 'name', label: 'Name', required: true }, { key: 'phone', label: 'Phone', required: true }, { key: 'email', label: 'Email' }, { key: 'source', label: 'Source' },
    ...(fields.data ?? []).filter((f) => f.active).map((f) => ({ key: `custom.${f.key}`, label: f.label, required: f.required })),
  ]
  const restart = () => { setStep(0); setFile(null); setPreview(null); setResult(null) }

  return (
    <div className="fade-in">
      <PageHeader title="Upload leads" sub="Excel (.xlsx) or CSV. Every row is checked first; nothing is saved until you confirm.">
        <AddLead className="btn-ghost" />
      </PageHeader>
      <ol className="flex flex-wrap gap-2 mb-5" aria-label="Steps">
        {STEPS.map((s, i) => (
          <li key={s} className={clsx('flex items-center gap-2 h-9 px-3 rounded-full text-[13px] font-semibold border', i === step ? 'bg-ink text-white border-ink' : i < step ? 'bg-ok-soft text-ok border-ok/30' : 'border-line text-muted')}>
            <span className="num">{i < step ? '✓' : i + 1}</span>{s}
          </li>
        ))}
      </ol>

      {step === 0 && (
        <Card>
          <label className={clsx('flex flex-col items-center gap-3 py-12 px-6 rounded-2xl border-2 border-dashed text-center cursor-pointer transition-colors', read.isPending ? 'border-accent bg-accent-soft/30' : 'border-line hover:border-accent/60 hover:bg-soft')}
            onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); pick(e.dataTransfer.files[0]) }}>
            <span className="size-12 rounded-2xl bg-accent-soft text-accent grid place-items-center"><Icon name="upload" size={22} /></span>
            <b className="text-ink text-[16px]">{read.isPending ? `Reading ${file?.name}…` : 'Drop the file here, or click to choose'}</b>
            <span className="text-[13px] text-muted">The first row must have the column names. Up to 20,000 rows.</span>
            <input type="file" className="sr-only" accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(e) => pick(e.target.files?.[0])} />
          </label>
        </Card>
      )}

      {step === 1 && preview && (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
          <Card title="Match your columns" note={`${preview.fileName} · ${int(preview.rowCount)} rows`}>
            <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); check.mutate(undefined) }}>
              {targets.map((t) => (
                <Field key={t.key} label={`${t.label}${t.required ? ' (required)' : ''}`}>
                  <select className="field" value={mapping[t.key] ?? ''} onChange={(e) => setMapping({ ...mapping, [t.key]: e.target.value })}>
                    <option value="">{t.required ? 'Choose a column…' : 'Not in this file'}</option>
                    {preview.headers.map((h) => <option key={h}>{h}</option>)}
                  </select>
                </Field>
              ))}
              {!mapping.source && (
                <Field label="Source for all rows" hint="Used when the file has no source column">
                  <select className="field" value={defaultSource} onChange={(e) => setDefaultSource(e.target.value)}>
                    <option value="">None</option>{sources.data?.filter((s) => s.active).map((s) => <option key={s.id}>{s.name}</option>)}
                  </select>
                </Field>
              )}
              <fieldset className="flex flex-col gap-2">
                <legend className="label mb-1">When a lead already exists</legend>
                {([['SKIP', 'Skip it (keep the existing lead as it is)'], ['MERGE', 'Merge: fill only the empty fields of the existing lead']] as const).map(([v, l]) => (
                  <label key={v} className="flex items-center gap-2 text-[13.5px]"><input type="radio" name="dup" checked={dupAction === v} onChange={() => setDupAction(v)} />{l}</label>
                ))}
              </fieldset>
              <div className="flex gap-2 justify-end">
                <button type="button" className="btn-ghost" onClick={restart}>Back</button>
                <button className="btn-primary" disabled={!mapping.name || !mapping.phone || check.isPending}>{check.isPending ? 'Checking every row…' : `Check ${int(preview.rowCount)} rows`}</button>
              </div>
            </form>
          </Card>
          <Card title="First rows of the file">
            <Table head={preview.headers} minWidth={Math.max(480, preview.headers.length * 120)}>
              {preview.sample.map((r, i) => <tr key={i}>{preview.headers.map((h) => <td key={h} className="truncate max-w-48">{r[h]}</td>)}</tr>)}
            </Table>
          </Card>
        </div>
      )}

      {step === 2 && result && (
        <Card title="Upload finished" strong>
          <p className="display text-[26px] text-ink mb-4">{result.summary}</p>
          <div className="grid gap-3 sm:grid-cols-3 mb-5">
            <div className="rounded-xl bg-ok-soft p-4"><p className="text-[12.5px] text-ok font-semibold">Added to the company pool</p><p className="display num text-[30px] text-ink">{int(result.added)}</p></div>
            <div className="rounded-xl bg-warn-soft p-4"><p className="text-[12.5px] text-warn font-semibold">Duplicates{result.merged ? ` (${result.merged} merged)` : ''}</p><p className="display num text-[30px] text-ink">{int(result.duplicates)}</p></div>
            <div className="rounded-xl bg-bad-soft p-4"><p className="text-[12.5px] text-bad font-semibold">Rows with errors</p><p className="display num text-[30px] text-ink">{int(result.rejected)}</p></div>
          </div>
          <div className="flex flex-wrap gap-2">
            {result.added > 0 && <Link to={`/allocation?batchId=${result.batchId}&count=${result.added}`} className="btn-primary">Give these leads to teams</Link>}
            {result.rejected > 0 && <button className="btn-ghost" onClick={() => download(`/imports/${result.batchId}/rejects.csv`, { kind: 'ERROR' }).catch((e) => toast(e.message, 'bad'))}>Download errors</button>}
            {result.duplicates > 0 && <button className="btn-ghost" onClick={() => download(`/imports/${result.batchId}/rejects.csv`, { kind: 'DUPLICATE' }).catch((e) => toast(e.message, 'bad'))}>Download duplicates</button>}
            <button className="btn-ghost" onClick={restart}>Upload another file</button>
          </div>
        </Card>
      )}
      <CheckDialog c={checked} onClose={() => setChecked(null)} onRecheck={() => check.mutate(undefined)} rechecking={check.isPending} onAdd={() => run.mutate(undefined)} adding={run.isPending} />
      {read.error && step === 0 && <p role="alert" className="mt-3 text-bad text-[13.5px]">{(read.error as ApiError).message}</p>}

      <Card title="Recent uploads" className="mt-5">
        <Table head={['File', 'When', 'Rows', 'Added', 'Duplicates', 'Errors', '']}>
          {batches.data?.map((b) => (
            <tr key={b.id} className="num">
              <td className="text-ink font-medium">{b.fileName}</td><td className="text-muted">{ago(b.createdAt)}</td><td>{int(b.totalRows)}</td><td>{int(b.accepted)}</td>
              <td>{b.duplicates ? <Badge tone="warn">{b.duplicates}</Badge> : 0}</td><td>{b.rejected ? <Badge tone="bad">{b.rejected}</Badge> : 0}</td>
              <td className="text-right">{(b.duplicates + b.rejected) > 0 && <button className="text-[13px] font-semibold text-accent-ink hover:underline cursor-pointer" onClick={() => download(`/imports/${b.id}/rejects.csv`).catch((e) => toast(e.message, 'bad'))}>Error file</button>}</td>
            </tr>
          ))}
          {!batches.data?.length && <tr><td colSpan={7} className="text-center text-muted py-6">No uploads yet</td></tr>}
        </Table>
      </Card>
    </div>
  )
}

/** Result of the check before saving: what will be added, and every problem, so the file can be fixed first. */
function CheckDialog({ c, onClose, onRecheck, rechecking, onAdd, adding }: { c: Check | null; onClose: () => void; onRecheck: () => void; rechecking: boolean; onAdd: () => void; adding: boolean }) {
  if (!c) return null
  const problems = c.errors + c.duplicates
  const sourceProblem = c.groups.some((g) => g.reason.startsWith('Source "'))
  const nothing = c.ready === 0 && c.merged === 0
  return (
    <Modal open onClose={onClose} title={problems ? 'Check before adding' : 'All rows look good'} wide>
      <div className="flex flex-col gap-4">
        <div className="grid gap-3 grid-cols-3">
          <div className="rounded-xl bg-ok-soft p-3"><p className="text-[12.5px] text-ok font-semibold">Ready to add</p><p className="display num text-[26px] text-ink">{int(c.ready)}</p></div>
          <div className="rounded-xl bg-warn-soft p-3"><p className="text-[12.5px] text-warn font-semibold">Duplicates{c.merged ? ` (${c.merged} to merge)` : ''}</p><p className="display num text-[26px] text-ink">{int(c.duplicates)}</p></div>
          <div className="rounded-xl bg-bad-soft p-3"><p className="text-[12.5px] text-bad font-semibold">Rows with errors</p><p className="display num text-[26px] text-ink">{int(c.errors)}</p></div>
        </div>

        {problems > 0 && (
          <>
            {sourceProblem && (
              <p className="rounded-lg bg-soft px-3 py-2 text-[13px]">
                A source in the file is not in your list. <a className="font-semibold text-accent-ink underline" href="/settings?sec=leads" target="_blank" rel="noreferrer">Add it in Settings → Leads</a> (opens a new tab), then come back and click <b>Check again</b>.
              </p>
            )}
            {/* One list: each problem once, with its rows underneath. Open when there are only a few. */}
            <div className="rounded-lg border border-line divide-y divide-line" aria-label="Problems found">
              {c.groups.map((g) => {
                const rows = c.rows.filter((r) => r.reason.replace(/ as row \d+ in this file$/, ' as another row in this file').split('; ').includes(g.reason))
                return (
                  <details key={g.reason} open={problems <= 20} className="group">
                    <summary className="flex items-center justify-between gap-3 px-3 py-2 cursor-pointer list-none [&::-webkit-details-marker]:hidden text-[13.5px] font-medium hover:bg-soft">
                      <span className={clsx('flex items-center gap-2', g.kind === 'ERROR' ? 'text-bad' : 'text-warn')}>
                        <span className="text-faint transition-transform group-open:rotate-90" aria-hidden>›</span>{g.reason}
                      </span>
                      <span className="num text-muted whitespace-nowrap">{int(g.count)} row{g.count === 1 ? '' : 's'}</span>
                    </summary>
                    {/* Same fixed columns in every group, so names, phones and links line up down the whole list. */}
                    <ul className="pb-1.5 text-[13px]">
                      {rows.map((r) => (
                        <li key={r.rowNumber} className="grid grid-cols-[4.5rem_minmax(0,1fr)_7.5rem] sm:grid-cols-[4.5rem_minmax(0,1fr)_7.5rem_9.5rem] items-center gap-x-3 pl-8 pr-3 py-1">
                          <span className="num text-muted whitespace-nowrap">Row {r.rowNumber}</span>
                          <span className="truncate">{r.name || <span className="text-faint">(no name)</span>}</span>
                          <span className="num whitespace-nowrap">{r.phone || <span className="text-faint">(no phone)</span>}</span>
                          <span className="max-sm:col-start-2 max-sm:col-span-2 sm:text-right text-muted whitespace-nowrap">
                            {r.reason.match(/as (row \d+) in this file$/)?.[1]?.replace('row', 'same as row')}
                            {r.existingLeadId && <a className="underline text-accent-ink" href={`/leads/${r.existingLeadId}`} target="_blank" rel="noreferrer">open existing lead</a>}
                          </span>
                        </li>
                      ))}
                      {rows.length < g.count && <li className="pl-8 py-1 text-[12.5px] text-faint">…and {int(g.count - rows.length)} more in the error file</li>}
                    </ul>
                  </details>
                )
              })}
            </div>
          </>
        )}

        {/* Footer stays at the bottom of the popup while the list scrolls with the popup (one scroll only). */}
        <div className="sticky bottom-0 -mx-5 -mb-5 px-5 pt-3 pb-5 bg-surface border-t border-line flex flex-col gap-3">
        <p className="text-[13px] text-muted">
          {nothing ? 'Nothing new to add from this file.'
            : problems ? <>Nothing is saved yet. Fix the file and check again, or add the {int(c.ready)} good row{c.ready === 1 ? '' : 's'} now: the others are left out and listed in the error file.</>
            : <>Nothing is saved yet. {int(c.ready)} new lead{c.ready === 1 ? '' : 's'} will go to the company pool.</>}
        </p>
        <div className="flex flex-wrap justify-end gap-2">
          <button className="btn-ghost" onClick={onClose}>{problems ? 'Go back and fix' : 'Back'}</button>
          {problems > 0 && <button className="btn-ghost" onClick={onRecheck} disabled={rechecking}>{rechecking ? 'Checking…' : 'Check again'}</button>}
          {!nothing && (
            <button className="btn-primary" onClick={onAdd} disabled={adding}>
              {adding ? 'Adding…' : `Add ${int(c.ready)} row${c.ready === 1 ? '' : 's'}${c.merged ? ` and merge ${int(c.merged)}` : ''}`}
            </button>
          )}
        </div>
        </div>
      </div>
    </Modal>
  )
}
