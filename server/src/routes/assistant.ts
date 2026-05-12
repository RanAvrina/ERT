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

export const assistantRouter = Router({ mergeParams: true })

const assistantQuestionSchema = z.object({
  question: z.string().trim().min(1),
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
      const result = await answerAssistantQuestion(apartmentId, body.question)
      response.json(result)
    } catch (error) {
      next(error)
    }
  },
)
