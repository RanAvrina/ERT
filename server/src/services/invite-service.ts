import { randomUUID } from 'node:crypto'
import { ApiError } from '../lib/api-error.js'
import { supabaseAdmin } from '../lib/supabase.js'
import { ensureMembership, findActiveMembershipByAccountId } from './membership-service.js'
import { requireApartmentById } from './apartment-service.js'

interface InviteRow {
  id: number
  apartment_id: number
  invited_role: 'tenant' | 'landlord'
  token: string
  status: 'active' | 'accepted' | 'expired' | 'cancelled'
  created_by_account_id: number
  accepted_by_account_id: number | null
  created_at: string
  accepted_at: string | null
  expires_at: string | null
}

function mapInviteRow(row: InviteRow) {
  return {
    id: row.id,
    apartmentId: row.apartment_id,
    invitedRole: row.invited_role,
    token: row.token,
    status: row.status,
    createdByAccountId: row.created_by_account_id,
    acceptedByAccountId: row.accepted_by_account_id,
    createdAt: row.created_at,
    acceptedAt: row.accepted_at,
    expiresAt: row.expires_at,
  }
}

export async function listInvitesByApartmentId(apartmentId: number) {
  const { data, error } = await supabaseAdmin
    .from('invites')
    .select('*')
    .eq('apartment_id', apartmentId)
    .order('created_at', { ascending: false })

  if (error) throw new Error(`Failed to load invites: ${error.message}`)
  return ((data ?? []) as InviteRow[]).map(mapInviteRow)
}

export async function createInvite(input: {
  apartmentId: number
  invitedRole: 'tenant' | 'landlord'
  createdByAccountId: number
  expiresAt?: string | null
}) {
  await requireApartmentById(input.apartmentId)

  const token = randomUUID()
  const { data, error } = await supabaseAdmin
    .from('invites')
    .insert({
      apartment_id: input.apartmentId,
      invited_role: input.invitedRole,
      token,
      status: 'active',
      created_by_account_id: input.createdByAccountId,
      expires_at: input.expiresAt ?? null,
    })
    .select('*')
    .single()

  if (error) throw new Error(`Failed to create invite: ${error.message}`)
  return mapInviteRow(data as InviteRow)
}

export async function findInviteByToken(token: string) {
  const { data, error } = await supabaseAdmin
    .from('invites')
    .select('*')
    .eq('token', token)
    .limit(1)
    .maybeSingle()

  if (error) throw new Error(`Failed to load invite: ${error.message}`)
  return data ? mapInviteRow(data as InviteRow) : null
}

export async function requireActiveInviteByToken(token: string) {
  const invite = await findInviteByToken(token)
  if (!invite) {
    throw new ApiError(404, 'Invite was not found.')
  }

  if (invite.status !== 'active') {
    throw new ApiError(409, 'Invite is no longer active.')
  }

  if (invite.expiresAt && new Date(invite.expiresAt).getTime() < Date.now()) {
    throw new ApiError(410, 'Invite has expired.')
  }

  const apartment = await requireApartmentById(invite.apartmentId)

  return {
    ...invite,
    apartmentName: apartment.name,
  }
}

export async function acceptInvite(token: string, accountId: number) {
  const invite = await requireActiveInviteByToken(token)
  const existingMembership = await findActiveMembershipByAccountId(accountId)
  if (existingMembership) {
    if (existingMembership.apartmentId !== invite.apartmentId) {
      throw new ApiError(
        409,
        'החשבון כבר משויך לדירה אחרת. אי אפשר לצרף אותו לדירה נוספת.',
      )
    }

    if (existingMembership.role !== invite.invitedRole) {
      throw new ApiError(
        409,
        'החשבון כבר משויך לדירה הזו בתפקיד אחר. אי אפשר להשלים את ההזמנה עם אותו החשבון.',
      )
    }
  }

  const membership = await ensureMembership({
    apartmentId: invite.apartmentId,
    accountId,
    role: invite.invitedRole,
  })

  const { error } = await supabaseAdmin
    .from('invites')
    .update({
      status: 'accepted',
      accepted_by_account_id: accountId,
      accepted_at: new Date().toISOString(),
    })
    .eq('id', invite.id)

  if (error) throw new Error(`Failed to accept invite: ${error.message}`)

  return {
    invite: {
      ...invite,
      status: 'accepted' as const,
      acceptedByAccountId: accountId,
    },
    membership,
  }
}
