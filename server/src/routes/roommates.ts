import { Router } from 'express'
import { authenticate } from '../middleware/authenticate.js'
import { requireAuth } from '../middleware/require-auth.js'
import { requireApartmentMembership } from '../middleware/require-apartment-membership.js'
import { requireRole } from '../middleware/require-role.js'
import { getApartmentIdFromParams, getResourceIdFromParams } from '../lib/request.js'
import {
  deactivateMembership,
  ensureMembership,
  findActiveMembershipByApartmentAndAccount,
} from '../services/membership-service.js'
import { listRoommatesByApartmentId } from '../services/roommate-service.js'
import { validateBody } from '../lib/validate.js'
import { ApiError } from '../lib/api-error.js'
import { z } from 'zod'

export const roommatesRouter = Router({ mergeParams: true })

const createMembershipSchema = z.object({
  accountId: z.number().int().positive(),
  role: z.enum(['tenant', 'landlord']),
})

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

roommatesRouter.post('/', requireRole(['admin']), async (request, response, next) => {
  try {
    const apartmentId = getApartmentIdFromParams(request)
    const body = validateBody(createMembershipSchema, request.body)
    const membership = await ensureMembership({
      apartmentId,
      accountId: body.accountId,
      role: body.role,
    })

    response.status(201).json({ membership })
  } catch (error) {
    next(error)
  }
})

roommatesRouter.delete('/:accountId', requireRole(['admin']), async (request, response, next) => {
  try {
    const apartmentId = getApartmentIdFromParams(request)
    const accountId = getResourceIdFromParams(request, 'accountId')
    const membership = await findActiveMembershipByApartmentAndAccount(apartmentId, accountId)

    if (!membership) {
      throw new ApiError(404, 'Account membership was not found in this apartment.')
    }

    await deactivateMembership(membership.id)
    response.status(204).send()
  } catch (error) {
    next(error)
  }
})
