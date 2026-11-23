import { delta } from './format'

export const PERIODS = [{ value: 'today' as const, label: 'Today' }, { value: 'week' as const, label: 'Week' }, { value: 'month' as const, label: 'Month' }]

/** Up is good unless told otherwise; the colour says whether the change is good or bad. */
export function good(dl: ReturnType<typeof delta>, upIsGood: boolean) {
  if (!dl) return null
  return { ...dl, good: dl.dir === 0 ? undefined : (dl.dir > 0) === upIsGood }
}

/** API links (e.g. "/allocation/teams?teamId=2") → the screen that handles them. */
export const routeFor = (link: string) => {
  const [path, query] = link.split('?')
  const base = '/' + (path.split('/')[1] ?? '')
  return base === '/leads' && query ? `${base}?${query}` : base // keep filters for the lead list
}
