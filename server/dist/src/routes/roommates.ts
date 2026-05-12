import { Router } from 'express'
import { authenticate } from '../middleware/authenticate.js'
import { requireAuth } from '../middleware/require-auth.js'
import { requireApartmentMembership } from '../middleware/require-apartment-membership.js'
import { requireRole } from '../middleware/require-role.js'
import { getApartmentIdFromParams, getResourceIdFromParams } from '../lib/request.js'
import { deactivateMembership, findMembershipById } from '../services/membership-service.js'
import { listRoommatesByApartmentId } from '../services/roommate-service.js'
import { ApiError } from '../lib/api-error.js'

export const roommatesRouter = Router({ mergeParams: true })

roommatesRouter.use(authenticate, requireAuth, requireApartmentMembership)

roommatesRouter.get('/', async (request, response, next) => {
  try {
    const apartmentId = getApartmentIdFromParams(request)
    const roommates = await listRoommatesByApartmentId(apartmentId)
    response.json({ roommates })
  } catch (error) {
    next(error)
  }
})

roommatesRouter.delete('/:membershipId', requireRole(['admin']), async (request, response, next) => {
  try {
    const apartmentId = getApartmentIdFromParams(request)
    const membershipId = getResourceIdFromParams(request, 'membershipId')
    const membership = await findMembershipById(membershipId)

    if (!membership || membership.apartmentId !== apartmentId) {
      throw new ApiError(404, 'Membership was not found in this apartment.')
    }

    await deactivateMembership(membershipId)
    response.status(204).send()
  } catch (error) {
    next(error)
  }
})
