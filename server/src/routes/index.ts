import { Router } from 'express'
import { apartmentInfoRouter } from './apartment-info.js'
import { apartmentInvitesRouter } from './apartment-invites.js'
import { apartmentsRouter } from './apartments.js'
import { authRouter } from './auth.js'
import { expensesRouter } from './expenses.js'
import { healthRouter } from './health.js'
import { homeItemsRouter } from './home-items.js'
import { invitesRouter } from './invites.js'
import { paymentsRouter } from './payments.js'
import { roommatesRouter } from './roommates.js'
import { shoppingRouter } from './shopping.js'
import { tasksRouter } from './tasks.js'
import { ticketsRouter } from './tickets.js'

export const apiRouter = Router()

apiRouter.use('/health', healthRouter)
apiRouter.use('/auth', authRouter)
apiRouter.use('/invites', invitesRouter)
apiRouter.use('/apartments/:apartmentId/roommates', roommatesRouter)
apiRouter.use('/apartments/:apartmentId/invites', apartmentInvitesRouter)
apiRouter.use('/apartments/:apartmentId/expenses', expensesRouter)
apiRouter.use('/apartments/:apartmentId/payments', paymentsRouter)
apiRouter.use('/apartments/:apartmentId/tasks', tasksRouter)
apiRouter.use('/apartments/:apartmentId/home-items', homeItemsRouter)
apiRouter.use('/apartments/:apartmentId/shopping', shoppingRouter)
apiRouter.use('/apartments/:apartmentId/tickets', ticketsRouter)
apiRouter.use('/apartments/:apartmentId/apartment-info', apartmentInfoRouter)
apiRouter.use('/apartments', apartmentsRouter)
