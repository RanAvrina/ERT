import { Router } from 'express'
import { z } from 'zod'
import { authenticate, authenticateSession } from '../middleware/authenticate.js'
import { requireAuth } from '../middleware/require-auth.js'
import { validateBody } from '../lib/validate.js'
import { createRateLimit } from '../middleware/rate-limit.js'
import { createAccount, findAccountByEmail } from '../services/account-service.js'
import { findActiveMembershipByAccountId } from '../services/membership-service.js'
import { getApartmentStateSnapshot } from '../services/apartment-service.js'
import { env } from '../config/env.js'

export const authRouter = Router()
authRouter.use(
  createRateLimit({
    windowMs: env.AUTH_RATE_LIMIT_WINDOW_MS,
    max: env.AUTH_RATE_LIMIT_MAX,
  }),
)

const bootstrapAccountSchema = z.object({
  fullName: z.string().trim().min(1),
  phone: z.string().trim().min(1).nullable().optional(),
})

authRouter.get('/me', authenticate, requireAuth, (request, response) => {
  response.json({
    account: request.auth?.account ?? null,
    membership: request.auth?.membership ?? null,
  })
})

authRouter.get('/bootstrap', authenticateSession, async (request, response, next) => {
  try {
    const email = request.authSession?.authEmail
    if (!email) {
      response.status(401).json({ error: 'Authentication is required.' })
      return
    }

    let account = await findAccountByEmail(email)
    if (!account) {
      account = await createAccount({
        email,
        fullName:
          request.authSession?.authFullName?.trim() ||
          email.split('@')[0] ||
          'משתמש חדש',
        phone: request.authSession?.authPhone?.trim() || null,
      })
    }

    const membership = await findActiveMembershipByAccountId(account.id)
    const apartmentState = membership
      ? await getApartmentStateSnapshot(membership.apartmentId)
      : null

    response.json({
      account,
      membership,
      apartmentState,
    })
  } catch (error) {
    next(error)
  }
})

authRouter.post('/account', authenticateSession, async (request, response, next) => {
  try {
    const body = validateBody(bootstrapAccountSchema, request.body)
    const email = request.authSession?.authEmail

    if (!email) {
      response.status(401).json({ error: 'Authentication is required.' })
      return
    }

    const existing = await findAccountByEmail(email)
    if (existing) {
      response.status(200).json({ account: existing })
      return
    }

    const account = await createAccount({
      email,
      fullName: body.fullName,
      phone: body.phone ?? null,
    })

    response.status(201).json({ account })
  } catch (error) {
    next(error)
  }
})
