import type { AccountRow } from '../../types/database'
import { supabase } from '../../lib/supabase/client'
import { ensureSupabaseResult, ensureValue } from './errors'
import { mapAccountRowToIdentity } from './mappers'

const table = 'accounts'

export async function listAccountRows() {
  const client = ensureValue(supabase, 'Supabase client is not configured.')
  const { data, error } = await client.from(table).select('*').order('id', { ascending: false })
  ensureSupabaseResult(error, 'Failed to list accounts')
  return (data ?? []) as AccountRow[]
}

export async function findAccountRowByEmail(email: string) {
  const client = ensureValue(supabase, 'Supabase client is not configured.')
  const normalizedEmail = email.trim().toLowerCase()
  const { data, error } = await client
    .from(table)
    .select('*')
    .ilike('email', normalizedEmail)
    .limit(1)
    .maybeSingle()
  ensureSupabaseResult(error, 'Failed to load account by email')
  return (data as AccountRow | null) ?? null
}

export async function createAccountRow(account: {
  name: string
  email: string
  phone: string
  passwordHash?: string
}) {
  const client = ensureValue(supabase, 'Supabase client is not configured.')
  const payload = {
    full_name: account.name.trim(),
    email: account.email.trim().toLowerCase(),
    phone: account.phone.trim() || null,
    password_hash: account.passwordHash ?? 'supabase-auth',
    status: 'active' as const,
  }
  const { data, error } = await client.from(table).insert(payload).select('*').single()
  ensureSupabaseResult(error, 'Failed to create account')
  return data as AccountRow
}

export async function listAccounts() {
  const rows = await listAccountRows()
  return rows.map(mapAccountRowToIdentity)
}

export async function findAccountByEmail(email: string) {
  const row = await findAccountRowByEmail(email)
  return row ? mapAccountRowToIdentity(row) : null
}
