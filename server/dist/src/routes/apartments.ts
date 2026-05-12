import { Router } from 'express'
import { z } from 'zod'
import { getApartmentAccessSnapshot, getApartmentStateSnapshot, listApartmentsByAccountId, createApartmentForAccount, requireApartmentById } from '../services/apartment-service.js'
import { authenticate } from '../middleware/authenticate.js'
import { requireAuth } from '../middleware/require-auth.js'
import { requireApartmentMembership } from '../middleware/require-apartment-membership.js'
import { validateBody } from '../lib/validate.js'
import { getApartmentIdFromParams } from '../lib/request.js'

const createApartmentSchema = z.object({
  name: z.string().trim().min(1, 'Apartment name is required.').max(160),
})

export const apartmentsRouter = Router()

apartmentsRouter.use(authenticate, requireAuth)

apartmentsRouter.get('/', async (request, response, next) => {
  try {
    const apartments = await listApartmentsByAccountId(request.auth!.account.id)
    response.json({ apartments })
  } catch (error) {
    next(error)
  }
})

apartmentsRouter.post('/', async (request, response, next) => {
  try {
    const body = validateBody(createApartmentSchema, request.body)
    const apartment = await createApartmentForAccount({
      accountId: request.auth!.account.id,
      name: body.name,
    })
    response.status(201).json({ apartment })
  } catch (error) {
    next(error)
  }
})

apartmentsRouter.get('/:apartmentId', requireApartmentMembership, async (request, response, next) => {
  try {
    const apartmentId = getApartmentIdFromParams(request)
    const apartment = await requireApartmentById(apartmentId)
    response.json({
      apartment,
      membership: request.auth?.membership ?? null,
    })
  } catch (error) {
    next(error)
  }
})

apartmentsRouter.get('/:apartmentId/access', requireApartmentMembership, async (request, response, next) => {
  try {
    const apartmentId = getApartmentIdFromParams(request)
    const snapshot = await getApartmentAccessSnapshot(apartmentId)
    response.json({
      ok: true,
      ...snapshot,
      membership: request.auth?.membership ?? null,
    })
  } catch (error) {
    next(error)
  }
})

apartmentsRouter.get('/:apartmentId/state', requireApartmentMembership, async (request, response, next) => {
  try {
    const apartmentId = getApartmentIdFromParams(request)
    const state = await getApartmentStateSnapshot(apartmentId)
    response.json({
      ...state,
      membership: request.auth?.membership ?? null,
    })
  } catch (error) {
    next(error)
  }
})
