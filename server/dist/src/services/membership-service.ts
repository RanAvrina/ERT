import { supabaseAdmin } from '../lib/supabase.js'
import { ApiError } from '../lib/api-error.js'
import type { AuthMembership } from '../types/auth.js'

interface MembershipRow {
  id: number
  apartment_id: number
  account_id: number
  role: 'admin' | 'tenant' | 'landlord'
  status: 'active' | 'inactive'
  joined_at: string
}

function mapMembershipRow(row: MembershipRow): AuthMembership {
  return {
    id: row.id,
    apartmentId: row.apartment_id,
    accountId: row.account_id,
    role: row.role,
    status: row.status,
  }
}

export async function findActiveMembershipByAccountId(accountId: number) {
  const { data, error } = await supabaseAdmin
    .from('apartment_memberships')
    .select('*')
    .eq('account_id', accountId)
    .eq('status', 'active')
    .limit(1)
    .maybeSingle()

  if (error) throw new Error(`Failed to load active membership: ${error.message}`)
  return data ? mapMembershipRow(data as MembershipRow) : null
}

export async function findActiveMembershipByApartmentAndAccount(apartmentId: number, accountId: number) {
  const { data, error } = await supabaseAdmin
    .from('apartment_memberships')
    .select('*')
    .eq('apartment_id', apartmentId)
    .eq('account_id', accountId)
    .eq('status', 'active')
    .limit(1)
    .maybeSingle()

  if (error) throw new Error(`Failed to load apartment membership: ${error.message}`)
  return data ? mapMembershipRow(data as MembershipRow) : null
}

export async function listActiveMembershipsByApartmentId(apartmentId: number) {
  const { data, error } = await supabaseAdmin
    .from('apartment_memberships')
    .select('*')
    .eq('apartment_id', apartmentId)
    .eq('status', 'active')
    .order('joined_at', { ascending: true })
    .order('id', { ascending: true })

  if (error) throw new Error(`Failed to load apartment memberships: ${error.message}`)
  return (data ?? []) as MembershipRow[]
}

export async function findMembershipById(membershipId: number) {
  const { data, error } = await supabaseAdmin
    .from('apartment_memberships')
    .select('*')
    .eq('id', membershipId)
    .limit(1)
    .maybeSingle()

  if (error) throw new Error(`Failed to load membership by id: ${error.message}`)
  return data ? mapMembershipRow(data as MembershipRow) : null
}

export async function createMembership(input: {
  apartmentId: number
  accountId: number
  role: AuthMembership['role']
}) {
  const { data, error } = await supabaseAdmin
    .from('apartment_memberships')
    .insert({
      apartment_id: input.apartmentId,
      account_id: input.accountId,
      role: input.role,
      status: 'active',
    })
    .select('*')
    .single()

  if (error) throw new Error(`Failed to create membership: ${error.message}`)
  return mapMembershipRow(data as MembershipRow)
}

export async function deactivateMembership(membershipId: number) {
  const { error } = await supabaseAdmin
    .from('apartment_memberships')
    .update({
      status: 'inactive',
      ended_at: new Date().toISOString(),
    })
    .eq('id', membershipId)

  if (error) throw new Error(`Failed to deactivate membership: ${error.message}`)
}

export async function assertAccountCanReceiveInviteJoin(accountId: number, role: AuthMembership['role']) {
  const existingMembership = await findActiveMembershipByAccountId(accountId)
  if (!existingMembership) return

  if (existingMembership.role !== role) {
    throw new ApiError(409, 'This account is already linked to another active apartment role.')
  }

  throw new ApiError(409, 'This account is already linked to an active apartment.')
}
