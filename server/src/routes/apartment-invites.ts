import { Router } from 'express'
import { z } from 'zod'
import { authenticate } from '../middleware/authenticate.js'
import { requireAuth } from '../middleware/require-auth.js'
import { requireApartmentMembership } from '../middleware/require-apartment-membership.js'
import { requireRole } from '../middleware/require-role.js'
import { getApartmentIdFromParams } from '../lib/request.js'
import { validateBody } from '../lib/validate.js'
import { createInvite, listInvitesByApartmentId } from '../services/invite-service.js'

const createInviteSchema = z.object({
  invitedRole: z.enum(['tenant', 'landlord']),
  expiresAt: z.string().datetime().nullable().optional(),
})

export const apartmentInvitesRouter = Router({ mergeParams: true })

apartmentInvitesRouter.use(authenticate, requireAuth, requireApartmentMembership)

apartmentInvitesRouter.get('/', requireRole(['admin']), async (request, response, next) => {
  try {
    const apartmentId = getApartmentIdFromParams(request)
    const invites = await listInvitesByApartmentId(apartmentId)
    response.json({ invites })
  } catch (error) {
    next(error)
  }
})

apartmentInvitesRouter.post('/', requireRole(['admin']), async (request, response, next) => {
  try {
    const apartmentId = getApartmentIdFromParams(request)
    const body = validateBody(createInviteSchema, request.body)
    const invite = await createInvite({
      apartmentId,
      invitedRole: body.invitedRole,
      createdByAccountId: request.auth!.account.id,
      expiresAt: body.expiresAt ?? null,
    })
    response.status(201).json({ invite })
  } catch (error) {
    next(error)
  }
})
