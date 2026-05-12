import { supabaseAdmin } from '../lib/supabase.js'
import { ApiError } from '../lib/api-error.js'
import type { AuthAccount } from '../types/auth.js'

interface AccountRow {
  id: number
  email: string
  full_name: string
  phone: string | null
  status: 'active' | 'inactive'
}

function mapAccountRow(row: AccountRow): AuthAccount {
  return {
    id: row.id,
    email: row.email,
    fullName: row.full_name,
    phone: row.phone,
    status: row.status,
  }
}

export async function findAccountByEmail(email: string) {
  const normalizedEmail = email.trim().toLowerCase()
  const { data, error } = await supabaseAdmin
    .from('accounts')
    .select('*')
    .ilike('email', normalizedEmail)
    .limit(1)
    .maybeSingle()

  if (error) throw new Error(`Failed to load account by email: ${error.message}`)
  return data ? mapAccountRow(data as AccountRow) : null
}

export async function findAccountById(accountId: number) {
  const { data, error } = await supabaseAdmin
    .from('accounts')
    .select('*')
    .eq('id', accountId)
    .limit(1)
    .maybeSingle()

  if (error) throw new Error(`Failed to load account by id: ${error.message}`)
  return data ? mapAccountRow(data as AccountRow) : null
}

export async function requireAccountById(accountId: number) {
  const account = await findAccountById(accountId)
  if (!account) {
    throw new ApiError(404, 'Account was not found.')
  }

  return account
}

export async function createAccount(input: {
  email: string
  fullName: string
  phone: string | null
}) {
  const normalizedEmail = input.email.trim().toLowerCase()

  const { data, error } = await supabaseAdmin
    .from('accounts')
    .insert({
      email: normalizedEmail,
      full_name: input.fullName.trim(),
      phone: input.phone?.trim() || null,
      password_hash: '',
      status: 'active',
    })
    .select('*')
    .single()

  if (error) {
    const existing = await findAccountByEmail(normalizedEmail)
    if (existing) return existing
    throw new Error(`Failed to create account: ${error.message}`)
  }

  return mapAccountRow(data as AccountRow)
}
