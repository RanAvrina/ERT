import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { ApiError } from '../lib/api-error.js'
import { getApartmentStateSnapshot } from './apartment-service.js'
import { createExpense } from './finance-service.js'
import { createShoppingItem } from './shopping-service.js'
import { createTask, listTasksByApartmentId, updateTask } from './task-service.js'
import { createTicket } from './ticket-service.js'

const taskTypeSchema = z.enum(['cleaning', 'maintenance', 'shopping', 'inspection', 'other'])
const taskStatusSchema = z.enum(['open', 'in_progress', 'done', 'cancelled'])
const ticketCategorySchema = z.enum(['issue', 'request', 'finance', 'other'])

const createTaskActionSchema = z
  .object({
    type: z.literal('create_task'),
    payload: z.object({
      title: z.string().trim().min(1).optional(),
      taskType: taskTypeSchema.optional(),
      targetItemName: z.string().trim().min(1).optional(),
      description: z.string().trim().optional().nullable(),
      assigneeName: z.string().trim().optional().nullable(),
      dueDate: z.string().trim().optional().nullable(),
    }),
  })
  .refine((value) => Boolean(value.payload.title || value.payload.targetItemName), {
    message: 'Task action must include a title or target item name.',
  })

const updateTaskDueDateActionSchema = z
  .object({
    type: z.literal('update_task_due_date'),
    payload: z.object({
      taskId: z.number().int().positive().optional(),
      taskTitle: z.string().trim().min(1).optional(),
      dueDate: z.string().trim().min(1),
    }),
  })
  .refine((value) => Boolean(value.payload.taskId || value.payload.taskTitle), {
    message: 'Task due date update must include taskId or taskTitle.',
  })

const updateTaskStatusActionSchema = z
  .object({
    type: z.literal('update_task_status'),
    payload: z.object({
      taskId: z.number().int().positive().optional(),
      taskTitle: z.string().trim().min(1).optional(),
      status: taskStatusSchema,
    }),
  })
  .refine((value) => Boolean(value.payload.taskId || value.payload.taskTitle), {
    message: 'Task status update must include taskId or taskTitle.',
  })

const createExpenseActionSchema = z.object({
  type: z.literal('create_expense'),
  payload: z.object({
    description: z.string().trim().min(1),
    amount: z.coerce.number().positive(),
    category: z.string().trim().optional().nullable(),
    date: z.string().trim().optional().nullable(),
    paidByName: z.string().trim().optional().nullable(),
    participantNames: z.array(z.string().trim().min(1)).optional().nullable(),
  }),
})

const createShoppingItemActionSchema = z.object({
  type: z.literal('create_shopping_item'),
  payload: z.object({
    itemName: z.string().trim().min(1),
    quantity: z.string().trim().optional().nullable(),
    category: z.string().trim().optional().nullable(),
  }),
})

const createTicketActionSchema = z.object({
  type: z.literal('create_ticket'),
  payload: z.object({
    title: z.string().trim().min(1),
    description: z.string().trim().min(1),
    category: ticketCategorySchema.optional(),
  }),
})

const agentActionSchema = z.discriminatedUnion('type', [
  createTaskActionSchema,
  updateTaskDueDateActionSchema,
  updateTaskStatusActionSchema,
  createExpenseActionSchema,
  createShoppingItemActionSchema,
  createTicketActionSchema,
])

type AgentAction = z.infer<typeof agentActionSchema>

interface PendingAgentActionEntry {
  token: string
  accountId: number
  apartmentId: number
  action: AgentAction
  expiresAt: number
}

const PENDING_ACTION_TTL_MS = 10 * 60 * 1000
const pendingAgentActions = new Map<string, PendingAgentActionEntry>()

function cleanupExpiredPendingActions() {
  const now = Date.now()
  for (const [token, entry] of pendingAgentActions.entries()) {
    if (entry.expiresAt <= now) {
      pendingAgentActions.delete(token)
    }
  }
}

function normalizeAgentActionValue(value: unknown) {
  if (!value || typeof value !== "object") return null

  const candidate = value as { type?: unknown; payload?: unknown }
  if (typeof candidate.type === 'string') {
    return candidate
  }

  const entries = Object.entries(value as Record<string, unknown>)
  if (entries.length !== 1) return null
  const [type, payload] = entries[0]
  return { type, payload }
}

function normalizeDate(value: string | null | undefined) {
  const text = value?.trim() ?? ''
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : new Date().toISOString().slice(0, 10)
}

function resolveTaskTitle(action: z.infer<typeof createTaskActionSchema>) {
  const title = action.payload.title?.trim()
  if (title) return title
  return action.payload.targetItemName!.trim()
}

function buildPendingActionSummary(action: AgentAction) {
  switch (action.type) {
    case 'create_task':
      return `פתיחת מטלה: ${resolveTaskTitle(action)}`
    case 'update_task_due_date':
      return `עדכון תאריך למטלה: ${action.payload.taskTitle ?? `#${action.payload.taskId}`}`
    case 'update_task_status':
      return `עדכון סטטוס למטלה: ${action.payload.taskTitle ?? `#${action.payload.taskId}`}`
    case 'create_expense':
      return `הוספת הוצאה: ${action.payload.description}${
        action.payload.participantNames?.length
          ? ` (${action.payload.participantNames.join(', ')})`
          : ''
      }`
    case 'create_shopping_item':
      return `הוספת פריט קנייה: ${action.payload.itemName}`
    case 'create_ticket':
      return `פתיחת פנייה: ${action.payload.title}`
  }
}

async function getActiveUsers(apartmentId: number) {
  const state = await getApartmentStateSnapshot(apartmentId)
  return state.users.filter((user) => user.status === 'active')
}

async function findAccountIdByName(apartmentId: number, requestedName?: string | null) {
  const activeUsers = await getActiveUsers(apartmentId)
  const normalizedName = requestedName?.trim()
  if (!normalizedName) return null

  const exactMatch = activeUsers.find((user) => user.name === normalizedName)
  if (exactMatch) return exactMatch.id

  const partialMatches = activeUsers.filter((user) => user.name.includes(normalizedName))
  if (partialMatches.length === 1) return partialMatches[0].id
  if (partialMatches.length > 1) {
    throw new ApiError(409, `יש יותר מדייר אחד שמתאים לשם "${normalizedName}".`)
  }

  throw new ApiError(404, `לא נמצא דייר בשם "${normalizedName}".`)
}

async function resolveParticipantAccountIds(
  apartmentId: number,
  requestedNames: string[] | null | undefined,
) {
  const activeUsers = await getActiveUsers(apartmentId)

  if (!requestedNames?.length) {
    return activeUsers.map((user) => user.id)
  }

  const participantIds = new Set<number>()

  for (const rawName of requestedNames) {
    const normalizedName = rawName.trim()
    if (!normalizedName) continue

    const exactMatch = activeUsers.find((user) => user.name === normalizedName)
    if (exactMatch) {
      participantIds.add(exactMatch.id)
      continue
    }

    const partialMatches = activeUsers.filter((user) => user.name.includes(normalizedName))
    if (partialMatches.length === 1) {
      participantIds.add(partialMatches[0].id)
      continue
    }
    if (partialMatches.length > 1) {
      throw new ApiError(409, `יש יותר מדייר אחד שמתאים לשם "${normalizedName}".`)
    }

    throw new ApiError(404, `לא נמצא דייר בשם "${normalizedName}".`)
  }

  return participantIds.size ? [...participantIds] : activeUsers.map((user) => user.id)
}

async function findTaskForAction(apartmentId: number, taskId?: number, taskTitle?: string) {
  const tasks = await listTasksByApartmentId(apartmentId)
  if (taskId) {
    const task = tasks.find((candidate) => candidate.id === taskId)
    if (!task) throw new ApiError(404, 'המטלה לא נמצאה.')
    return task
  }

  const normalizedTitle = taskTitle?.trim()
  if (!normalizedTitle) throw new ApiError(400, 'חסר מזהה מטלה לעדכון.')

  const exactMatch = tasks.find((task) => task.title === normalizedTitle)
  if (exactMatch) return exactMatch

  const partialMatches = tasks.filter((task) => task.title.includes(normalizedTitle))
  if (!partialMatches.length) {
    throw new ApiError(404, 'המטלה לא נמצאה.')
  }
  if (partialMatches.length > 1) {
    throw new ApiError(409, `יש יותר ממטלה אחת שמתאימה ל-"${normalizedTitle}".`)
  }
  return partialMatches[0]
}

export function validateAgentAction(value: unknown) {
  const normalizedValue = normalizeAgentActionValue(value)
  if (!normalizedValue) return null
  return agentActionSchema.parse(normalizedValue)
}

export function createPendingAgentAction(input: {
  accountId: number
  apartmentId: number
  action: AgentAction
}) {
  cleanupExpiredPendingActions()
  const token = randomUUID()
  pendingAgentActions.set(token, {
    token,
    accountId: input.accountId,
    apartmentId: input.apartmentId,
    action: input.action,
    expiresAt: Date.now() + PENDING_ACTION_TTL_MS,
  })

  return {
    token,
    type: input.action.type,
    summary: buildPendingActionSummary(input.action),
    expiresAt: new Date(Date.now() + PENDING_ACTION_TTL_MS).toISOString(),
  }
}

export async function confirmPendingAgentAction(input: {
  token: string
  accountId: number
  apartmentId: number
}) {
  cleanupExpiredPendingActions()
  const pendingAction = pendingAgentActions.get(input.token)
  if (!pendingAction) {
    throw new ApiError(404, 'הפעולה הממתינה לא נמצאה או פגה.')
  }

  if (pendingAction.accountId !== input.accountId || pendingAction.apartmentId !== input.apartmentId) {
    throw new ApiError(403, 'אין לך הרשאה לאשר את הפעולה הזו.')
  }

  const { action } = pendingAction
  let message = 'הפעולה בוצעה.'

  switch (action.type) {
    case 'create_task': {
      const assigneeAccountId =
        (await findAccountIdByName(input.apartmentId, action.payload.assigneeName ?? null)) ??
        input.accountId
      const task = await createTask({
        apartmentId: input.apartmentId,
        title: resolveTaskTitle(action),
        description: action.payload.description?.trim() || null,
        assigneeAccountId,
        dueDate: normalizeDate(action.payload.dueDate ?? null),
        status: 'open',
        createdByAccountId: input.accountId,
      })
      message = `נפתחה מטלה חדשה: ${task.title}.`
      break
    }

    case 'update_task_due_date': {
      const task = await findTaskForAction(
        input.apartmentId,
        action.payload.taskId,
        action.payload.taskTitle,
      )
      await updateTask({
        apartmentId: input.apartmentId,
        taskId: task.id,
        title: task.title,
        description: task.description ?? null,
        assigneeAccountId: task.assigneeAccountId,
        dueDate: normalizeDate(action.payload.dueDate),
        status: task.status,
      })
      message = `תאריך היעד של "${task.title}" עודכן.`
      break
    }

    case 'update_task_status': {
      const task = await findTaskForAction(
        input.apartmentId,
        action.payload.taskId,
        action.payload.taskTitle,
      )
      await updateTask({
        apartmentId: input.apartmentId,
        taskId: task.id,
        title: task.title,
        description: task.description ?? null,
        assigneeAccountId: task.assigneeAccountId,
        dueDate: task.dueDate,
        status: action.payload.status,
      })
      message = `הסטטוס של "${task.title}" עודכן.`
      break
    }

    case 'create_expense': {
      const paidByAccountId =
        (await findAccountIdByName(input.apartmentId, action.payload.paidByName ?? null)) ??
        input.accountId
      const participantAccountIds = await resolveParticipantAccountIds(
        input.apartmentId,
        action.payload.participantNames,
      )
      await createExpense({
        apartmentId: input.apartmentId,
        paidByAccountId,
        amount: action.payload.amount.toFixed(2),
        description: action.payload.description.trim(),
        category: action.payload.category?.trim() || null,
        date: normalizeDate(action.payload.date ?? null),
        participantAccountIds,
      })
      message = 'ההוצאה נוספה בהצלחה.'
      break
    }

    case 'create_shopping_item': {
      await createShoppingItem({
        apartmentId: input.apartmentId,
        actorAccountId: input.accountId,
        itemName: action.payload.itemName.trim(),
        quantity: action.payload.quantity?.trim() || null,
        category: action.payload.category?.trim() || null,
        status: 'open',
      })
      message = `"${action.payload.itemName.trim()}" נוסף לרשימת הקניות.`
      break
    }

    case 'create_ticket': {
      await createTicket({
        apartmentId: input.apartmentId,
        title: action.payload.title.trim(),
        description: action.payload.description.trim(),
        category: action.payload.category ?? 'issue',
        createdByAccountId: input.accountId,
      })
      message = `נפתחה פנייה חדשה: ${action.payload.title.trim()}.`
      break
    }
  }

  pendingAgentActions.delete(input.token)
  return {
    ok: true,
    message,
    apartmentId: input.apartmentId,
  }
}
