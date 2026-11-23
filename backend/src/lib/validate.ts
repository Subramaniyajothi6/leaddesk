import { z } from 'zod'
import { badRequest } from './errors.js'

/** Parse input with a zod schema; a failure becomes a 400 with field messages. */
export function parse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data)
  if (!r.success) {
    const fields = r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }))
    throw badRequest('Some fields are not valid', fields)
  }
  return r.data
}

export const idParam = z.coerce.number().int().positive()
export const pageQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
})
