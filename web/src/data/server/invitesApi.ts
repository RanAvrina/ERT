import { apiRequest } from '../../lib/api/client'
import type { PendingInvite, InviteRole } from '../../utils/invite'

interface InviteApiResponse {
  invite: {
    apartmentId: number
    apartmentName?: string
    invitedRole: InviteRole
    token: string
    status: 'active' | 'accepted' | 'expired' | 'cancelled'
    expiresAt: string | null
  }
}

export async function createInviteViaApi(input: {
  apartmentId: number
  invitedRole: InviteRole
  expiresAt?: string | null
}) {
  return apiRequest<InviteApiResponse>(`/apartments/${input.apartmentId}/invites`, {
    method: 'POST',
    body: JSON.stringify({
      invitedRole: input.invitedRole,
      expiresAt: input.expiresAt ?? null,
    }),
  })
}

export async function readUsableInviteViaApi(token: string): Promise<PendingInvite | null> {
  try {
    const response = await apiRequest<InviteApiResponse>(`/invites/${token}`, {
      method: 'GET',
      authenticated: false,
    })

    if (response.invite.status !== 'active') return null

    return {
      apartmentId: response.invite.apartmentId,
      role: response.invite.invitedRole,
      token: response.invite.token,
      apartmentName: response.invite.apartmentName,
    }
  } catch {
    return null
  }
}

export async function acceptInviteViaApi(token: string) {
  return apiRequest<{
    invite: InviteApiResponse['invite']
    membership: {
      id: number
      apartmentId: number
      accountId: number
      role: 'admin' | 'tenant' | 'landlord'
      status: 'active' | 'inactive'
    }
  }>(`/invites/${token}/accept`, {
    method: 'POST',
  })
}
