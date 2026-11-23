import { useQuery } from '@tanstack/react-query'
import { api } from './api'
import type { CustomField, Outcome, Status, Template } from './types'

/** Reference lists change rarely (Admin settings): cache them for 5 minutes. */
const long = { staleTime: 5 * 60_000 }
export const useStatuses = () => useQuery({ queryKey: ['ref', 'statuses'], queryFn: () => api<Status[]>('/statuses'), ...long })
export const useOutcomes = () => useQuery({ queryKey: ['ref', 'outcomes'], queryFn: () => api<Outcome[]>('/call-outcomes'), ...long })
export const useTemplates = () => useQuery({ queryKey: ['ref', 'templates'], queryFn: () => api<Template[]>('/templates'), ...long })
export const useCustomFields = () => useQuery({ queryKey: ['ref', 'fields'], queryFn: () => api<CustomField[]>('/custom-fields'), ...long })
export const useSources = () => useQuery({ queryKey: ['ref', 'sources'], queryFn: () => api<{ id: number; name: string; active: boolean }[]>('/sources'), ...long })
