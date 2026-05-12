import { Router } from 'express'
import { z } from 'zod'
import { authenticate } from '../middleware/authenticate.js'
import { requireAuth } from '../middleware/require-auth.js'
import { requireApartmentMembership } from '../middleware/require-apartment-membership.js'
import { getApartmentIdFromParams, getResourceIdFromParams } from '../lib/request.js'
import { validateBody } from '../lib/validate.js'
import { createApartmentInfoItem, deleteApartmentInfoItem, listApartmentInfoItemsByApartmentId, updateApartmentInfoItem } from '../services/apartment-info-service.js'

const attachmentSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1),
  type: z.string().min(1),
  size: z.number().nonnegative(),
  url: z.string().min(1),
})

const apartmentInfoBodySchema = z.object({
  title: z.string().trim().min(1),
  categoryLabel: z.string().nullable().optional(),
  provider: z.string().nullable().optional(),
  meterNumber: z.string().nullable().optional(),
  accountNumber: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  attachments: z.array(attachmentSchema).optional(),
})

export const apartmentInfoRouter = Router({ mergeParams: true })

apartmentInfoRouter.use(authenticate, requireAuth, requireApartmentMembership)

apartmentInfoRouter.get('/', async (request, response, next) => {
  try {
    const apartmentId = getApartmentIdFromParams(request)
    const items = await listApartmentInfoItemsByApartmentId(apartmentId)
    response.json({ items })
  } catch (error) {
    next(error)
  }
})

apartmentInfoRouter.post('/', async (request, response, next) => {
  try {
    const apartmentId = getApartmentIdFromParams(request)
    const body = validateBody(apartmentInfoBodySchema, request.body)
    const item = await createApartmentInfoItem({
      apartmentId,
      title: body.title,
      categoryLabel: body.categoryLabel ?? null,
      provider: body.provider ?? null,
      meterNumber: body.meterNumber ?? null,
      accountNumber: body.accountNumber ?? null,
      phone: body.phone ?? null,
      notes: body.notes ?? null,
      attachments: body.attachments,
    })
    response.status(201).json({ item })
  } catch (error) {
    next(error)
  }
})

apartmentInfoRouter.patch('/:itemId', async (request, response, next) => {
  try {
    const apartmentId = getApartmentIdFromParams(request)
    const itemId = getResourceIdFromParams(request, 'itemId')
    const body = validateBody(apartmentInfoBodySchema, request.body)
    const item = await updateApartmentInfoItem({
      apartmentId,
      itemId,
      title: body.title,
      categoryLabel: body.categoryLabel ?? null,
      provider: body.provider ?? null,
      meterNumber: body.meterNumber ?? null,
      accountNumber: body.accountNumber ?? null,
      phone: body.phone ?? null,
      notes: body.notes ?? null,
      attachments: body.attachments,
    })
    response.json({ item })
  } catch (error) {
    next(error)
  }
})

apartmentInfoRouter.put('/:itemId', async (request, response, next) => {
  try {
    const apartmentId = getApartmentIdFromParams(request)
    const itemId = getResourceIdFromParams(request, 'itemId')
    const body = validateBody(apartmentInfoBodySchema, request.body)
    const item = await updateApartmentInfoItem({
      apartmentId,
      itemId,
      title: body.title,
      categoryLabel: body.categoryLabel ?? null,
      provider: body.provider ?? null,
      meterNumber: body.meterNumber ?? null,
      accountNumber: body.accountNumber ?? null,
      phone: body.phone ?? null,
      notes: body.notes ?? null,
      attachments: body.attachments,
    })
    response.json({ item })
  } catch (error) {
    next(error)
  }
})

apartmentInfoRouter.delete('/:itemId', async (request, response, next) => {
  try {
    const itemId = getResourceIdFromParams(request, 'itemId')
    await deleteApartmentInfoItem(itemId)
    response.status(204).send()
  } catch (error) {
    next(error)
  }
})
