import type { Db } from '../db.js'

/** JSON-safe copy (bigint → number, Date → ISO). */
export function plain(v: unknown): unknown {
  return v === undefined ? undefined : JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? Number(x) : x)))
}

export interface AuditEntry {
  actorId?: number | null
  action: string
  entity: string
  entityId?: string | number | null
  before?: unknown
  after?: unknown
  ip?: string | null
}

/** Append one row to the audit log (the table refuses updates and deletes). */
export async function audit(db: Db, e: AuditEntry) {
  await db.auditLog.create({
    data: {
      actorId: e.actorId ?? null,
      action: e.action,
      entity: e.entity,
      entityId: e.entityId == null ? null : String(e.entityId),
      before: (plain(e.before) ?? undefined) as object | undefined,
      after: (plain(e.after) ?? undefined) as object | undefined,
      ip: e.ip ?? null,
    },
  })
}
