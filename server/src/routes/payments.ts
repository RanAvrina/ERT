import type { RequestHandler } from 'express'
import { Router } from 'express'
import { z } from 'zod'
import { authenticate } from '../middleware/authenticate.js'
import { requireAuth } from '../middleware/require-auth.js'
import { requireApartmentMembership } from '../middleware/require-apartment-membership.js'
import { requireRole } from '../middleware/require-role.js'
import { getApartmentIdFromParams, getResourceIdFromParams } from '../lib/request.js'
import { validateBody } from '../lib/validate.js'
import { createPayment, listPaymentsByApartmentId, softDeletePayment, updatePayment } from '../services/finance-service.js'

const paymentBodySchema = z.object({
  payerAccountId: z.number().int().positive(),
  payeeAccountId: z.number().int().positive(),
  amount: z.string().min(1),
  paymentDate: z.string().min(1),
  note: z.string().nullable().optional(),
})

export const paymentsRouter = Router({ mergeParams: true })

paymentsRouter.use(authenticate, requireAuth, requireApartmentMembership, requireRole(['admin', 'tenant']))

paymentsRouter.get('/', async (request, response, next) => {
  try {
    const apartmentId = getApartmentIdFromParams(request)
    const payments = await listPaymentsByApartmentId(apartmentId)
    response.json({ payments })
  } catch (error) {
    next(error)
  }
})

paymentsRouter.post('/', async (request, response, next) => {
  try {
    const apartmentId = getApartmentIdFromParams(request)
    const body = validateBody(paymentBodySchema, request.body)
    const payment = await createPayment({
      apartmentId,
      ...body,
      note: body.note ?? null,
    })
    response.status(201).json({ payment })
  } catch (error) {
    next(error)
  }
})

const updatePaymentHandler: RequestHandler = async (request, response, next) => {
  try {
    const apartmentId = getApartmentIdFromParams(request)
    const paymentId = getResourceIdFromParams(request, 'paymentId')
    const body = validateBody(paymentBodySchema, request.body)
    const payment = await updatePayment({
      apartmentId,
      paymentId,
      ...body,
      note: body.note ?? null,
    })
    response.json({ payment })
  } catch (error) {
    next(error)
  }
}

paymentsRouter.patch('/:paymentId', updatePaymentHandler)

paymentsRouter.put('/:paymentId', updatePaymentHandler)

paymentsRouter.delete('/:paymentId', async (request, response, next) => {
  try {
    const paymentId = getResourceIdFromParams(request, 'paymentId')
    await softDeletePayment(paymentId)
    response.status(204).send()
  } catch (error) {
    next(error)
  }
})
