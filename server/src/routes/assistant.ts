import { Router } from 'express'
import { z } from 'zod'
import { validateBody } from '../lib/validate.js'
import { authenticate } from '../middleware/authenticate.js'
import { requireApartmentMembership } from '../middleware/require-apartment-membership.js'
import { requireAuth } from '../middleware/require-auth.js'
import {
  answerAssistantQuestion,
  getAssistantContextSnapshot,
} from '../services/assistant-service.js'
import {
  cancelAssistantAction,
  executeAssistantAction,
} from '../services/assistant-action-service.js'

export const assistantRouter = Router({ mergeParams: true })

const assistantQuestionSchema = z.object({
  question: z.string().trim().min(1),
})

const assistantActionSchema = z.object({
  token: z.string().uuid(),
})

assistantRouter.get(
  '/context',
  authenticate,
  requireAuth,
  requireApartmentMembership,
  async (request, response, next) => {
    try {
      const apartmentId = Number(request.params.apartmentId)
      const context = await getAssistantContextSnapshot(apartmentId)
      response.json({ context })
    } catch (error) {
      next(error)
    }
  },
)

assistantRouter.post(
  '/query',
  authenticate,
  requireAuth,
  requireApartmentMembership,
  async (request, response, next) => {
    try {
      const apartmentId = Number(request.params.apartmentId)
      const body = validateBody(assistantQuestionSchema, request.body)
      if (!request.auth) {
        response.status(401).json({ error: 'Authentication is required.' })
        return
      }

      const result = await answerAssistantQuestion(apartmentId, body.question, request.auth.account)
      response.json(result)
    } catch (error) {
      next(error)
    }
  },
)

assistantRouter.post(
  '/action/confirm',
  authenticate,
  requireAuth,
  requireApartmentMembership,
  async (request, response, next) => {
    try {
      const apartmentId = Number(request.params.apartmentId)
      const body = validateBody(assistantActionSchema, request.body)
      if (!request.auth) {
        response.status(401).json({ error: 'Authentication is required.' })
        return
      }

      const result = await executeAssistantAction({
        token: body.token,
        apartmentId,
        account: request.auth.account,
      })
      response.json(result)
    } catch (error) {
      next(error)
    }
  },
)

assistantRouter.post(
  '/action/cancel',
  authenticate,
  requireAuth,
  requireApartmentMembership,
  async (request, response, next) => {
    try {
      const apartmentId = Number(request.params.apartmentId)
      const body = validateBody(assistantActionSchema, request.body)
      if (!request.auth) {
        response.status(401).json({ error: 'Authentication is required.' })
        return
      }

      cancelAssistantAction({
        token: body.token,
        apartmentId,
        accountId: request.auth.account.id,
      })
      response.status(204).send()
    } catch (error) {
      next(error)
    }
  },
)
