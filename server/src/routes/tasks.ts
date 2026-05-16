import { Router } from 'express'
import { z } from 'zod'
import { authenticate } from '../middleware/authenticate.js'
import { requireAuth } from '../middleware/require-auth.js'
import { requireApartmentMembership } from '../middleware/require-apartment-membership.js'
import { requireRole } from '../middleware/require-role.js'
import { getApartmentIdFromParams, getResourceIdFromParams } from '../lib/request.js'
import { validateBody } from '../lib/validate.js'
import { createTask, deleteTask, listTasksByApartmentId, updateTask } from '../services/task-service.js'

const taskBodySchema = z.object({
  title: z.string().trim().min(1),
  description: z.string().nullable().optional(),
  assigneeAccountId: z.number().int().positive().nullable(),
  dueDate: z.string().nullable(),
  status: z.enum(['open', 'in_progress', 'done', 'cancelled']),
})

export const tasksRouter = Router({ mergeParams: true })

tasksRouter.use(authenticate, requireAuth, requireApartmentMembership, requireRole(['admin', 'tenant']))

tasksRouter.get('/', async (request, response, next) => {
  try {
    const apartmentId = getApartmentIdFromParams(request)
    const tasks = await listTasksByApartmentId(apartmentId)
    response.json({ tasks })
  } catch (error) {
    next(error)
  }
})

tasksRouter.post('/', async (request, response, next) => {
  try {
    const apartmentId = getApartmentIdFromParams(request)
    const body = validateBody(taskBodySchema, request.body)
    const task = await createTask({
      apartmentId,
      ...body,
      description: body.description ?? null,
      createdByAccountId: request.auth!.account.id,
    })
    response.status(201).json({ task })
  } catch (error) {
    next(error)
  }
})

tasksRouter.patch('/:taskId', async (request, response, next) => {
  try {
    const apartmentId = getApartmentIdFromParams(request)
    const taskId = getResourceIdFromParams(request, 'taskId')
    const body = validateBody(taskBodySchema, request.body)
    const task = await updateTask({
      apartmentId,
      taskId,
      ...body,
      description: body.description ?? null,
    })
    response.json({ task })
  } catch (error) {
    next(error)
  }
})

tasksRouter.put('/:taskId', async (request, response, next) => {
  try {
    const apartmentId = getApartmentIdFromParams(request)
    const taskId = getResourceIdFromParams(request, 'taskId')
    const body = validateBody(taskBodySchema, request.body)
    const task = await updateTask({
      apartmentId,
      taskId,
      ...body,
      description: body.description ?? null,
    })
    response.json({ task })
  } catch (error) {
    next(error)
  }
})

tasksRouter.delete('/:taskId', async (request, response, next) => {
  try {
    const apartmentId = getApartmentIdFromParams(request)
    const taskId = getResourceIdFromParams(request, 'taskId')
    await deleteTask(apartmentId, taskId)
    response.status(204).send()
  } catch (error) {
    next(error)
  }
})
