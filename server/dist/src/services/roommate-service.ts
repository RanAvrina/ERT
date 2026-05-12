import { requireAccountById } from './account-service.js'
import { listActiveMembershipsByApartmentId } from './membership-service.js'

export async function listRoommatesByApartmentId(apartmentId: number) {
  const memberships = await listActiveMembershipsByApartmentId(apartmentId)

  return Promise.all(
    memberships.map(async (membership) => {
      const account = await requireAccountById(membership.account_id)
      return {
        id: membership.id,
        apartmentId: membership.apartment_id,
        accountId: membership.account_id,
        role: membership.role,
        status: membership.status,
        joinedAt: membership.joined_at,
        account,
      }
    }),
  )
}
