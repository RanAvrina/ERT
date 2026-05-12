import type { PostgrestError } from '@supabase/supabase-js'

export function ensureSupabaseResult(error: PostgrestError | null, context: string) {
  if (!error) return
  throw new Error(`${context}: ${error.message}`)
}

export function ensureValue<T>(value: T | null, context: string): T {
  if (value == null) {
    throw new Error(context)
  }
  return value
}
