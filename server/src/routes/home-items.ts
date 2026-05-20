import { Router } from 'express'
import { z } from 'zod'
import { authenticate } from '../middleware/authenticate.js'
import { requireAuth } from '../middleware/require-auth.js'
import { requireApartmentMembership } from '../middleware/require-apartment-membership.js'
import { getApartmentIdFromParams, getResourceIdFromParams } from '../lib/request.js'
import { validateBody } from '../lib/validate.js'
import {
  createApartmentHomeItem,
  deleteApartmentHomeItem,
  listHomeItemsByApartmentId,
  updateApartmentHomeItem,
} from '../services/home-item-service.js'

const createHomeItemSchema = z.object({
  area: z.string().trim().min(1).max(120),
  name: z.string().trim().min(1).max(160),
  defaultNote: z.string().trim().min(1).max(4000),
})

const updateHomeItemSchema = z.object({
  area: z.string().trim().min(1).max(120),
  name: z.string().trim().min(1).max(160),
  defaultNote: z.string().trim().min(1).max(4000),
})

export const homeItemsRouter = Router({ mergeParams: true })

homeItemsRouter.use(authenticate, requireAuth, requireApartmentMembership)

homeItemsRouter.get('/', async (request, response, next) => {
  try {
    const apartmentId = getApartmentIdFromParams(request)
    const items = await listHomeItemsByApartmentId(apartmentId)
    response.json({ items })
  } catch (error) {
    next(error)
  }
})

homeItemsRouter.post(
  '/',
  async (request, response, next) => {
    try {
      const apartmentId = getApartmentIdFromParams(request)
      const body = validateBody(createHomeItemSchema, request.body)
      const item = await createApartmentHomeItem({
        apartmentId,
        area: body.area,
        name: body.name,
        defaultNote: body.defaultNote,
      })
      response.status(201).json({ item })
    } catch (error) {
      next(error)
    }
  },
)

homeItemsRouter.patch(
  '/:itemId',
  async (request, response, next) => {
    try {
      const apartmentId = getApartmentIdFromParams(request)
      const itemId = getResourceIdFromParams(request, 'itemId')
      const body = validateBody(updateHomeItemSchema, request.body)
      const item = await updateApartmentHomeItem({
        apartmentId,
        itemId,
        area: body.area,
        name: body.name,
        defaultNote: body.defaultNote,
      })
      response.json({ item })
    } catch (error) {
      next(error)
    }
  },
)

homeItemsRouter.delete(
  '/:itemId',
  async (request, response, next) => {
    try {
      const apartmentId = getApartmentIdFromParams(request)
      const itemId = getResourceIdFromParams(request, 'itemId')
      await deleteApartmentHomeItem({
        apartmentId,
        itemId,
      })
      response.status(204).send()
    } catch (error) {
      next(error)
    }
  },
)
