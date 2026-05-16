import { Router } from 'express'
import { z } from 'zod'
import { authenticate } from '../middleware/authenticate.js'
import { requireAuth } from '../middleware/require-auth.js'
import { requireApartmentMembership } from '../middleware/require-apartment-membership.js'
import { requireRole } from '../middleware/require-role.js'
import { getApartmentIdFromParams, getResourceIdFromParams } from '../lib/request.js'
import { validateBody } from '../lib/validate.js'
import { createShoppingItem, deleteShoppingItem, listShoppingItemsByApartmentId, updateShoppingItem } from '../services/shopping-service.js'

const shoppingBodySchema = z.object({
  itemName: z.string().trim().min(1),
  quantity: z.string().nullable().optional(),
  category: z.string().nullable().optional(),
  status: z.enum(['open', 'purchased', 'cancelled']),
  purchasedByAccountId: z.number().int().positive().nullable().optional(),
  purchasedAt: z.string().nullable().optional(),
})

export const shoppingRouter = Router({ mergeParams: true })

shoppingRouter.use(authenticate, requireAuth, requireApartmentMembership, requireRole(['admin', 'tenant']))

shoppingRouter.get('/', async (request, response, next) => {
  try {
    const apartmentId = getApartmentIdFromParams(request)
    const items = await listShoppingItemsByApartmentId(apartmentId)
    response.json({ items })
  } catch (error) {
    next(error)
  }
})

shoppingRouter.post('/', async (request, response, next) => {
  try {
    const apartmentId = getApartmentIdFromParams(request)
    const body = validateBody(shoppingBodySchema, request.body)
    const item = await createShoppingItem({
      apartmentId,
      actorAccountId: request.auth!.account.id,
      itemName: body.itemName,
      quantity: body.quantity ?? null,
      category: body.category ?? null,
      status: body.status,
    })
    response.status(201).json({ item })
  } catch (error) {
    next(error)
  }
})

shoppingRouter.patch('/:itemId', async (request, response, next) => {
  try {
    const apartmentId = getApartmentIdFromParams(request)
    const itemId = getResourceIdFromParams(request, 'itemId')
    const body = validateBody(shoppingBodySchema, request.body)
    const item = await updateShoppingItem({
      apartmentId,
      itemId,
      actorAccountId: request.auth!.account.id,
      itemName: body.itemName,
      quantity: body.quantity ?? null,
      category: body.category ?? null,
      status: body.status,
      purchasedByAccountId: body.purchasedByAccountId ?? null,
      purchasedAt: body.purchasedAt ?? null,
    })
    response.json({ item })
  } catch (error) {
    next(error)
  }
})

shoppingRouter.put('/:itemId', async (request, response, next) => {
  try {
    const apartmentId = getApartmentIdFromParams(request)
    const itemId = getResourceIdFromParams(request, 'itemId')
    const body = validateBody(shoppingBodySchema, request.body)
    const item = await updateShoppingItem({
      apartmentId,
      itemId,
      actorAccountId: request.auth!.account.id,
      itemName: body.itemName,
      quantity: body.quantity ?? null,
      category: body.category ?? null,
      status: body.status,
      purchasedByAccountId: body.purchasedByAccountId ?? null,
      purchasedAt: body.purchasedAt ?? null,
    })
    response.json({ item })
  } catch (error) {
    next(error)
  }
})

shoppingRouter.delete('/:itemId', async (request, response, next) => {
  try {
    const apartmentId = getApartmentIdFromParams(request)
    const itemId = getResourceIdFromParams(request, 'itemId')
    await deleteShoppingItem(apartmentId, itemId)
    response.status(204).send()
  } catch (error) {
    next(error)
  }
})
