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

const MEMBERSHIP_CACHE_TTL_MS = 30_000

const membershipsByApartmentCache = new Map<
  number,
  { value: MembershipRow[]; expiresAt: number }
>()
const membershipByAccountCache = new Map<
  number,
  { value: AuthMembership | null; expiresAt: number }
>()
const membershipByApartmentAndAccountCache = new Map<
  string,
  { value: AuthMembership | null; expiresAt: number }
>()

function mapMembershipRow(row: MembershipRow): AuthMembership {
  return {
    id: row.id,
    apartmentId: row.apartment_id,
    accountId: row.account_id,
    role: row.role,
    status: row.status,
  }
}

function invalidateMembershipCacheForApartment(apartmentId: number) {
  membershipsByApartmentCache.delete(apartmentId)

  for (const key of membershipByApartmentAndAccountCache.keys()) {
    if (key.startsWith(`${apartmentId}:`)) {
      membershipByApartmentAndAccountCache.delete(key)
    }
  }
}

function invalidateMembershipCacheForAccount(accountId: number) {
  membershipByAccountCache.delete(accountId)

  for (const key of membershipByApartmentAndAccountCache.keys()) {
    if (key.endsWith(`:${accountId}`)) {
      membershipByApartmentAndAccountCache.delete(key)
    }
  }
}

export async function findActiveMembershipByAccountId(accountId: number) {
  const cached = membershipByAccountCache.get(accountId)
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value
  }

  const { data, error } = await supabaseAdmin
    .from('apartment_memberships')
    .select('*')
    .eq('account_id', accountId)
    .eq('status', 'active')
    .limit(1)
    .maybeSingle()

  if (error) throw new Error(`Failed to load active membership: ${error.message}`)
  const result = data ? mapMembershipRow(data as MembershipRow) : null
  membershipByAccountCache.set(accountId, {
    value: result,
    expiresAt: Date.now() + MEMBERSHIP_CACHE_TTL_MS,
  })
  return result
}

export async function findActiveMembershipByApartmentAndAccount(apartmentId: number, accountId: number) {
  const cacheKey = `${apartmentId}:${accountId}`
  const cached = membershipByApartmentAndAccountCache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value
  }

  const { data, error } = await supabaseAdmin
    .from('apartment_memberships')
    .select('*')
    .eq('apartment_id', apartmentId)
    .eq('account_id', accountId)
    .eq('status', 'active')
    .limit(1)
    .maybeSingle()

  if (error) throw new Error(`Failed to load apartment membership: ${error.message}`)
  const result = data ? mapMembershipRow(data as MembershipRow) : null
  membershipByApartmentAndAccountCache.set(cacheKey, {
    value: result,
    expiresAt: Date.now() + MEMBERSHIP_CACHE_TTL_MS,
  })
  return result
}

export async function listActiveMembershipsByApartmentId(apartmentId: number) {
  const cached = membershipsByApartmentCache.get(apartmentId)
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value
  }

  const { data, error } = await supabaseAdmin
    .from('apartment_memberships')
    .select('*')
    .eq('apartment_id', apartmentId)
    .eq('status', 'active')
    .order('joined_at', { ascending: true })
    .order('id', { ascending: true })

  if (error) throw new Error(`Failed to load apartment memberships: ${error.message}`)
  const result = (data ?? []) as MembershipRow[]
  membershipsByApartmentCache.set(apartmentId, {
    value: result,
    expiresAt: Date.now() + MEMBERSHIP_CACHE_TTL_MS,
  })
  return result
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
  invalidateMembershipCacheForApartment(input.apartmentId)
  invalidateMembershipCacheForAccount(input.accountId)
  return mapMembershipRow(data as MembershipRow)
}

export async function ensureMembership(input: {
  apartmentId: number
  accountId: number
  role: AuthMembership['role']
}) {
  if (input.role === 'landlord') {
    const activeApartmentMemberships = await listActiveMembershipsByApartmentId(input.apartmentId)
    const existingLandlord = activeApartmentMemberships.find(
      (membership) =>
        membership.role === 'landlord' &&
        membership.status === 'active' &&
        membership.account_id !== input.accountId,
    )

    if (existingLandlord) {
      throw new ApiError(409, 'This apartment already has an active landlord.')
    }
  }

  const existingMembership = await findActiveMembershipByAccountId(input.accountId)

  if (!existingMembership) {
    return createMembership(input)
  }

  if (existingMembership.apartmentId !== input.apartmentId) {
    throw new ApiError(409, 'This account is already linked to another active apartment.')
  }

  if (existingMembership.role !== input.role) {
    throw new ApiError(409, 'This account is already linked to this apartment with a different role.')
  }

  return existingMembership
}

export async function deactivateMembership(membershipId: number) {
  const membership = await findMembershipById(membershipId)
  const { error } = await supabaseAdmin
    .from('apartment_memberships')
    .update({
      status: 'inactive',
      ended_at: new Date().toISOString(),
    })
    .eq('id', membershipId)

  if (error) throw new Error(`Failed to deactivate membership: ${error.message}`)
  if (membership) {
    invalidateMembershipCacheForApartment(membership.apartmentId)
    invalidateMembershipCacheForAccount(membership.accountId)
  }
}

export async function assertAccountCanReceiveInviteJoin(accountId: number, role: AuthMembership['role']) {
  const existingMembership = await findActiveMembershipByAccountId(accountId)
  if (!existingMembership) return

  if (existingMembership.role !== role) {
    throw new ApiError(409, 'This account is already linked to another active apartment role.')
  }

  throw new ApiError(409, 'This account is already linked to an active apartment.')
}
