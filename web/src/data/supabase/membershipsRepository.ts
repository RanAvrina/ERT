import type {
  AccountRow,
  ApartmentMembershipRow,
} from '../../types/database'
import { supabase } from '../../lib/supabase/client'
import type { UserRole } from '../../types/models'
import { ensureSupabaseResult, ensureValue } from './errors'
import { mapMembershipToUser } from './mappers'

const table = 'apartment_memberships'

export async function createMembershipRow(input: {
  apartmentId: number
  accountId: number
  role: UserRole
}) {
  const client = ensureValue(supabase, 'Supabase client is not configured.')
  const { data, error } = await client
    .from(table)
    .insert({
      apartment_id: input.apartmentId,
      account_id: input.accountId,
      role: input.role,
      status: 'active',
    })
    .select('*')
    .single()
  ensureSupabaseResult(error, 'Failed to create apartment membership')
  return data as ApartmentMembershipRow
}

export async function findActiveMembershipByAccountId(accountId: number) {
  const client = ensureValue(supabase, 'Supabase client is not configured.')
  const { data, error } = await client
    .from(table)
    .select('*')
    .eq('account_id', accountId)
    .eq('status', 'active')
    .limit(1)
    .maybeSingle()
  ensureSupabaseResult(error, 'Failed to load active membership')
  return (data as ApartmentMembershipRow | null) ?? null
}

export async function listMembershipRowsByApartmentId(apartmentId: number) {
  const client = ensureValue(supabase, 'Supabase client is not configured.')
  const { data, error } = await client
    .from(table)
    .select('*')
    .eq('apartment_id', apartmentId)
    .eq('status', 'active')
    .order('id', { ascending: true })
  ensureSupabaseResult(error, 'Failed to list apartment memberships')
  return (data ?? []) as ApartmentMembershipRow[]
}

export async function deactivateMembershipByAccountId(accountId: number) {
  const client = ensureValue(supabase, 'Supabase client is not configured.')
  const { error } = await client
    .from(table)
    .update({
      status: 'inactive',
      ended_at: new Date().toISOString(),
    })
    .eq('account_id', accountId)
    .eq('status', 'active')
  ensureSupabaseResult(error, 'Failed to deactivate membership')
}

export async function loadApartmentUsers(apartmentId: number) {
  const client = ensureValue(supabase, 'Supabase client is not configured.')
  const memberships = await listMembershipRowsByApartmentId(apartmentId)
  if (!memberships.length) return []

  const accountIds = memberships.map((membership) => membership.account_id)
  const { data, error } = await client
    .from('accounts')
    .select('*')
    .in('id', accountIds)
  ensureSupabaseResult(error, 'Failed to load membership accounts')
  const accounts = new Map(((data ?? []) as AccountRow[]).map((row) => [row.id, row]))

  return memberships
    .map((membership) => {
      const account = accounts.get(membership.account_id)
      return account ? mapMembershipToUser(membership, account) : null
    })
    .filter((user): user is NonNullable<typeof user> => Boolean(user))
}
