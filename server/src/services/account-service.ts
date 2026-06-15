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

const ACCOUNT_CACHE_TTL_MS = 15_000
const accountByEmailCache = new Map<
  string,
  { value: AuthAccount | null; expiresAt: number }
>()
const accountByIdCache = new Map<
  number,
  { value: AuthAccount | null; expiresAt: number }
>()

function mapAccountRow(row: AccountRow): AuthAccount {
  return {
    id: row.id,
    email: row.email,
    fullName: row.full_name,
    phone: row.phone,
    status: row.status,
  }
}

function cacheAccount(account: AuthAccount | null) {
  if (!account) return

  const expiresAt = Date.now() + ACCOUNT_CACHE_TTL_MS
  accountByEmailCache.set(account.email.trim().toLowerCase(), {
    value: account,
    expiresAt,
  })
  accountByIdCache.set(account.id, {
    value: account,
    expiresAt,
  })
}

export async function findAccountByEmail(email: string) {
  const normalizedEmail = email.trim().toLowerCase()
  const cached = accountByEmailCache.get(normalizedEmail)
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value
  }

  const { data, error } = await supabaseAdmin
    .from('accounts')
    .select('*')
    .ilike('email', normalizedEmail)
    .limit(1)
    .maybeSingle()

  if (error) throw new Error(`Failed to load account by email: ${error.message}`)
  const account = data ? mapAccountRow(data as AccountRow) : null
  accountByEmailCache.set(normalizedEmail, {
    value: account,
    expiresAt: Date.now() + ACCOUNT_CACHE_TTL_MS,
  })
  if (account) {
    cacheAccount(account)
  }
  return account
}

export async function findAccountById(accountId: number) {
  const cached = accountByIdCache.get(accountId)
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value
  }

  const { data, error } = await supabaseAdmin
    .from('accounts')
    .select('*')
    .eq('id', accountId)
    .limit(1)
    .maybeSingle()

  if (error) throw new Error(`Failed to load account by id: ${error.message}`)
  const account = data ? mapAccountRow(data as AccountRow) : null
  accountByIdCache.set(accountId, {
    value: account,
    expiresAt: Date.now() + ACCOUNT_CACHE_TTL_MS,
  })
  if (account) {
    cacheAccount(account)
  }
  return account
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
      status: 'active',
    })
    .select('*')
    .single()

  if (error) {
    const existing = await findAccountByEmail(normalizedEmail)
    if (existing) return existing
    throw new Error(`Failed to create account: ${error.message}`)
  }

  const account = mapAccountRow(data as AccountRow)
  cacheAccount(account)
  return account
}
