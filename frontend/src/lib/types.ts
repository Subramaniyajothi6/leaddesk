export type Category = 'OPEN' | 'WON' | 'LOST' | 'EXCLUDED'
export interface Status { id: number; key: string; label: string; category: Category; countsAsContact: boolean; needsFollowUp: boolean; remarksRequired: boolean; requiredFields: string[]; followUpHours: number | null; colour: string; order: number; active: boolean; next: number[] }
export interface Outcome { id: number; label: string; connected: boolean; countsAsAttempt: boolean; needsFollowUp: boolean; active: boolean; order: number }
export interface Template { id: number; name: string; channel: string; body: string; active: boolean }
export interface CustomField { key: string; label: string; type: 'text' | 'number' | 'date' | 'select'; options: string[] | null; required: boolean; showInList: boolean; active: boolean }
export interface LeadRow {
  id: number; name: string; phone: string; email: string | null; score: number
  status: { key: string; label: string; colour: string; category: Category }
  owner: { id: number; name: string } | null; team: { id: number; name: string } | null; source: string | null
  custom: Record<string, unknown>; attemptCount: number; lastActivityAt: string | null; nextFollowUpAt: string | null; statusChangedAt: string; createdAt: string; version: number
}
export interface FollowUp { id: number; type: 'CALL' | 'WHATSAPP' | 'MEETING' | 'TASK'; dueAt: string; reason: string | null; state: string; auto: boolean }
export interface TimelineItem { at: string; kind: 'assignment' | 'status' | 'call' | 'note' | 'follow_up' | 'payment'; by?: string | null; text: string; data?: Record<string, unknown> }
export interface LeadDetail {
  id: number; name: string; phone: string; email: string | null; score: number; custom: Record<string, unknown>; attemptCount: number; recycleCount: number; dnd: boolean
  status: Status; statusId: number; owner: { id: number; name: string } | null; team: { id: number; name: string } | null; source: { id: number; name: string } | null; batch: { id: number; fileName: string } | null
  daysInStatus: number; nextFollowUp: FollowUp | null; allowedNextStatusIds: number[]; timeline: TimelineItem[]; version: number; createdAt: string; lastActivityAt: string | null
}
export interface Page<T> { rows: T[]; total: number; page: number; pageSize: number }
