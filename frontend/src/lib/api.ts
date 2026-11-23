/**
 * Talks to the LeadDesk API. The access token lives only in memory (never localStorage);
 * a 401 triggers one silent refresh through the httpOnly cookie, then the request is retried.
 */
export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message)
  }
}

let accessToken: string | null = null
let refreshing: Promise<boolean> | null = null
let onSessionLost: (() => void) | null = null

export const setAccessToken = (t: string | null) => { accessToken = t }
export const getAccessToken = () => accessToken
export const onLostSession = (fn: () => void) => { onSessionLost = fn }

export interface SessionUser {
  id: number; name: string; email: string; empCode: string; role: 'ADMIN' | 'TEAM_LEAD' | 'BDE'; mustChangePassword: boolean; teamIds: number[]
}
export interface Session { accessToken: string; expiresIn: number; user: SessionUser }

export async function refreshSession(): Promise<Session | null> {
  const r = await fetch('/api/auth/refresh', { method: 'POST', credentials: 'include' })
  if (!r.ok) return null
  const s = (await r.json()) as Session
  accessToken = s.accessToken
  return s
}

async function tryRefresh() {
  refreshing ??= refreshSession().then((s) => !!s).finally(() => { refreshing = null })
  return refreshing
}

type Body = Record<string, unknown> | unknown[] | FormData | undefined

export async function api<T = unknown>(path: string, opts: { method?: string; body?: Body; query?: Record<string, unknown>; retry?: boolean } = {}): Promise<T> {
  const qs = opts.query ? '?' + new URLSearchParams(Object.entries(opts.query).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => [k, String(v)])).toString() : ''
  const isForm = opts.body instanceof FormData
  const res = await fetch(`/api${path}${qs}`, {
    method: opts.method ?? (opts.body ? 'POST' : 'GET'),
    credentials: 'include',
    headers: { ...(accessToken && { Authorization: `Bearer ${accessToken}` }), ...(!isForm && opts.body && { 'Content-Type': 'application/json' }) },
    body: isForm ? (opts.body as FormData) : opts.body ? JSON.stringify(opts.body) : undefined,
  })
  if (res.status === 401 && opts.retry !== false && !path.startsWith('/auth/')) {
    if (await tryRefresh()) return api<T>(path, { ...opts, retry: false })
    onSessionLost?.()
  }
  if (!res.ok) {
    const e = await res.json().catch(() => ({}))
    throw new ApiError(res.status, e?.error?.code ?? 'ERROR', e?.error?.message ?? `Request failed (${res.status})`, e?.error?.details)
  }
  const type = res.headers.get('content-type') ?? ''
  return (type.includes('application/json') ? res.json() : res.blob()) as Promise<T>
}

export const post = <T = unknown>(path: string, body?: Body) => api<T>(path, { method: 'POST', body: body ?? {} })
