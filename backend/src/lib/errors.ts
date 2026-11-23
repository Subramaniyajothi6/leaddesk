export class AppError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message)
  }
}
export const badRequest = (msg: string, details?: unknown) => new AppError(400, 'BAD_REQUEST', msg, details)
export const unauthorized = (msg = 'Please sign in') => new AppError(401, 'UNAUTHORIZED', msg)
export const forbidden = (msg = 'You are not allowed to do this') => new AppError(403, 'FORBIDDEN', msg)
export const notFound = (what = 'Item') => new AppError(404, 'NOT_FOUND', `${what} not found`)
export const conflict = (msg: string, details?: unknown) => new AppError(409, 'CONFLICT', msg, details)
export const unprocessable = (msg: string, details?: unknown) => new AppError(422, 'RULE', msg, details)
