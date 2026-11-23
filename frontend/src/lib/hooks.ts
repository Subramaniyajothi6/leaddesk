import { useMutation, useQueryClient } from '@tanstack/react-query'
import { getAccessToken, ApiError, refreshSession } from './api'
import { useToast } from '../components/ui'

/** Run an action, show a toast, refresh the listed queries. Errors become a red toast with the server's message. */
export function useAction<V, R>(fn: (v: V) => Promise<R>, o: { success?: string | ((r: R, v: V) => string); invalidate?: string[]; onDone?: (r: R, v: V) => void; onError?: (e: unknown) => boolean | void } = {}) {
  const qc = useQueryClient()
  const toast = useToast()
  return useMutation({
    mutationFn: fn,
    onSuccess: (r, v) => {
      if (o.success) toast(typeof o.success === 'function' ? o.success(r, v) : o.success)
      for (const k of o.invalidate ?? []) qc.invalidateQueries({ queryKey: [k] })
      o.onDone?.(r, v)
    },
    onError: (e) => { if (!o.onError?.(e)) toast(e instanceof ApiError ? e.message : 'Something went wrong', 'bad') },
  })
}

/** Download a file from the API (exports, error files) with the access token, keeping the server's file name. */
export async function download(path: string, query: Record<string, unknown> = {}) {
  const qs = new URLSearchParams(Object.entries(query).filter(([, v]) => v != null && v !== '').map(([k, v]) => [k, String(v)])).toString()
  const go = () => fetch(`/api${path}${qs ? `?${qs}` : ''}`, { headers: { Authorization: `Bearer ${getAccessToken() ?? ''}` }, credentials: 'include' })
  let res = await go()
  if (res.status === 401 && (await refreshSession())) res = await go()
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new ApiError(res.status, e?.error?.code ?? 'ERROR', e?.error?.message ?? 'Download failed') }
  const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? 'download'
  const url = URL.createObjectURL(await res.blob())
  const a = Object.assign(document.createElement('a'), { href: url, download: name })
  document.body.append(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}

export const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
export const thisMonth = () => today().slice(0, 7)
