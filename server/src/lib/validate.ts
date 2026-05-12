import type { ZodType } from 'zod'
import { ApiError } from './api-error.js'

export function validateBody<T>(schema: ZodType<T>, input: unknown) {
  const result = schema.safeParse(input)
  if (!result.success) {
    const issue = result.error.issues[0]
    throw new ApiError(400, issue?.message ?? 'Invalid request body.')
  }

  return result.data
}
