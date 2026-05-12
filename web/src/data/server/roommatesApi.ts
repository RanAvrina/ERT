import { apiRequest } from '../../lib/api/client'

export async function createRoommateMembershipViaApi(input: {
  apartmentId: number
  accountId: number
  role: 'tenant' | 'landlord'
}) {
  return apiRequest<{
    membership: {
      id: number
      apartmentId: number
      accountId: number
      role: 'tenant' | 'landlord'
      status: 'active' | 'inactive'
    }
  }>(`/apartments/${input.apartmentId}/roommates`, {
    method: 'POST',
    body: JSON.stringify({
      accountId: input.accountId,
      role: input.role,
    }),
  })
}

export async function removeRoommateViaApi(apartmentId: number, membershipId: number) {
  return apiRequest<null>(`/apartments/${apartmentId}/roommates/${membershipId}`, {
    method: 'DELETE',
  })
}
