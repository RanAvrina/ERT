import type { InviteRole, PendingInvite } from '../../utils/invite'
import type { InviteRow } from '../../types/database'
import { supabase } from '../../lib/supabase/client'
import { ensureSupabaseResult, ensureValue } from './errors'
import { isInviteUsable, mapInviteInsert } from './mappers'

const table = 'invites'

export async function createInviteRow(input: {
  apartmentId: number
  role: InviteRole
  token: string
  createdByAccountId: number
  expiresAt?: string | null
}) {
  const client = ensureValue(supabase, 'Supabase client is not configured.')
  const { data, error } = await client
    .from(table)
    .insert(mapInviteInsert(input))
    .select('*')
    .single()
  ensureSupabaseResult(error, 'Failed to create invite')
  return data as InviteRow
}

export async function findInviteByToken(token: string) {
  const client = ensureValue(supabase, 'Supabase client is not configured.')
  const { data, error } = await client
    .from(table)
    .select('*')
    .eq('token', token)
    .limit(1)
    .maybeSingle()
  ensureSupabaseResult(error, 'Failed to load invite')
  return (data as InviteRow | null) ?? null
}

export async function readUsableInvite(token: string): Promise<PendingInvite | null> {
  const row = await findInviteByToken(token)
  if (!row || !isInviteUsable(row)) return null
  return {
    apartmentId: row.apartment_id,
    role: row.invited_role,
    token: row.token,
  }
}

export async function acceptInvite(token: string, acceptedByAccountId: number) {
  const client = ensureValue(supabase, 'Supabase client is not configured.')
  const { data, error } = await client
    .from(table)
    .update({
      status: 'accepted',
      accepted_by_account_id: acceptedByAccountId,
      accepted_at: new Date().toISOString(),
    })
    .eq('token', token)
    .eq('status', 'active')
    .select('*')
    .single()
  ensureSupabaseResult(error, 'Failed to accept invite')
  return data as InviteRow
}
