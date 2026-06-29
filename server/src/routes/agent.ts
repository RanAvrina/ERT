import { Router } from 'express'
import OpenAI from 'openai'
import { z } from 'zod'
import { env } from '../config/env.js'
import { authenticate } from '../middleware/authenticate.js'
import { requireAuth } from '../middleware/require-auth.js'
import { createRateLimit } from '../middleware/rate-limit.js'
import { validateBody } from '../lib/validate.js'
import { ApiError } from '../lib/api-error.js'
import {
  createPendingAgentAction,
  confirmPendingAgentAction,
  validateAgentAction,
} from '../services/agent-action-service.js'
import { buildAgentContext } from '../services/agent-context-service.js'
import {
  clearPendingAgentFollowUp,
  getPendingAgentFollowUp,
  storePendingAgentFollowUp,
} from '../services/agent-followup-service.js'
import {
  inferLocalReadToolRequest,
  normalizeAgentMessage as normalizeAgentMessageInput,
  resolveLocalWriteAction,
} from '../services/agent-local-resolver.js'

export const agentRouter = Router()

const queryBodySchema = z.object({
  message: z.string().trim().min(1),
  history: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().trim().min(1),
      }),
    )
    .max(8)
    .optional(),
})

const confirmBodySchema = z.object({
  token: z.string().trim().min(1),
})

type AgentContext = Awaited<ReturnType<typeof buildAgentContext>>

const readToolNameSchema = z.enum([
  'get_tasks',
  'get_task_summary',
  'get_expenses',
  'get_payments',
  'get_balances',
  'get_apartment_summary',
  'get_shopping_items',
  'get_tickets',
  'get_apartment_info',
  'get_home_items',
])

const plannerResponseSchema = z.object({
  mode: z.enum(['answer', 'ask', 'tool', 'action']),
  reply: z.string().trim().optional(),
  tool: z
    .object({
      name: readToolNameSchema,
      args: z.record(z.string(), z.unknown()).optional(),
    })
    .nullable()
    .optional(),
  action: z.unknown().nullable().optional(),
})

type ReadToolName = z.infer<typeof readToolNameSchema>
type PlannerResponse = z.infer<typeof plannerResponseSchema>

const HE = {
  whoOwesMe: 'מי חייב לי',
  whoElseOwesMe: 'מי עוד חייב לי',
  howMuchOweMe: 'כמה כסף חייבים לי',
  howMuchNameOwesMe: 'כמה',
  owe: 'חייב',
  owePlural: 'חייבים',
  toMe: 'לי',
  toWhomDoIOwe: 'למי אני חייב',
  whyDoIOwe: 'למה אני חייב',
  howMuchDoIOwe: 'כמה אני חייב',
  i: 'אני',
  nobodyOwesMe: 'לפי החישוב במערכת, כרגע אף אחד לא חייב לך כסף.',
  youOweNobody: 'לפי החישוב במערכת, כרגע אינך חייב כסף לאף אחד.',
  whatUrgent: 'מה הכי דחוף',
  whatNeedsBuying: 'מה צריך לקנות',
  whatMissingToBuy: 'מה חסר לקנות',
  overdueTasks: 'מטלות באיחור',
  anyOverdueTasks: 'יש מטלות באיחור',
} as const

function parseAgentOutput(output: string) {
  try {
    return JSON.parse(output) as {
      reply?: string
      action?: unknown
    }
  } catch {
    const jsonMatch = output.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return { reply: output }

    try {
      return JSON.parse(jsonMatch[0]) as {
        reply?: string
        action?: unknown
      }
    } catch {
      return { reply: output }
    }
  }
}

function extractResponseText(response: unknown) {
  const candidate = response as {
    output_text?: string
    output?: Array<{
      text?: string
      content?: Array<{ text?: string }>
    }>
  }

  const directText = candidate.output_text?.trim()
  if (directText) return directText

  return (candidate.output ?? [])
    .flatMap((item) => {
      const nestedTexts = (item.content ?? [])
        .map((contentItem) => contentItem.text?.trim() ?? '')
        .filter(Boolean)

      if (nestedTexts.length) return nestedTexts
      return item.text?.trim() ? [item.text.trim()] : []
    })
    .join('\n')
    .trim()
}

function truncateForLog(value: string, maxLength = 180) {
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (normalized.length <= maxLength) return normalized
  return `${normalized.slice(0, maxLength)}...`
}

function logAgentEvent(event: string, details: Record<string, unknown>) {
  console.log('[agent]', {
    event,
    ...details,
  })
}

function hasMeaningfulAgentReply(
  reply: string | undefined,
  action: unknown,
  validatedAction: unknown,
) {
  if (typeof reply === 'string' && reply.trim()) return true
  if (validatedAction) return true
  return Boolean(action)
}

function parseAmountFromMessage(message: string) {
  const amountMatch = message.match(/(\d+(?:[.,]\d+)?)\s*(?:ש(?:קלים?|["״]ח)|שח)/)
  if (!amountMatch) return null

  const amount = Number(amountMatch[1].replace(',', '.'))
  return Number.isFinite(amount) && amount > 0 ? amount : null
}

function parseDirectShoppingAction(message: string) {
  const normalizedMessage = normalizeText(message)
  if (!normalizedMessage.includes('תוסיף')) return null
  if (
    !normalizedMessage.includes('רשימת קניות') &&
    !normalizedMessage.includes('לקניות') &&
    !normalizedMessage.includes('לקנות')
  ) {
    return null
  }

  const itemMatch =
    message.match(/תוסיף\s+(.+?)\s+לרשימת\s+קניות/i) ??
    message.match(/תוסיף\s+(.+?)\s+לקניות/i) ??
    message.match(/תוסיף\s+(.+?)\s+לקנות/i)

  const rawValue = itemMatch?.[1]?.trim()
  if (!rawValue) return null

  const quantityMatch = rawValue.match(/(.+?)\s+(\d+(?:[.,]\d+)?)$/)
  const trailingQuantityMatch = message.match(
    /(?:\u05dc\u05e8\u05e9\u05d9\u05de\u05ea\s+\u05e7\u05e0\u05d9\u05d5\u05ea|\u05dc\u05e7\u05e0\u05d9\u05d5\u05ea|\u05dc\u05e7\u05e0\u05d5\u05ea)\s+(\d+(?:[.,]\d+)?)$/u,
  )
  const itemName = (quantityMatch?.[1]?.trim() ?? rawValue).replace(/^\u05dc\u05d9\s+/u, '').trim()
  const quantity = quantityMatch?.[2]?.trim() ?? trailingQuantityMatch?.[1]?.trim() ?? null

  if (!itemName) return null

  return {
    reply: `זיהיתי בקשה להוסיף פריט קניות: ${itemName}${quantity ? `, כמות ${quantity}` : ''}. לאשר?`,
    action: {
      type: 'create_shopping_item',
      payload: {
        itemName,
        quantity,
        category: null,
      },
    },
  }
}

function parseDirectExpenseAction(message: string) {
  const normalizedMessage = normalizeText(message)
  const amount = parseAmountFromMessage(message)
  if (!amount) return null
  if (!normalizedMessage.includes('הוצאה') && !normalizedMessage.includes('תוסיף')) return null

  const descriptionMatch =
    message.match(/על\s+(.+?)(?:\s+ותחלק|\s+ותחלקי|\s+בין\s+|$)/) ??
    message.match(/הוצאה\s+של\s+(.+?)(?:\s+בסכום|\s+על\s+|\s+בין\s+|$)/)

  const description = descriptionMatch?.[1]?.trim() ?? 'הוצאה חדשה'
  if (!description) return null

  const splitBetweenEveryone =
    normalizedMessage.includes('בין כולם') ||
    normalizedMessage.includes('בין כל הדיירים') ||
    normalizedMessage.includes('שווה בשווה')

  if (
    !splitBetweenEveryone &&
    (normalizedMessage.includes('ביני') ||
      normalizedMessage.includes('לבין') ||
      normalizedMessage.includes('רק'))
  ) {
    return null
  }

  return {
    reply: splitBetweenEveryone
      ? `זיהיתי בקשה להוסיף הוצאה של ${amount} ש"ח עבור ${description}, מחולקת בין כל הדיירים. לאשר?`
      : `זיהיתי בקשה להוסיף הוצאה של ${amount} ש"ח עבור ${description}. לאשר?`,
    action: {
      type: 'create_expense',
      payload: {
        description,
        amount,
        category: description,
        date: null,
        paidByName: null,
        participantNames: null,
      },
    },
  }
}

function parseDirectAgentAction(message: string) {
  return parseDirectExpenseAction(message) ?? parseDirectShoppingAction(message)
}

function extractMentionedRoommateNames(message: string, context: AgentContext) {
  const normalizedMessage = normalizeText(message)
  return [...context.roommates]
    .sort((left, right) => right.name.length - left.name.length)
    .filter((roommate) => normalizedMessage.includes(normalizeText(roommate.name)))
    .map((roommate) => roommate.name)
}

function parseContextualExpenseAction(message: string, context: AgentContext) {
  const normalizedMessage = normalizeText(message)
  const amount = parseAmountFromMessage(message)
  if (!amount) return null

  const looksLikeExpenseAction =
    (normalizedMessage.includes('הוצאה') ||
      normalizedMessage.includes('תוסיף') ||
      normalizedMessage.includes('תרשום') ||
      normalizedMessage.includes('תכניס')) &&
    (normalizedMessage.includes('תחלק') || normalizedMessage.includes('בין'))

  if (!looksLikeExpenseAction) return null

  const descriptionMatch =
    message.match(/על\s+(.+?)(?:\s+ותחלק|\s+ותחלקי|\s+בין\s+|$)/i) ??
    message.match(/הוצאה\s+(?:של\s+)?(.+?)(?:\s+בסך|\s+\d+(?:[.,]\d+)?\s*(?:שקל(?:ים)?|ש["״]?ח)|\s+בין\s+|\s+ותחלק|$)/i)

  const description = descriptionMatch?.[1]?.trim() ?? 'הוצאה חדשה'
  if (!description) return null

  const splitBetweenEveryone =
    normalizedMessage.includes('בין כולם') ||
    normalizedMessage.includes('בין כל הדיירים') ||
    normalizedMessage.includes('שווה בשווה')

  const participantNames = splitBetweenEveryone
    ? null
    : extractMentionedRoommateNames(message, context)

  if (!splitBetweenEveryone && normalizedMessage.includes('בין') && !participantNames?.length) {
    return null
  }

  const participantSummary = participantNames?.length ? ` (${participantNames.join(', ')})` : ''

  return {
    reply: `זיהיתי בקשה להוסיף הוצאה של ${amount} ש"ח עבור ${description}${participantSummary}. לאשר?`,
    action: {
      type: 'create_expense',
      payload: {
        description,
        amount,
        category: description,
        date: null,
        paidByName: null,
        participantNames: participantNames?.length ? participantNames : null,
      },
    },
  }
}

function parseContextualShoppingAction(message: string) {
  const normalizedMessage = normalizeText(message)
  const looksLikeShoppingAction =
    (normalizedMessage.includes('רשימת קניות') ||
      normalizedMessage.includes('לקניות') ||
      normalizedMessage.includes('לקנות')) &&
    (normalizedMessage.includes('תוסיף') ||
      normalizedMessage.includes('תרשום') ||
      normalizedMessage.includes('תכניס') ||
      normalizedMessage.includes('תוסיף לי'))

  if (!looksLikeShoppingAction) return null

  const commandBody = normalizeText(
    message
      .replace(/^(?:\u05ea\u05d5\u05e1\u05d9\u05e3|\u05ea\u05e8\u05e9\u05d5\u05dd|\u05ea\u05db\u05e0\u05d9\u05e1)\s+/u, '')
      .replace(/^\u05dc\u05d9\s+/u, ''),
  )

  const patterns = [
    /^(?<item>.+?)\s+(?<quantity>\d+(?:[.,]\d+)?)\s+\u05dc\u05e8\u05e9\u05d9\u05de\u05ea\s+\u05e7\u05e0\u05d9\u05d5\u05ea$/u,
    /^(?<item>.+?)\s+\u05dc\u05e8\u05e9\u05d9\u05de\u05ea\s+\u05e7\u05e0\u05d9\u05d5\u05ea\s+(?<quantity>\d+(?:[.,]\d+)?)$/u,
    /^(?<item>.+?)\s+(?<quantity>\d+(?:[.,]\d+)?)\s+\u05dc\u05e7\u05e0\u05d9\u05d5\u05ea$/u,
    /^(?<item>.+?)\s+\u05dc\u05e7\u05e0\u05d9\u05d5\u05ea\s+(?<quantity>\d+(?:[.,]\d+)?)$/u,
    /^(?<item>.+?)\s+\u05dc\u05e8\u05e9\u05d9\u05de\u05ea\s+\u05e7\u05e0\u05d9\u05d5\u05ea$/u,
    /^(?<item>.+?)\s+\u05dc\u05e7\u05e0\u05d9\u05d5\u05ea$/u,
    /^(?<item>.+?)\s+\u05dc\u05e7\u05e0\u05d5\u05ea$/u,
  ]

  const matched = patterns.map((pattern) => commandBody.match(pattern)).find(Boolean)
  const itemName = matched?.groups?.item?.trim() ?? null
  const quantity = matched?.groups?.quantity?.trim() ?? null
  if (!itemName) return null

  return {
    reply: `זיהיתי בקשה להוסיף פריט קניות: ${itemName}${quantity ? `, כמות ${quantity}` : ''}. לאשר?`,
    action: {
      type: 'create_shopping_item',
      payload: {
        itemName,
        quantity,
        category: null,
      },
    },
  }
}

function parseContextualTaskAction(message: string, context: AgentContext) {
  const normalizedMessage = normalizeText(message)
  const looksLikeTaskAction =
    (normalizedMessage.includes('מטלה') || normalizedMessage.includes('משימה')) &&
    (normalizedMessage.includes('תוסיף') ||
      normalizedMessage.includes('תפתח') ||
      normalizedMessage.includes('תיצור') ||
      normalizedMessage.includes('תרשום'))

  if (!looksLikeTaskAction) return null

  const titleMatch =
    message.match(/(?:מטלה|משימה)\s+(?:של\s+)?(.+?)(?:\s+ל(?:רן|דוד|יוני)|\s+עד\s+|$)/i) ??
    message.match(/(?:תוסיף|תפתח|תיצור|תרשום)\s+(?:לי\s+)?(?:מטלה|משימה)\s+(.+?)(?:\s+ל(?:רן|דוד|יוני)|\s+עד\s+|$)/i)

  const title = titleMatch?.[1]?.trim()
  if (!title) return null

  const assigneeName = extractMentionedRoommateNames(message, context)[0] ?? null

  return {
    reply: `זיהיתי בקשה לפתוח מטלה: ${title}${assigneeName ? ` עבור ${assigneeName}` : ''}. לאשר?`,
    action: {
      type: 'create_task',
      payload: {
        title,
        taskType: 'other',
        targetItemName: undefined,
        description: null,
        assigneeName,
        dueDate: null,
      },
    },
  }
}

function parseContextualTicketAction(message: string) {
  const normalizedMessage = normalizeText(message)
  const looksLikeTicketAction =
    (normalizedMessage.includes('פניה') ||
      normalizedMessage.includes('תקלה') ||
      normalizedMessage.includes('בקשה')) &&
    (normalizedMessage.includes('תפתח') ||
      normalizedMessage.includes('פתח') ||
      normalizedMessage.includes('תיצור') ||
      normalizedMessage.includes('תרשום'))

  if (!looksLikeTicketAction) return null

  const titleMatch =
    message.match(/(?:פניה|תקלה|בקשה)\s+(?:על\s+)?(.+)$/i) ??
    message.match(/(?:תפתח|פתח|תיצור|תרשום)\s+(?:לי\s+)?(?:פניה|תקלה|בקשה)\s+(?:על\s+)?(.+)$/i)

  const title = titleMatch?.[1]?.trim()
  if (!title) return null

  const category = normalizedMessage.includes('חשבון') || normalizedMessage.includes('תשלום')
    ? 'finance'
    : normalizedMessage.includes('בקשה')
      ? 'request'
      : 'issue'

  return {
    reply: `זיהיתי בקשה לפתוח פנייה: ${title}. לאשר?`,
    action: {
      type: 'create_ticket',
      payload: {
        title,
        description: title,
        category,
      },
    },
  }
}

function extractFirstMatchingTaskTitle(message: string, context: AgentContext) {
  const normalizedMessage = normalizeText(message)
  return [...context.tasks]
    .sort((left, right) => right.title.length - left.title.length)
    .find((task) => normalizedMessage.includes(normalizeText(task.title)))
    ?.title
}

function parseContextualCancelShoppingAction(message: string) {
  const normalizedMessage = normalizeText(message)
  const looksLikeCancel =
    normalizedMessage.includes('תבטל') ||
    normalizedMessage.includes('תמחק') ||
    normalizedMessage.includes('תסיר') ||
    normalizedMessage.includes('תוריד')

  const looksLikeShopping =
    normalizedMessage.includes('קניות') ||
    normalizedMessage.includes('רשימת קניות') ||
    normalizedMessage.includes('לקנות')

  if (!looksLikeCancel || !looksLikeShopping) return null

  const itemMatch =
    message.match(/(?:תבטל|תמחק|תסיר|תוריד)\s+(?:את\s+)?(?:הפריט\s+)?(.+?)(?:\s+מרשימת\s+הקניות|\s+מהקניות|\s+מהרשימה|$)/i)

  const itemName = itemMatch?.[1]?.trim()
  if (!itemName) return null

  return {
    reply: `זיהיתי בקשה לבטל את פריט הקניות ${itemName}. לאשר?`,
    action: {
      type: 'cancel_shopping_items',
      payload: {
        itemName,
        mode: normalizedMessage.includes('הכל') || normalizedMessage.includes('כל') ? 'all_matching' : 'single_latest',
      },
    },
  }
}

function parseContextualTaskStatusAction(message: string, context: AgentContext) {
  const normalizedMessage = normalizeText(message)
  const taskTitle = extractFirstMatchingTaskTitle(message, context)
  if (!taskTitle) return null

  const status =
    normalizedMessage.includes('הושלם') ||
    normalizedMessage.includes('הושלמה') ||
    normalizedMessage.includes('בוצע') ||
    normalizedMessage.includes('בוצעה') ||
    normalizedMessage.includes('סיים') ||
    normalizedMessage.includes('סגור')
      ? 'done'
      : normalizedMessage.includes('בביצוע') || normalizedMessage.includes('בתהליך')
        ? 'in_progress'
        : normalizedMessage.includes('בטל') || normalizedMessage.includes('מבוטל')
          ? 'cancelled'
          : normalizedMessage.includes('פתח') || normalizedMessage.includes('פתוח')
            ? 'open'
            : null

  if (!status) return null

  return {
    reply: `זיהיתי בקשה לעדכן את הסטטוס של המטלה ${taskTitle}. לאשר?`,
    action: {
      type: 'update_task_status',
      payload: {
        taskTitle,
        status,
      },
    },
  }
}

function parseContextualTaskDueDateAction(message: string, context: AgentContext) {
  const normalizedMessage = normalizeText(message)
  const taskTitle = extractFirstMatchingTaskTitle(message, context)
  if (!taskTitle) return null

  if (!normalizedMessage.includes('תאריך') && !normalizedMessage.includes('יעד') && !normalizedMessage.includes('עד ')) {
    return null
  }

  const isoDateMatch = message.match(/\b(\d{4}-\d{2}-\d{2})\b/)
  const shortDateMatch = message.match(/\b(\d{1,2})[./](\d{1,2})[./](\d{4})\b/)

  let dueDate: string | null = null
  if (isoDateMatch) {
    dueDate = isoDateMatch[1]
  } else if (shortDateMatch) {
    const day = shortDateMatch[1].padStart(2, '0')
    const month = shortDateMatch[2].padStart(2, '0')
    const year = shortDateMatch[3]
    dueDate = `${year}-${month}-${day}`
  }

  if (!dueDate) return null

  return {
    reply: `זיהיתי בקשה לעדכן את תאריך היעד של המטלה ${taskTitle} ל-${formatDate(dueDate)}. לאשר?`,
    action: {
      type: 'update_task_due_date',
      payload: {
        taskTitle,
        dueDate,
      },
    },
  }
}

function parseContextualWriteAction(message: string, context: AgentContext) {
  return (
    parseContextualExpenseAction(message, context) ??
    parseContextualShoppingAction(message) ??
    parseContextualCancelShoppingAction(message) ??
    parseContextualTaskStatusAction(message, context) ??
    parseContextualTaskDueDateAction(message, context) ??
    parseContextualTaskAction(message, context) ??
    parseContextualTicketAction(message)
  )
}

function requireActiveApartment(request: Express.Request) {
  const membership = request.auth?.membership
  if (!membership || membership.status !== 'active') {
    throw new ApiError(403, 'You do not belong to an active apartment.')
  }

  return membership.apartmentId
}

function normalizeText(value: string) {
  return value.replace(/\s+/g, ' ').trim()
}

function normalizeAgentMessage(value: string) {
  let normalized = normalizeText(value)

  const replacements: Array<[RegExp, string]> = [
    [/\bכסך\b/gu, 'כסף'],
    [/\bשלצתי\b/gu, 'שילמתי'],
    [/\bשלמתי\b/gu, 'שילמתי'],
    [/\bשלמתי\b/gu, 'שילמתי'],
    [/\bמטלטות\b/gu, 'מטלות'],
    [/\bמטלטה\b/gu, 'מטלה'],
    [/\bהמצבב\b/gu, 'המצב'],
    [/\bהמצב\s+בדירהה\b/gu, 'המצב בדירה'],
    [/\bחשמלל\b/gu, 'חשמל'],
    [/\bמיים\b/gu, 'מים'],
    [/\bתשלומיםם\b/gu, 'תשלומים'],
    [/\bקנייות\b/gu, 'קניות'],
    [/\bשלחתי\b/gu, 'שילמתי'],
  ]

  for (const [pattern, replacement] of replacements) {
    normalized = normalized.replace(pattern, replacement)
  }

  return normalizeText(normalized)
}

function includesHebrew(source: string, needle: string) {
  return normalizeText(source).includes(normalizeText(needle))
}

function formatCurrency(amount: number) {
  return `${Number(amount.toFixed(2))} ש"ח`
}

function formatDate(value: string | null | undefined) {
  if (!value) return ''
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return value
  return `${match[3]}/${match[2]}/${match[1]}`
}

function buildOpenAIContext(context: AgentContext) {
  return {
    today: context.today,
    user: context.user,
    apartment: context.apartment,
    roommates: context.roommates,
    apartmentInfoItems: context.apartmentInfoItems,
  }
}

function inferQueryScope(message: string) {
  const normalized = normalizeText(message)
  return {
    finance:
      ['חייב', 'חובות', 'תשלום', 'תשלומים', 'הוצאה', 'הוצאות', 'כסף'].some((term) =>
        normalized.includes(term),
      ),
    tasks:
      ['מטלה', 'מטלות', 'משימה', 'משימות', 'איחור', 'דחוף', 'לבצע', 'לפתוח מטלה'].some((term) =>
        normalized.includes(term),
      ),
    shopping:
      ['קניות', 'קנייה', 'לקנות', 'חסר לקנות', 'רשימת קניות', 'להוסיף מוצר'].some((term) =>
        normalized.includes(term),
      ),
    tickets:
      ['פנייה', 'פניות', 'תקלה', 'תקלות', 'בקשה', 'בקשות'].some((term) =>
        normalized.includes(term),
      ),
    homeItems:
      ['מטבח', 'שירותים', 'מקלחת', 'פריט', 'פריטים', 'בית'].some((term) =>
        normalized.includes(term),
      ),
  }
}

function buildScopedOpenAIContext(
  context: AgentContext,
  message: string,
  pendingOriginalMessage?: string,
) {
  const combinedMessage = pendingOriginalMessage ? `${pendingOriginalMessage} ${message}` : message
  const normalizedCombinedMessage = normalizeText(combinedMessage)
  const scope = inferQueryScope(combinedMessage)
  const asksGeneralSummary =
    normalizedCombinedMessage.includes('מה המצב') ||
    normalizedCombinedMessage.includes('מצב הדירה') ||
    normalizedCombinedMessage.includes('מה קורה בדירה') ||
    normalizedCombinedMessage.includes('תן לי סיכום') ||
    normalizedCombinedMessage.includes('סיכום דירה') ||
    normalizedCombinedMessage.includes('תסכם לי') ||
    normalizedCombinedMessage.includes('עדכן אותי')
  const baseContext = buildOpenAIContext(context)
  const overdueTasks = context.tasks.filter(
    (task) =>
      Boolean(task.dueDate) &&
      task.status !== 'done' &&
      task.status !== 'cancelled' &&
      task.dueDate! < context.today,
  )
  const openTickets = context.tickets.filter((ticket) => ticket.status !== 'closed')
  const openShoppingItems = context.shoppingItems.filter((item) => item.status === 'open')

  return {
    ...baseContext,
    counts: {
      openTasks: context.tasks.filter((task) => task.status === 'open').length,
      inProgressTasks: context.tasks.filter((task) => task.status === 'in_progress').length,
      overdueTasks: overdueTasks.length,
      openShoppingItems: openShoppingItems.length,
      openTickets: openTickets.length,
    },
    highlights: {
      overdueTasks: overdueTasks.slice(0, 3).map((task) => ({
        id: task.id,
        title: task.title,
        dueDate: task.dueDate,
        assigneeName: task.assigneeName,
      })),
      openShoppingItems: openShoppingItems.slice(0, 5).map((item) => ({
        id: item.id,
        name: item.name,
        quantity: item.quantity,
      })),
      openTickets: openTickets.slice(0, 3).map((ticket) => ({
        id: ticket.id,
        title: ticket.title,
        category: ticket.category,
      })),
    },
    tasks: scope.tasks || asksGeneralSummary ? context.tasks.slice(0, 8) : undefined,
    expenses: scope.finance || asksGeneralSummary
      ? context.expenses.slice(0, 6).map((expense) => ({
          id: expense.id,
          description: expense.description,
          amount: expense.amount,
          category: expense.category,
          date: expense.date,
          paidByName: expense.paidByName,
        }))
      : undefined,
    payments: scope.finance || asksGeneralSummary
      ? context.payments.slice(0, 6).map((payment) => ({
          id: payment.id,
          amount: payment.amount,
          date: payment.date,
          payerName: payment.payerName,
          payeeName: payment.payeeName,
          note: payment.note,
        }))
      : undefined,
    shoppingItems: scope.shopping || asksGeneralSummary ? context.shoppingItems.slice(0, 8) : undefined,
    tickets: scope.tickets || asksGeneralSummary ? context.tickets.slice(0, 6) : undefined,
    homeItems: scope.homeItems || scope.tasks ? context.homeItems.slice(0, 8) : undefined,
    apartmentInfoItems: ['דירה', 'כתובת', 'מונה', 'חשמל', 'מים', 'ספק', 'חשבון', 'טלפון'].some(
      (term) => normalizedCombinedMessage.includes(term),
    )
      ? context.apartmentInfoItems.slice(0, 10)
      : undefined,
    balanceSummary: scope.finance || asksGeneralSummary ? context.balanceSummary : undefined,
  }
}

function inferHeuristicReadToolRequest(
  message: string,
  context: AgentContext,
  conversationContext = '',
) {
  const normalizedMessage = normalizeText(message)
  const normalizedConversationContext = normalizeText(conversationContext)
  const asksForMoreDetail =
    normalizedMessage.includes('תפרט') ||
    normalizedMessage.includes('תראה לי הכל') ||
    normalizedMessage.includes('כולל תאריכים') ||
    normalizedMessage.includes('כולל סכום') ||
    normalizedMessage.includes('על מה') ||
    normalizedMessage.includes('מה שילמתי')
  const conversationIsAboutDebtFromExpenses =
    normalizedConversationContext.includes('למה חייבים לי') ||
    normalizedConversationContext.includes('מה שילמתי שיצר את החוב') ||
    normalizedConversationContext.includes('איזה הוצאות') ||
    normalizedConversationContext.includes('הוצאות שיצרו') ||
    normalizedConversationContext.includes('חייבים לי כסף')

  if (asksForMoreDetail && conversationIsAboutDebtFromExpenses) {
    return {
      name: 'get_expenses' as const,
      args: { scope: 'mine', limit: 12 },
    }
  }

  if (
    normalizedMessage.includes('מה המטלות שלי') ||
    normalizedMessage.includes('המטלות שלי') ||
    normalizedMessage.includes('המשימות שלי') ||
    normalizedMessage.includes('מה יש לי לעשות')
  ) {
    return {
      name: 'get_tasks' as const,
      args: { scope: 'mine', limit: 10 },
    }
  }

  if (
    normalizedMessage.includes('מה חסר לקנות') ||
    normalizedMessage.includes('מה צריך לקנות') ||
    normalizedMessage.includes('רשימת קניות') ||
    normalizedMessage.includes('קניות פתוחות')
  ) {
    return {
      name: 'get_shopping_items' as const,
      args: { status: 'open', limit: 12 },
    }
  }

  if (
    normalizedMessage.includes('פניות פתוחות') ||
    normalizedMessage.includes('תקלות פתוחות') ||
    normalizedMessage.includes('איזה פניות') ||
    normalizedMessage.includes('איזה תקלות')
  ) {
    return {
      name: 'get_tickets' as const,
      args: { status: 'open', limit: 10 },
    }
  }

  if (
    normalizedMessage.includes('מונה') ||
    normalizedMessage.includes('ספק') ||
    normalizedMessage.includes('מספר חשבון') ||
    normalizedMessage.includes('טלפון')
  ) {
    const query = normalizedMessage.includes('חשמל')
      ? 'חשמל'
      : normalizedMessage.includes('מים')
        ? 'מים'
        : normalizedMessage.includes('אינטרנט')
          ? 'אינטרנט'
          : normalizedMessage.includes('גז')
            ? 'גז'
            : ''

    return {
      name: 'get_apartment_info' as const,
      args: { query, limit: 10 },
    }
  }

  const matchingHomeItem = context.homeItems.find(
    (item) =>
      normalizedMessage.includes(normalizeText(item.area)) ||
      normalizedMessage.includes(normalizeText(item.name)),
  )

  if (
    matchingHomeItem &&
    (normalizedMessage.includes('פריט') ||
      normalizedMessage.includes('פריטים') ||
      normalizedMessage.includes('יש ב') ||
      normalizedMessage.includes('מה יש ב'))
  ) {
    return {
      name: 'get_home_items' as const,
      args: { query: matchingHomeItem.area, limit: 12 },
    }
  }

  if (
    normalizedMessage.includes('מי שילם') ||
    normalizedMessage.includes('תשלומים אחרונים') ||
    normalizedMessage.includes('מי העביר')
  ) {
    return {
      name: 'get_payments' as const,
      args: { scope: 'all', limit: 8 },
    }
  }

  if (
    normalizedMessage.includes('הוצאות אחרונות') ||
    normalizedMessage.includes('מה ההוצאות') ||
    normalizedMessage.includes('על מה הוצאנו')
  ) {
    return {
      name: 'get_expenses' as const,
      args: { scope: 'all', limit: 8 },
    }
  }

  if (
    normalizedMessage.includes('למה חייבים לי') ||
    normalizedMessage.includes('למה חייב לי') ||
    normalizedMessage.includes('ממה נובע החוב אליי') ||
    normalizedMessage.includes('איזה הוצאות יצרו את החוב אליי')
  ) {
    return {
      name: 'get_expenses' as const,
      args: { scope: 'mine', limit: 12 },
    }
  }

  if (
    normalizedMessage.includes('כמה אני חייב') ||
    normalizedMessage.includes('כמה חייבים לי') ||
    normalizedMessage.includes('מי חייב לי') ||
    normalizedMessage.includes('למי אני חייב')
  ) {
    return {
      name: 'get_balances' as const,
      args: {},
    }
  }

  if (normalizedMessage.includes('מה המצב') || normalizedMessage.includes('סיכום הדירה')) {
    return {
      name: 'get_apartment_summary' as const,
      args: {},
    }
  }

  if (
    normalizedMessage.includes('מה קורה בדירה') ||
    normalizedMessage.includes('מצב הדירה') ||
    normalizedMessage.includes('תן לי סיכום') ||
    normalizedMessage.includes('תסכם לי') ||
    normalizedMessage.includes('עדכן אותי')
  ) {
    return {
      name: 'get_apartment_summary' as const,
      args: {},
    }
  }

  return null
}

function clampLimit(value: unknown, fallback: number, max: number) {
  const numericValue =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number(value)
        : Number.NaN

  if (!Number.isFinite(numericValue)) return fallback
  return Math.max(1, Math.min(max, Math.trunc(numericValue)))
}

function executeReadTool(context: AgentContext, toolName: ReadToolName, rawArgs?: Record<string, unknown>) {
  const args = rawArgs ?? {}

  switch (toolName) {
    case 'get_tasks': {
      const scope = args.scope === 'all' ? 'all' : 'mine'
      const status =
        typeof args.status === 'string' && args.status.trim() ? args.status.trim() : null
      const limit = clampLimit(args.limit, 8, 20)
      const tasks = context.tasks.filter((task) => {
        if (scope === 'mine' && context.user && task.assigneeAccountId !== context.user.id) {
          return false
        }
        if (status && task.status !== status) {
          return false
        }
        return true
      })

      return {
        tool: toolName,
        args: { scope, status, limit },
        result: tasks.slice(0, limit),
      }
    }

    case 'get_task_summary': {
      const myTasks = context.user
        ? context.tasks.filter((task) => task.assigneeAccountId === context.user!.id)
        : []

      return {
        tool: toolName,
        result: {
          myOpenTasks: myTasks.filter((task) => task.status === 'open').length,
          myInProgressTasks: myTasks.filter((task) => task.status === 'in_progress').length,
          overdueTasks: context.tasks.filter(
            (task) =>
              Boolean(task.dueDate) &&
              task.status !== 'done' &&
              task.status !== 'cancelled' &&
              task.dueDate! < context.today,
          ).length,
          totalOpenTasks: context.tasks.filter((task) => task.status === 'open').length,
        },
      }
    }

    case 'get_expenses': {
      const scope = args.scope === 'all' ? 'all' : 'mine'
      const limit = clampLimit(args.limit, 6, 20)
      const expenses = context.expenses.filter((expense) => {
        if (scope === 'mine' && context.user && expense.paidByAccountId !== context.user.id) {
          return false
        }
        return true
      })

      return {
        tool: toolName,
        args: { scope, limit },
        result: expenses.slice(0, limit),
      }
    }

    case 'get_payments': {
      const scope = args.scope === 'all' ? 'all' : 'related_to_me'
      const limit = clampLimit(args.limit, 6, 20)
      const payments = context.payments.filter((payment) => {
        if (scope === 'all' || !context.user) return true
        return (
          payment.payerAccountId === context.user.id || payment.payeeAccountId === context.user.id
        )
      })

      return {
        tool: toolName,
        args: { scope, limit },
        result: payments.slice(0, limit),
      }
    }

    case 'get_balances':
      return {
        tool: toolName,
        result: context.balanceSummary,
      }

    case 'get_apartment_summary':
      return {
        tool: toolName,
        result: {
          apartment: context.apartment,
          today: context.today,
          roommates: context.roommates,
          openTasks: context.tasks.filter((task) => task.status === 'open').length,
          inProgressTasks: context.tasks.filter((task) => task.status === 'in_progress').length,
          openShoppingItems: context.shoppingItems.filter((item) => item.status === 'open').length,
          openTickets: context.tickets.filter((ticket) => ticket.status !== 'closed').length,
          latestExpenses: context.expenses.slice(0, 5),
          latestPayments: context.payments.slice(0, 5),
        },
      }

    case 'get_shopping_items': {
      const status =
        typeof args.status === 'string' && args.status.trim() ? args.status.trim() : 'open'
      const limit = clampLimit(args.limit, 8, 25)
      const items = context.shoppingItems.filter((item) => {
        if (status === 'all') return true
        return item.status === status
      })

      return {
        tool: toolName,
        args: { status, limit },
        result: items.slice(0, limit),
      }
    }

    case 'get_tickets': {
      const status =
        typeof args.status === 'string' && args.status.trim() ? args.status.trim() : 'open'
      const limit = clampLimit(args.limit, 6, 20)
      const tickets = context.tickets.filter((ticket) => {
        if (status === 'all') return true
        return ticket.status === status
      })

      return {
        tool: toolName,
        args: { status, limit },
        result: tickets.slice(0, limit),
      }
    }

    case 'get_apartment_info': {
      const query =
        typeof args.query === 'string' && args.query.trim()
          ? normalizeText(args.query).toLowerCase()
          : ''
      const limit = clampLimit(args.limit, 10, 20)
      const items = query
        ? context.apartmentInfoItems.filter((item) =>
            [item.title, item.categoryLabel, item.provider, item.notes, item.phone, item.accountNumber, item.meterNumber]
              .filter((value): value is string => Boolean(value))
              .some((value) => normalizeText(value).toLowerCase().includes(query)),
          )
        : context.apartmentInfoItems

      return {
        tool: toolName,
        args: { query, limit },
        result: items.slice(0, limit),
      }
    }

    case 'get_home_items': {
      const query =
        typeof args.query === 'string' && args.query.trim()
          ? normalizeText(args.query).toLowerCase()
          : ''
      const limit = clampLimit(args.limit, 10, 25)
      const items = query
        ? context.homeItems.filter((item) =>
            [item.name, item.area, item.defaultNote]
              .filter((value): value is string => Boolean(value))
              .some((value) => normalizeText(value).toLowerCase().includes(query)),
          )
        : context.homeItems

      return {
        tool: toolName,
        args: { query, limit },
        result: items.slice(0, limit),
      }
    }
  }
}

function buildToolReplyFallback(
  toolName: ReadToolName,
  toolData: ReturnType<typeof executeReadTool>,
  context: AgentContext,
  message: string,
) {
  const normalizedMessage = normalizeText(message)
  const asksForBreakdown =
    normalizedMessage.includes('תפרט') ||
    normalizedMessage.includes('פירוט') ||
    normalizedMessage.includes('כולל') ||
    normalizedMessage.includes('על מה')

  switch (toolName) {
    case 'get_balances': {
      const currentUser = context.user
      if (!currentUser) return 'לא הצלחתי לזהות את המשתמש המחובר.'

      const userOwes = context.balanceSummary.settlements.filter(
        (item) => item.payerAccountId === currentUser.id,
      )
      const owedToUser = context.balanceSummary.settlements.filter(
        (item) => item.payeeAccountId === currentUser.id,
      )

      const asksUserOwes =
        normalizedMessage.includes('למי אני חייב') ||
        normalizedMessage.includes('אני חייב') ||
        normalizedMessage.includes('כמה אני חייב')

      if (asksUserOwes) {
        if (!userOwes.length) return 'לא. לפי המאזן הנוכחי אתה לא חייב כרגע כסף לאף אחד.'
        const details = userOwes.map((item) => `${item.payeeName} ${formatCurrency(item.amount)}`).join(', ')
        return `כן. כרגע אתה חייב בסך הכול ${formatCurrency(userOwes.reduce((sum, item) => sum + item.amount, 0))}. ${details}.`
      }

      if (!owedToUser.length) return 'לפי המאזן הנוכחי כרגע אף אחד לא חייב לך כסף.'
      const details = owedToUser.map((item) => `${item.payerName} ${formatCurrency(item.amount)}`).join(', ')
      return `כרגע חייבים לך בסך הכול ${formatCurrency(owedToUser.reduce((sum, item) => sum + item.amount, 0))}. ${details}.`
    }

    case 'get_tasks': {
      const tasks = toolData.result as AgentContext['tasks']
      if (!tasks.length) return normalizedMessage.includes('שלי') ? 'כרגע אין לך מטלות פתוחות.' : 'כרגע אין מטלות תואמות.'
      const details = tasks
        .slice(0, 8)
        .map((task) => `- ${task.title}${task.dueDate ? ` · יעד: ${formatDate(task.dueDate)}` : ''}`)
        .join('\n')
      return `אלו המטלות כרגע:\n${details}`
    }

    case 'get_task_summary': {
      const summary = toolData.result as {
        myOpenTasks: number
        myInProgressTasks: number
        overdueTasks: number
        totalOpenTasks: number
      }
      return `כרגע יש לך ${summary.myOpenTasks} מטלות פתוחות ו-${summary.myInProgressTasks} בביצוע. בדירה יש ${summary.totalOpenTasks} מטלות פתוחות בסך הכול, ומתוכן ${summary.overdueTasks} באיחור.`
    }

    case 'get_expenses': {
      const expenses = toolData.result as AgentContext['expenses']
      if (!expenses.length) return 'לא מצאתי הוצאות תואמות כרגע.'
      const details = expenses
        .slice(0, asksForBreakdown ? 12 : 6)
        .map((expense) => `- ${expense.description} (${formatDate(expense.date)}): ${formatCurrency(Number(expense.amount))}${expense.paidByName ? ` · שילם ${expense.paidByName}` : ''}`)
        .join('\n')
      return `אלו ההוצאות שמצאתי:\n${details}`
    }

    case 'get_payments': {
      const payments = toolData.result as AgentContext['payments']
      if (!payments.length) return 'לא מצאתי תשלומים תואמים כרגע.'
      const details = payments
        .slice(0, asksForBreakdown ? 12 : 6)
        .map((payment) => `- ${payment.payerName} → ${payment.payeeName}, ${formatCurrency(Number(payment.amount))} (${formatDate(payment.date)})`)
        .join('\n')
      return `אלו התשלומים שמצאתי:\n${details}`
    }

    case 'get_apartment_summary': {
      const summary = toolData.result as {
        apartment: string
        today: string
        openTasks: number
        inProgressTasks: number
        openShoppingItems: number
        openTickets: number
        latestExpenses: AgentContext['expenses']
      }
      return `כרגע בדירה יש ${summary.openTasks} מטלות פתוחות, ${summary.inProgressTasks} מטלות בביצוע, ${summary.openShoppingItems} פריטי קניות פתוחים ו-${summary.openTickets} פניות פתוחות.`
    }

    case 'get_shopping_items': {
      const items = toolData.result as AgentContext['shoppingItems']
      if (!items.length) return 'כרגע אין פריטי קניות תואמים.'
      const details = items
        .slice(0, 10)
        .map((item) => `- ${item.name}${item.quantity ? ` · כמות: ${item.quantity}` : ''}`)
        .join('\n')
      return `אלו הפריטים ברשימה:\n${details}`
    }

    case 'get_tickets': {
      const tickets = toolData.result as AgentContext['tickets']
      if (!tickets.length) return 'כרגע אין פניות תואמות.'
      const details = tickets
        .slice(0, 8)
        .map((ticket) => `- ${ticket.title}${ticket.category ? ` · ${ticket.category}` : ''}${ticket.status ? ` · ${ticket.status}` : ''}`)
        .join('\n')
      return `אלו הפניות שמצאתי:\n${details}`
    }

    case 'get_apartment_info': {
      const items = toolData.result as AgentContext['apartmentInfoItems']
      if (!items.length) return 'לא מצאתי מידע תואם על הדירה.'
      const details = items
        .slice(0, asksForBreakdown ? 8 : 4)
        .map((item) => {
          const parts = [
            item.title,
            item.provider ? `ספק: ${item.provider}` : null,
            item.meterNumber ? `מונה: ${item.meterNumber}` : null,
            item.accountNumber ? `חשבון: ${item.accountNumber}` : null,
            item.phone ? `טלפון: ${item.phone}` : null,
          ].filter(Boolean)
          return `- ${parts.join(' · ')}`
        })
        .join('\n')
      return `זה המידע שמצאתי:\n${details}`
    }

    case 'get_home_items': {
      const items = toolData.result as AgentContext['homeItems']
      if (!items.length) return 'לא מצאתי פריטים תואמים בדירה.'
      const details = items
        .slice(0, 10)
        .map((item) => `- ${item.name} · אזור: ${item.area}${item.defaultNote ? ` · ${item.defaultNote}` : ''}`)
        .join('\n')
      return `אלו הפריטים שמצאתי:\n${details}`
    }
  }
}

function tryParsePlannerResponse(output: string): PlannerResponse | null {
  try {
    return plannerResponseSchema.parse(JSON.parse(output))
  } catch {
    const jsonMatch = output.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return null

    try {
      return plannerResponseSchema.parse(JSON.parse(jsonMatch[0]))
    } catch {
      return null
    }
  }
}

async function buildNaturalToolReply(
  client: OpenAI,
  model: string,
  message: string,
  history: string,
  toolName: ReadToolName,
  toolData: ReturnType<typeof executeReadTool>,
) {
  const summaryHint =
    toolName === 'get_apartment_summary'
      ? 'If the tool is get_apartment_summary, give a short apartment status summary: tasks, shopping, tickets, and recent money activity in 2-5 short lines.'
      : toolName === 'get_balances'
        ? 'If the tool is get_balances, first infer whether the user asks who owes them money or whether they owe money to others. currentUserNetBalance > 0 means others owe the user. currentUserNetBalance < 0 means the user owes others. Answer the exact question directly with a clear yes/no if relevant, and only then add short details.'
        : toolName === 'get_expenses'
          ? 'If the recent conversation is about why others owe the user money or what created the debt, focus on expenses the user paid, with dates, amounts, and what each expense was for. Do not switch to payment transfers unless the user explicitly asks about payments.'
        : ''

  const toolAnswerResponse = await client.responses.create({
    model,
    max_output_tokens: 320,
    instructions:
      'You are an AI assistant inside the ERT shared apartment app. ' +
      'Respond in short, natural Hebrew. ' +
      'Use the tool result as the source of truth. ' +
      'Answer clearly and directly, like a helpful assistant. ' +
      'Do not mention raw IDs, JSON fields, or internal structure. ' +
      'Pay close attention to the direction of debt questions: whether the user owes money or others owe the user. ' +
      'If the user asked a short question, answer briefly. ' +
      'Give more detail only if the user explicitly asked for detail, breakdown, or explanation. ' +
      'If the tool result is empty, explain that simply. ' +
      'Do not return JSON.',
    input: [
      `User message: ${message}`,
      history ? `Conversation history:\n${history}` : '',
      summaryHint,
      `Tool used: ${toolName}`,
      `Tool result:\n${JSON.stringify(toolData, null, 2)}`,
    ]
      .filter(Boolean)
      .join('\n\n'),
  })

  return extractResponseText(toolAnswerResponse).trim()
}

function looksLikeClarifyingQuestion(reply: string) {
  const normalizedReply = normalizeText(reply)
  if (!normalizedReply) return false
  if (normalizedReply.endsWith('?')) return true

  return [
    'מה ',
    'מי ',
    'למי ',
    'כמה ',
    'איזה ',
    'איזו ',
    'מתי ',
    'באיזה ',
    'עבור מי',
    'איזה תאריך',
  ].some((prefix) => normalizedReply.startsWith(prefix))
}

function looksLikeAffirmation(message: string) {
  const normalizedMessage = normalizeText(message)
  return [
    'כן',
    'כן.',
    'כן!',
    'מאשר',
    'מאשרת',
    'תאשר',
    'אפשר',
    'סבבה',
    'אוקי',
    'אוקיי',
    'יאללה',
  ].includes(normalizedMessage)
}

function looksLikeRejection(message: string) {
  const normalizedMessage = normalizeText(message)
  return [
    'לא',
    'לא.',
    'לא תודה',
    'בטל',
    'ביטול',
    'עזוב',
  ].includes(normalizedMessage)
}

function findRoommateByName(message: string, context: AgentContext) {
  const normalizedMessage = normalizeText(message)
  const roommatesByLength = [...context.roommates].sort(
    (left, right) => right.name.length - left.name.length,
  )

  return (
    roommatesByLength.find((roommate) =>
      normalizedMessage.includes(normalizeText(roommate.name)),
    ) ?? null
  )
}

function formatSettlementsList(
  settlements: AgentContext['balanceSummary']['settlements'],
  currentUserId: number,
  direction: 'owed_to_user' | 'user_owes',
) {
  const filtered =
    direction === 'owed_to_user'
      ? settlements.filter((item) => item.payeeAccountId === currentUserId)
      : settlements.filter((item) => item.payerAccountId === currentUserId)

  if (filtered.length === 0) return null

  return filtered
    .map((item) =>
      direction === 'owed_to_user'
        ? `${item.payerName} חייב לך ${formatCurrency(item.amount)}`
        : `אתה חייב ל${item.payeeName} ${formatCurrency(item.amount)}`,
    )
    .join(', ')
}

function buildDebtDriversSummary(context: AgentContext, direction: 'owed_to_user' | 'user_owes') {
  const currentUser = context.user
  if (!currentUser) return null

  const relevantExpenses = context.expenses
    .map((expense) => {
      const participantIds = expense.participantAccountIds ?? []
      if (!participantIds.length) return null

      const amount = Number(expense.amount)
      if (!Number.isFinite(amount) || amount <= 0) return null

      const share = amount / participantIds.length
      const includesCurrentUser = participantIds.includes(currentUser.id)
      const createdCredit =
        direction === 'owed_to_user' &&
        expense.paidByAccountId === currentUser.id &&
        participantIds.some((accountId) => accountId !== currentUser.id)
      const createdDebt =
        direction === 'user_owes' &&
        includesCurrentUser &&
        expense.paidByAccountId !== currentUser.id

      if (!createdCredit && !createdDebt) return null

      return {
        description: expense.description,
        date: expense.date,
        totalAmount: amount,
        shareAmount: share,
        paidByName: expense.paidByName ?? '',
        participantNames: expense.participantNames ?? [],
      }
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item))

  const relevantPayments = context.payments
    .map((payment) => {
      const amount = Number(payment.amount)
      if (!Number.isFinite(amount) || amount <= 0) return null

      const reducedCredit =
        direction === 'owed_to_user' && payment.payeeAccountId === currentUser.id
      const reducedDebt =
        direction === 'user_owes' && payment.payerAccountId === currentUser.id

      if (!reducedCredit && !reducedDebt) return null

      return {
        amount,
        date: payment.date,
        payerName: payment.payerName ?? '',
        payeeName: payment.payeeName ?? '',
      }
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item))

  return {
    expensesText: relevantExpenses.length
      ? relevantExpenses
          .map((expense) => {
            if (direction === 'owed_to_user') {
              return `- ${expense.description} (${formatDate(expense.date)}): שילמת ${formatCurrency(expense.totalAmount)} עבור ${expense.participantNames.join(', ')}.`
            }

            return `- ${expense.description} (${formatDate(expense.date)}): ${expense.paidByName} שילם ${formatCurrency(expense.totalAmount)}, והחלק שלך הוא בערך ${formatCurrency(expense.shareAmount)}.`
          })
          .join('\n')
      : null,
    paymentsText: relevantPayments.length
      ? relevantPayments
          .map((payment) =>
            direction === 'owed_to_user'
              ? `- תשלום שהועבר אליך: ${payment.payerName} -> ${payment.payeeName}, ${formatCurrency(payment.amount)} בתאריך ${formatDate(payment.date)}.`
              : `- תשלום שכבר העברת: ${payment.payerName} -> ${payment.payeeName}, ${formatCurrency(payment.amount)} בתאריך ${formatDate(payment.date)}.`,
          )
          .join('\n')
      : null,
  }
}

function getDeterministicDebtReply(message: string, context: AgentContext) {
  const normalizedMessage = normalizeText(message)
  const currentUser = context.user
  if (!currentUser) return null

  const asksForBreakdown =
    normalizedMessage.includes('תפרט') ||
    normalizedMessage.includes('פירוט') ||
    normalizedMessage.includes('מאיפה') ||
    normalizedMessage.includes('ממה') ||
    normalizedMessage.includes('איך הגעתם') ||
    normalizedMessage.includes('איך הגעתי') ||
    normalizedMessage.includes('איך נוצר') ||
    normalizedMessage.includes('מה יצר') ||
    normalizedMessage.includes('למה חייבים לי') ||
    normalizedMessage.includes('למה חייב לי') ||
    normalizedMessage.includes('על מה חייבים לי')
  const asksWhyOthersOweUser =
    normalizedMessage.includes('למה חייבים לי') ||
    normalizedMessage.includes('למה חייב לי') ||
    normalizedMessage.includes('על מה חייבים לי')

  const namedRoommate = findRoommateByName(normalizedMessage, context)
  const asksWhoOwesUser =
    includesHebrew(normalizedMessage, HE.whoOwesMe) ||
    includesHebrew(normalizedMessage, HE.whoElseOwesMe)
  const asksHowMuchOwedToUser =
    includesHebrew(normalizedMessage, HE.howMuchOweMe) ||
    (includesHebrew(normalizedMessage, HE.howMuchNameOwesMe) &&
      (includesHebrew(normalizedMessage, HE.owe) ||
        includesHebrew(normalizedMessage, HE.owePlural)) &&
      includesHebrew(normalizedMessage, HE.toMe) &&
      !namedRoommate)
  const asksWhoUserOwes =
    includesHebrew(normalizedMessage, HE.toWhomDoIOwe) ||
    includesHebrew(normalizedMessage, HE.howMuchDoIOwe) ||
    includesHebrew(normalizedMessage, HE.whyDoIOwe)
  const asksWhyUserOwes = includesHebrew(normalizedMessage, HE.whyDoIOwe)
  const asksNamedDebtToUser =
    !!namedRoommate &&
    includesHebrew(normalizedMessage, HE.howMuchNameOwesMe) &&
    (includesHebrew(normalizedMessage, HE.owe) ||
      includesHebrew(normalizedMessage, HE.owePlural)) &&
    includesHebrew(normalizedMessage, HE.toMe)
  const asksNamedDebtFromUser =
    !!namedRoommate &&
    includesHebrew(normalizedMessage, HE.howMuchNameOwesMe) &&
    includesHebrew(normalizedMessage, HE.i) &&
    includesHebrew(normalizedMessage, HE.owe)

  if (asksNamedDebtToUser && namedRoommate) {
    const settlement = context.balanceSummary.settlements.find(
      (item) =>
        item.payerAccountId === namedRoommate.id &&
        item.payeeAccountId === currentUser.id,
    )

    return settlement
      ? `${namedRoommate.name} חייב לך ${formatCurrency(settlement.amount)}.`
      : `לפי החישוב במערכת, ${namedRoommate.name} לא חייב לך כסף כרגע.`
  }

  if (asksNamedDebtFromUser && namedRoommate) {
    const settlement = context.balanceSummary.settlements.find(
      (item) =>
        item.payerAccountId === currentUser.id &&
        item.payeeAccountId === namedRoommate.id,
    )

    return settlement
      ? `אתה חייב ל${namedRoommate.name} ${formatCurrency(settlement.amount)}.`
      : `לפי החישוב במערכת, כרגע אינך חייב כסף ל${namedRoommate.name}.`
  }

  if (asksWhoOwesUser) {
    const reply = formatSettlementsList(
      context.balanceSummary.settlements,
      currentUser.id,
      'owed_to_user',
    )

    return reply ?? HE.nobodyOwesMe
  }

  if (asksHowMuchOwedToUser) {
    const settlements = context.balanceSummary.settlements.filter(
      (item) => item.payeeAccountId === currentUser.id,
    )
    const totalOwed = settlements.reduce((sum, item) => sum + item.amount, 0)

    if (settlements.length === 0 || totalOwed <= 0.005) {
      return HE.nobodyOwesMe
    }

    const details = settlements
      .map((item) => `${item.payerName} ${formatCurrency(item.amount)}`)
      .join(', ')
    const summary = `כרגע חייבים לך בסך הכול ${formatCurrency(totalOwed)}. ${details}.`
    if (!asksForBreakdown) {
      return summary
    }
    const drivers = buildDebtDriversSummary(context, 'owed_to_user')
    const parts = [summary]

    if (drivers?.expensesText) {
      parts.push(`ההוצאות שיצרו את היתרה הנוכחית:\n${drivers.expensesText}`)
    }
    if (drivers?.paymentsText) {
      parts.push(`תשלומים שכבר נרשמו והפחיתו את החוב:\n${drivers.paymentsText}`)
    }

    return parts.join('\n\n')
  }

  if (asksWhyOthersOweUser) {
    const settlements = context.balanceSummary.settlements.filter(
      (item) => item.payeeAccountId === currentUser.id,
    )
    const totalOwed = settlements.reduce((sum, item) => sum + item.amount, 0)

    if (settlements.length === 0 || totalOwed <= 0.005) {
      return HE.nobodyOwesMe
    }

    const details = settlements
      .map((item) => `${item.payerName} ${formatCurrency(item.amount)}`)
      .join(', ')
    const parts = [
      `לפי החישוב במערכת, כרגע חייבים לך בסך הכול ${formatCurrency(totalOwed)}. ${details}.`,
    ]
    const drivers = buildDebtDriversSummary(context, 'owed_to_user')

    if (drivers?.expensesText) {
      parts.push(`ההוצאות שיצרו את היתרה הנוכחית:\n${drivers.expensesText}`)
    }
    if (drivers?.paymentsText) {
      parts.push(`תשלומים שכבר נרשמו והפחיתו את החוב:\n${drivers.paymentsText}`)
    }

    return parts.join('\n\n')
  }

  if (asksWhoUserOwes) {
    const reply = formatSettlementsList(
      context.balanceSummary.settlements,
      currentUser.id,
      'user_owes',
    )

    if (!reply) {
      return HE.youOweNobody
    }

    const drivers = buildDebtDriversSummary(context, 'user_owes')

    if (asksWhyUserOwes) {
      const parts = [`לפי החישוב במערכת, זה מצב החוב שלך כרגע: ${reply}.`]
      if (drivers?.expensesText) {
        parts.push(`ההוצאות שיצרו את החוב הנוכחי:\n${drivers.expensesText}`)
      }
      if (drivers?.paymentsText) {
        parts.push(`תשלומים שכבר נרשמו והפחיתו חלק מהחוב:\n${drivers.paymentsText}`)
      }
      return parts.join('\n\n')
    }

    if (includesHebrew(normalizedMessage, HE.toWhomDoIOwe)) {
      return reply
    }

    const totalOwed = context.balanceSummary.settlements
      .filter((item) => item.payerAccountId === currentUser.id)
      .reduce((sum, item) => sum + item.amount, 0)
    const summary = `כרגע אתה חייב בסך הכול ${formatCurrency(totalOwed)}. ${reply}.`
    if (!asksForBreakdown) {
      return summary
    }
    const parts = [summary]
    if (drivers?.expensesText) {
      parts.push(`ההוצאות שיצרו את החוב הנוכחי:\n${drivers.expensesText}`)
    }
    if (drivers?.paymentsText) {
      parts.push(`תשלומים שכבר נרשמו והפחיתו חלק מהחוב:\n${drivers.paymentsText}`)
    }

    return parts.join('\n\n')
  }

  return null
}

function getDeterministicOperationsReply(message: string, context: AgentContext) {
  const normalizedMessage = normalizeText(message)
  const overdueTasks = context.tasks.filter(
    (task) =>
      Boolean(task.dueDate) &&
      task.status !== 'done' &&
      task.status !== 'cancelled' &&
      task.dueDate! < context.today,
  )
  const openShoppingItems = context.shoppingItems.filter((item) => item.status === 'open')
  const openTickets = context.tickets.filter((ticket) => ticket.status !== 'closed')
  const myOpenTasks = context.user
    ? context.tasks.filter(
        (task) =>
          task.assigneeAccountId === context.user!.id &&
          task.status !== 'done' &&
          task.status !== 'cancelled',
      )
    : []

  const asksForOverdueTasks =
    includesHebrew(normalizedMessage, HE.overdueTasks) ||
    includesHebrew(normalizedMessage, HE.anyOverdueTasks)
  const asksForMyTasks =
    normalizedMessage.includes('\u05d4\u05de\u05d8\u05dc\u05d5\u05ea \u05e9\u05dc\u05d9') ||
    normalizedMessage.includes('\u05de\u05d4 \u05d4\u05de\u05d8\u05dc\u05d5\u05ea \u05e9\u05dc\u05d9') ||
    normalizedMessage.includes('\u05d4\u05de\u05e9\u05d9\u05de\u05d5\u05ea \u05e9\u05dc\u05d9') ||
    normalizedMessage.includes('\u05de\u05d4 \u05d4\u05de\u05e9\u05d9\u05de\u05d5\u05ea \u05e9\u05dc\u05d9') ||
    normalizedMessage.includes('\u05de\u05d4 \u05d9\u05e9 \u05dc\u05d9 \u05dc\u05e2\u05e9\u05d5\u05ea')

  if (asksForMyTasks) {
    if (!context.user) {
      return null
    }

    if (!myOpenTasks.length) {
      return 'כרגע אין לך מטלות פתוחות.'
    }

    const details = myOpenTasks
      .slice(0, 8)
      .map((task) => {
        const dueDate = task.dueDate ? ` · יעד: ${formatDate(task.dueDate)}` : ''
        const status =
          task.status === 'in_progress'
            ? ' · בסטטוס: בביצוע'
            : task.status === 'open'
              ? ' · בסטטוס: פתוחה'
              : ''
        return `- ${task.title}${dueDate}${status}`
      })
      .join('\n')

    return `אלה המטלות הפתוחות שלך כרגע:\n${details}`
  }

  if (asksForOverdueTasks) {
    if (!overdueTasks.length) {
      return 'כרגע אין מטלות באיחור.'
    }

    const details = overdueTasks
      .slice(0, 6)
      .map((task) => {
        const assignee = task.assigneeName ? ` · אחראי: ${task.assigneeName}` : ''
        return `- ${task.title} · יעד: ${formatDate(task.dueDate)}${assignee}`
      })
      .join('\n')

    return `כרגע יש ${overdueTasks.length} מטלות באיחור:\n${details}`
  }

  if (
    includesHebrew(normalizedMessage, HE.whatNeedsBuying) ||
    includesHebrew(normalizedMessage, HE.whatMissingToBuy)
  ) {
    if (!openShoppingItems.length) {
      return 'כרגע אין פריטים פתוחים ברשימת הקניות.'
    }

    const details = openShoppingItems
      .slice(0, 8)
      .map((item) =>
        item.quantity
          ? `- ${item.name} · כמות: ${item.quantity}`
          : `- ${item.name}`,
      )
      .join('\n')

    return `כרגע צריך לקנות:\n${details}`
  }

  if (includesHebrew(normalizedMessage, HE.whatUrgent)) {
    if (overdueTasks.length) {
      const topOverdue = overdueTasks
        .slice(0, 3)
        .map((task) => `- ${task.title} · יעד: ${formatDate(task.dueDate)}`)
        .join('\n')
      return `הדבר הכי דחוף כרגע הוא לטפל במטלות שבאיחור:\n${topOverdue}`
    }

    if (openTickets.length) {
      const topTickets = openTickets
        .slice(0, 3)
        .map((ticket) => `- ${ticket.title}${ticket.category ? ` · ${ticket.category}` : ''}`)
        .join('\n')
      return `אין כרגע מטלות באיחור, אבל יש פניות פתוחות שדורשות תשומת לב:\n${topTickets}`
    }

    if (openShoppingItems.length) {
      const topShopping = openShoppingItems
        .slice(0, 5)
        .map((item) => `- ${item.name}`)
        .join('\n')
      return `אין כרגע מטלות באיחור או פניות פתוחות. הפריטים הפתוחים לקנייה הם:\n${topShopping}`
    }

    return 'כרגע אין משהו דחוף במיוחד בדירה לפי הנתונים הפתוחים במערכת.'
  }

  return null
}

function findApartmentInfoItem(message: string, context: AgentContext) {
  const normalizedMessage = normalizeText(message)
  const itemsByTitleLength = [...context.apartmentInfoItems].sort(
    (left, right) => (right.title?.length ?? 0) - (left.title?.length ?? 0),
  )

  return (
    itemsByTitleLength.find((item) => {
      const fields = [item.title, item.categoryLabel, item.provider]
        .filter((field): field is string => Boolean(field))
        .map((field) => normalizeText(field))
      return fields.some((field) => normalizedMessage.includes(field))
    }) ?? null
  )
}

function getDeterministicApartmentInfoReply(message: string, context: AgentContext) {
  const normalizedMessage = normalizeText(message)
  const asksElectricMeter =
    normalizedMessage.includes('מונה חשמל') ||
    (normalizedMessage.includes('חשמל') && normalizedMessage.includes('מונה'))
  const asksWaterMeter =
    normalizedMessage.includes('מונה מים') ||
    (normalizedMessage.includes('מים') && normalizedMessage.includes('מונה'))
  const asksAccountNumber = normalizedMessage.includes('מספר חשבון')
  const asksProvider = normalizedMessage.includes('ספק')
  const asksPhone =
    normalizedMessage.includes('טלפון') ||
    normalizedMessage.includes('מספר טלפון') ||
    normalizedMessage.includes('יצירת קשר')

  const matchedItem =
    findApartmentInfoItem(message, context) ??
    context.apartmentInfoItems.find((item) => {
      const title = normalizeText(item.title ?? '')
      const category = normalizeText(item.categoryLabel ?? '')
      if (asksElectricMeter) {
        return title.includes('חשמל') || category.includes('חשמל')
      }
      if (asksWaterMeter) {
        return title.includes('מים') || category.includes('מים')
      }
      return false
    }) ??
    null

  if (!matchedItem) return null

  if (asksElectricMeter || asksWaterMeter || normalizedMessage.includes('מה המונה')) {
    return matchedItem.meterNumber
      ? `מספר המונה של ${matchedItem.title} הוא ${matchedItem.meterNumber}.`
      : `בפריט ${matchedItem.title} לא מוגדר כרגע מספר מונה.`
  }

  if (asksAccountNumber) {
    return matchedItem.accountNumber
      ? `מספר החשבון של ${matchedItem.title} הוא ${matchedItem.accountNumber}.`
      : `בפריט ${matchedItem.title} לא מוגדר כרגע מספר חשבון.`
  }

  if (asksProvider) {
    return matchedItem.provider
      ? `הספק של ${matchedItem.title} הוא ${matchedItem.provider}.`
      : `בפריט ${matchedItem.title} לא מוגדר כרגע ספק.`
  }

  if (asksPhone) {
    return matchedItem.phone
      ? `מספר הטלפון של ${matchedItem.title} הוא ${matchedItem.phone}.`
      : `בפריט ${matchedItem.title} לא מוגדר כרגע מספר טלפון.`
  }

  if (
    normalizedMessage.includes('מידע על') ||
    normalizedMessage.includes('פרטים על') ||
    normalizedMessage.includes('מה יש על')
  ) {
    const details = [
      `כותרת: ${matchedItem.title}`,
      matchedItem.categoryLabel ? `קטגוריה: ${matchedItem.categoryLabel}` : null,
      matchedItem.provider ? `ספק: ${matchedItem.provider}` : null,
      matchedItem.meterNumber ? `מספר מונה: ${matchedItem.meterNumber}` : null,
      matchedItem.accountNumber ? `מספר חשבון: ${matchedItem.accountNumber}` : null,
      matchedItem.phone ? `טלפון: ${matchedItem.phone}` : null,
      matchedItem.notes ? `הערות: ${matchedItem.notes}` : null,
    ].filter(Boolean)

    return details.join('\n')
  }

  return null
}

const QUERY_MONTHS = [
  { month: 1, names: ['\u05d9\u05e0\u05d5\u05d0\u05e8'] },
  { month: 2, names: ['\u05e4\u05d1\u05e8\u05d5\u05d0\u05e8'] },
  { month: 3, names: ['\u05de\u05e8\u05e5', '\u05de\u05e8\u05e5\''] },
  { month: 4, names: ['\u05d0\u05e4\u05e8\u05d9\u05dc'] },
  { month: 5, names: ['\u05de\u05d0\u05d9'] },
  { month: 6, names: ['\u05d9\u05d5\u05e0\u05d9'] },
  { month: 7, names: ['\u05d9\u05d5\u05dc\u05d9'] },
  { month: 8, names: ['\u05d0\u05d5\u05d2\u05d5\u05e1\u05d8'] },
  { month: 9, names: ['\u05e1\u05e4\u05d8\u05de\u05d1\u05e8'] },
  { month: 10, names: ['\u05d0\u05d5\u05e7\u05d8\u05d5\u05d1\u05e8'] },
  { month: 11, names: ['\u05e0\u05d5\u05d1\u05de\u05d1\u05e8'] },
  { month: 12, names: ['\u05d3\u05e6\u05de\u05d1\u05e8'] },
] as const

const EXPENSE_QUERY_TOPICS = [
  {
    label: '\u05de\u05d9\u05dd',
    keywords: ['\u05de\u05d9\u05dd'],
  },
  {
    label: '\u05d7\u05e9\u05de\u05dc',
    keywords: ['\u05d7\u05e9\u05de\u05dc'],
  },
  {
    label: '\u05d0\u05d9\u05e0\u05d8\u05e8\u05e0\u05d8',
    keywords: ['\u05d0\u05d9\u05e0\u05d8\u05e8\u05e0\u05d8', '\u05d5\u05d5\u05d9\u05d9\u05e4\u05d9', 'wifi'],
  },
  {
    label: '\u05d2\u05d6',
    keywords: ['\u05d2\u05d6'],
  },
  {
    label: '\u05d0\u05e8\u05e0\u05d5\u05e0\u05d4',
    keywords: ['\u05d0\u05e8\u05e0\u05d5\u05e0\u05d4'],
  },
  {
    label: '\u05e9\u05db\u05d9\u05e8\u05d5\u05ea',
    keywords: [
      '\u05e9\u05db\u05d9\u05e8\u05d5\u05ea',
      '\u05e9\u05db\u05e8 \u05d3\u05d9\u05e8\u05d4',
      '\u05e9\u05db\u05e8\u05d3\u05d9\u05e8\u05d4',
    ],
  },
  {
    label: '\u05de\u05d6\u05d5\u05df',
    keywords: ['\u05de\u05d6\u05d5\u05df', '\u05e1\u05d5\u05e4\u05e8', '\u05de\u05e7\u05d5\u05dc\u05ea'],
  },
] as const

function resolveMessageMonth(
  message: string,
  today: string,
): { month: number; year: number; label: string; monthKey: string } | null {
  const normalizedMessage = normalizeText(message)
  const explicitYearMatch = normalizedMessage.match(/\b(20\d{2})\b/)
  const currentYear = Number(today.slice(0, 4))
  const currentMonth = Number(today.slice(5, 7))

  for (const entry of QUERY_MONTHS) {
    if (!entry.names.some((name) => normalizedMessage.includes(normalizeText(name)))) {
      continue
    }

    const year = explicitYearMatch
      ? Number(explicitYearMatch[1])
      : entry.month > currentMonth
        ? currentYear - 1
        : currentYear

    return {
      month: entry.month,
      year,
      label: `${entry.names[0]} ${year}`,
      monthKey: `${year}-${String(entry.month).padStart(2, '0')}`,
    }
  }

  return null
}

function detectExpenseTopic(message: string) {
  const normalizedMessage = normalizeText(message)
  return (
    EXPENSE_QUERY_TOPICS.find((topic) =>
      topic.keywords.some((keyword) => normalizedMessage.includes(normalizeText(keyword))),
    ) ?? null
  )
}

function getDeterministicExpenseSummaryReply(message: string, context: AgentContext) {
  const normalizedMessage = normalizeText(message)
  const asksForSpentAmount =
    normalizedMessage.includes('\u05db\u05de\u05d4 \u05e9\u05d9\u05dc\u05de\u05e0\u05d5') ||
    normalizedMessage.includes('\u05db\u05de\u05d4 \u05d4\u05d5\u05e6\u05d0\u05e0\u05d5') ||
    normalizedMessage.includes('\u05de\u05d4 \u05e9\u05d9\u05dc\u05de\u05e0\u05d5') ||
    normalizedMessage.includes('\u05de\u05d4 \u05d4\u05d5\u05e6\u05d0\u05e0\u05d5')

  if (!asksForSpentAmount) {
    return null
  }

  const topic = detectExpenseTopic(message)
  const month = resolveMessageMonth(message, context.today)
  if (!topic || !month) {
    return null
  }

  const matchingExpenses = context.expenses.filter((expense) => {
    const dateMonth = expense.date.slice(0, 7)
    if (dateMonth !== month.monthKey) return false

    const haystack = normalizeText(
      [expense.description, expense.category, expense.paidByName].filter(Boolean).join(' '),
    )

    return topic.keywords.some((keyword) => haystack.includes(normalizeText(keyword)))
  })

  if (!matchingExpenses.length) {
    return `לפי ההוצאות הרשומות במערכת, לא נמצאה הוצאת ${topic.label} בחודש ${month.label}.`
  }

  const totalAmount = matchingExpenses.reduce((sum, expense) => sum + Number(expense.amount), 0)
  const details = matchingExpenses
    .map((expense) => `- ${expense.description}: ${formatCurrency(Number(expense.amount))} בתאריך ${formatDate(expense.date)}`)
    .join('\n')

  return `בחודש ${month.label} שילמתם על ${topic.label} בסך הכול ${formatCurrency(totalAmount)}.\n${details}`
}

function getDeterministicTodayReply(message: string, context: AgentContext) {
  const normalizedMessage = normalizeText(message)
  const asksForToday =
    normalizedMessage.includes('מה התאריך היום') ||
    normalizedMessage.includes('איזה תאריך היום') ||
    normalizedMessage === 'מה היום' ||
    normalizedMessage.includes('מה היום היום')

  if (!asksForToday) {
    return null
  }

  return `התאריך היום הוא ${formatDate(context.today)}.`
}

agentRouter.use(
  createRateLimit({
    windowMs: env.RATE_LIMIT_WINDOW_MS,
    max: Math.min(env.RATE_LIMIT_MAX, 30),
  }),
)
agentRouter.use(authenticate, requireAuth)

agentRouter.post('/', async (request, response, next) => {
  if (!env.OPENAI_ASSISTANT_ENABLED || !env.OPENAI_API_KEY) {
    response.status(503).json({ error: 'AI agent is not enabled on the server.' })
    return
  }

  try {
    const body = validateBody(queryBodySchema, request.body)
    const apartmentId = requireActiveApartment(request)
    const accountId = request.auth!.account.id
    const normalizedUserMessage = normalizeAgentMessageInput(body.message)
    logAgentEvent('request_start', {
      accountId,
      apartmentId,
      model: env.OPENAI_MODEL,
      message: truncateForLog(body.message),
      hasHistory: Boolean(body.history?.length),
    })
    const context = await buildAgentContext(apartmentId, accountId)
    const deterministicDebtReply = getDeterministicDebtReply(normalizedUserMessage, context)
    const deterministicOperationsReply = getDeterministicOperationsReply(normalizedUserMessage, context)
    const deterministicApartmentInfoReply = getDeterministicApartmentInfoReply(normalizedUserMessage, context)
    const deterministicExpenseSummaryReply = getDeterministicExpenseSummaryReply(
      normalizedUserMessage,
      context,
    )
    const deterministicTodayReply = getDeterministicTodayReply(normalizedUserMessage, context)
    const pendingFollowUp = getPendingAgentFollowUp(accountId, apartmentId)

    if (pendingFollowUp && looksLikeRejection(normalizedUserMessage)) {
      clearPendingAgentFollowUp(accountId, apartmentId)
      response.json({
        reply: '\u05d4\u05d1\u05e7\u05e9\u05d4 \u05d1\u05d5\u05d8\u05dc\u05d4.',
        pendingAction: null,
      })
      return
    }

    const localWriteOutput = resolveLocalWriteAction(normalizedUserMessage, context)
    const localValidatedAction = localWriteOutput?.action
      ? validateAgentAction(localWriteOutput.action)
      : null

    if (localValidatedAction) {
      const pendingAction = createPendingAgentAction({
        accountId,
        apartmentId,
        action: localValidatedAction,
      })

      clearPendingAgentFollowUp(accountId, apartmentId)
      response.json({
        reply:
          localWriteOutput?.reply?.trim() ||
          `זיהיתי פעולה מוצעת: ${pendingAction.summary}. לאשר?`,
        pendingAction,
      })
      return
    }

    const deterministicReply =
      deterministicDebtReply ||
      deterministicOperationsReply ||
      deterministicApartmentInfoReply ||
      deterministicExpenseSummaryReply ||
      deterministicTodayReply

    if (deterministicReply) {
      clearPendingAgentFollowUp(accountId, apartmentId)
      response.json({
        reply: deterministicReply,
        pendingAction: null,
      })
      return
    }

    const history = (body.history ?? [])
      .slice(-8)
      .map((item) => `${item.role === 'user' ? 'User' : 'Assistant'}: ${item.content}`)
      .join('\n')
    const localReadToolRequest = inferLocalReadToolRequest(
      pendingFollowUp?.originalMessage
        ? `${normalizeAgentMessageInput(pendingFollowUp.originalMessage)} ${normalizedUserMessage}`
        : normalizedUserMessage,
      context,
      [pendingFollowUp?.originalMessage ?? '', history, normalizedUserMessage]
        .filter(Boolean)
        .join(' '),
    )
    logAgentEvent('local_read_tool_result', {
      accountId,
      apartmentId,
      message: truncateForLog(body.message),
      localReadTool: localReadToolRequest?.name ?? null,
    })

    const client = new OpenAI({ apiKey: env.OPENAI_API_KEY })
    const openAIContext = buildScopedOpenAIContext(
      context,
      normalizedUserMessage,
      pendingFollowUp?.originalMessage,
    )

    if (localReadToolRequest) {
      const toolData = executeReadTool(
        context,
        localReadToolRequest.name,
        localReadToolRequest.args,
      )
      const llmToolReply = await buildNaturalToolReply(
        client,
        env.OPENAI_MODEL,
        body.message,
        history,
        localReadToolRequest.name,
        toolData,
      )
      const toolReply =
        llmToolReply ||
        buildToolReplyFallback(localReadToolRequest.name, toolData, context, body.message)
      logAgentEvent('local_read_tool_reply', {
        accountId,
        apartmentId,
        tool: localReadToolRequest.name,
        hasToolReply: Boolean(toolReply),
        toolReply: truncateForLog(toolReply ?? '', 220),
      })

      if (toolReply) {
        clearPendingAgentFollowUp(accountId, apartmentId)
        response.json({
          reply: toolReply,
          pendingAction: null,
        })
        return
      }
    }

    const plannerResponse = await client.responses.create({
      model: env.OPENAI_MODEL,
      max_output_tokens: 320,
      instructions:
        'You are the planner layer of the ERT apartment assistant. ' +
        'Decide whether to answer directly, ask a clarification question, call a read tool, or return a write action proposal. ' +
        'Return valid JSON only in this format: ' +
        '{"mode":"answer|ask|tool|action","reply":"string","tool":{"name":"...","args":{}}|null,"action":object|null}. ' +
        'Use mode "answer" for normal conversational answers that do not require more data. ' +
        'Use mode "ask" only when critical information is missing. ' +
        'Use mode "tool" when the user asks about tasks, shopping, tickets, expenses, payments, balances, apartment information, home items, or general apartment status and you need system data. ' +
        'Use one of these read tools only: get_tasks, get_task_summary, get_expenses, get_payments, get_balances, get_apartment_summary, get_shopping_items, get_tickets, get_apartment_info, get_home_items. ' +
        'Tool argument conventions: get_tasks supports {scope:"mine|all", status:"open|in_progress|done|cancelled", limit:number}; ' +
        'get_expenses supports {scope:"mine|all", limit:number}; ' +
        'get_payments supports {scope:"related_to_me|all", limit:number}; ' +
        'get_shopping_items supports {status:"open|purchased|all", limit:number}; ' +
        'get_tickets supports {status:"open|in_progress|closed|all", limit:number}; ' +
        'get_apartment_info supports {query:string, limit:number}; ' +
        'get_home_items supports {query:string, limit:number}. ' +
        'Examples: ' +
        '"מה המטלות שלי?" -> mode "tool" with get_tasks and scope "mine". ' +
        '"מה המצב?" -> mode "tool" with get_apartment_summary. ' +
        '"כמה אני חייב?" -> mode "tool" with get_balances. ' +
        '"מי שילם?" or "מי שילם לאחרונה?" -> mode "tool" with get_expenses or get_payments depending the question. ' +
        '"מה ההוצאות האחרונות?" -> mode "tool" with get_expenses and scope "all". ' +
        '"מה אני צריך לעשות?" -> mode "tool" with get_tasks and scope "mine". ' +
        '"מה חסר לקנות?" -> mode "tool" with get_shopping_items and status "open". ' +
        '"איזה פניות פתוחות יש?" -> mode "tool" with get_tickets and status "open". ' +
        '"מה מספר המונה חשמל?" -> mode "tool" with get_apartment_info and query "חשמל". ' +
        '"איזה פריטים יש במטבח?" -> mode "tool" with get_home_items and query "מטבח". ' +
        'Use mode "action" only when the user asks to change data in the app. ' +
        'For mode "action", action must match one of the supported write actions. ' +
        'If the user likely has a typo, infer the intended meaning instead of asking a vague fallback question. ' +
        'For mode "answer" or "ask", do not include tool or action.',
      input: [
        `Site context:\n${JSON.stringify(openAIContext, null, 2)}`,
        pendingFollowUp
          ? `Pending clarification:\nOriginal user request: ${pendingFollowUp.originalMessage}\nAssistant follow-up question: ${pendingFollowUp.latestAssistantQuestion}\nLatest user continuation: ${normalizedUserMessage}`
          : '',
        history ? `Conversation history:\n${history}` : '',
        `User message: ${body.message}`,
        normalizedUserMessage !== body.message
          ? `Normalized user message: ${normalizedUserMessage}`
          : '',
      ]
        .filter(Boolean)
        .join('\n\n'),
    })

    const plannerText = extractResponseText(plannerResponse)
    const plannerOutput = tryParsePlannerResponse(plannerText)
    logAgentEvent('planner_result', {
      accountId,
      apartmentId,
      message: truncateForLog(body.message),
      plannerMode: plannerOutput?.mode ?? null,
      plannerTool: plannerOutput?.tool?.name ?? null,
      plannerReply: truncateForLog(plannerOutput?.reply ?? plannerText ?? '', 220),
    })

    if (plannerOutput?.mode === 'answer' && plannerOutput.reply) {
      clearPendingAgentFollowUp(accountId, apartmentId)
      response.json({
        reply: plannerOutput.reply.trim(),
        pendingAction: null,
      })
      return
    }

    const contextualActionOutput = parseContextualWriteAction(normalizedUserMessage, context)
    const contextualValidatedAction = contextualActionOutput?.action
      ? validateAgentAction(contextualActionOutput.action)
      : null

    if (contextualValidatedAction) {
      const pendingAction = createPendingAgentAction({
        accountId,
        apartmentId,
        action: contextualValidatedAction,
      })

      clearPendingAgentFollowUp(accountId, apartmentId)
      response.json({
        reply:
          contextualActionOutput?.reply?.trim() ||
          `זיהיתי פעולה מוצעת: ${pendingAction.summary}. לאשר?`,
        pendingAction,
      })
      return
    }

    if (plannerOutput?.mode === 'ask' && plannerOutput.reply) {
      storePendingAgentFollowUp({
        accountId,
        apartmentId,
        originalMessage: pendingFollowUp?.originalMessage ?? normalizedUserMessage,
        latestAssistantQuestion: plannerOutput.reply.trim(),
      })
      response.json({
        reply: plannerOutput.reply.trim(),
        pendingAction: null,
      })
      return
    }

    if (plannerOutput?.mode === 'tool' && plannerOutput.tool) {
      const toolData = executeReadTool(context, plannerOutput.tool.name, plannerOutput.tool.args)
      const llmToolReply = await buildNaturalToolReply(
        client,
        env.OPENAI_MODEL,
        body.message,
        history,
        plannerOutput.tool.name,
        toolData,
      )
      const toolReply =
        llmToolReply || buildToolReplyFallback(plannerOutput.tool.name, toolData, context, body.message)
      logAgentEvent('planner_tool_reply', {
        accountId,
        apartmentId,
        tool: plannerOutput.tool.name,
        hasToolReply: Boolean(toolReply),
        toolReply: truncateForLog(toolReply ?? '', 220),
      })
      if (toolReply) {
        clearPendingAgentFollowUp(accountId, apartmentId)
        response.json({
          reply: toolReply,
          pendingAction: null,
        })
        return
      }
    }

    const plannerValidatedAction =
      plannerOutput?.mode === 'action' && plannerOutput.action
        ? validateAgentAction(plannerOutput.action)
        : null

    if (plannerValidatedAction) {
      const pendingAction = createPendingAgentAction({
        accountId,
        apartmentId,
        action: plannerValidatedAction,
      })

      clearPendingAgentFollowUp(accountId, apartmentId)
      response.json({
        reply:
          plannerOutput?.reply?.trim() ||
          `זיהיתי פעולה מוצעת: ${pendingAction.summary}. לאשר?`,
        pendingAction,
      })
      return
    }

    const aiResponse = await client.responses.create({
      model: env.OPENAI_MODEL,
      max_output_tokens: 420,
      instructions:
        'You are an AI assistant inside the ERT shared apartment app. Respond in short, natural Hebrew. ' +
        'Use only the site context provided to you as the source of truth. ' +
        'Do not claim that you already performed a change in the app. ' +
        'When the user asks to change data in the app, return a structured action for confirmation. ' +
        'If there is a pending clarification context, treat the latest user message as a continuation of the original request unless the new message is clearly unrelated. ' +
        'If the latest user message is only an approval such as "כן" to a previous proposal, return the structured action now instead of a conversational reply. ' +
        'Act like a helpful apartment assistant, not like a form validator. ' +
        'Understand natural phrasing, small typos, and imperfect Hebrew when the user intent is still reasonably clear. ' +
        'If the intent is clear, help the user naturally. Ask a clarification question only when there is real ambiguity that could materially change the action or answer. ' +
        'Always return valid JSON only in this format: {"reply":"text for the user","action":null or object}. ' +
        'Allowed actions: ' +
        'create_task {title, taskType, targetItemName, description, assigneeName, dueDate}; ' +
        'update_task_due_date {taskId, taskTitle, dueDate}; ' +
        'update_task_status {taskId, taskTitle, status}; ' +
        'create_expense {description, amount, category, date, paidByName, participantNames}; ' +
        'create_payment {payerName, payeeName, amount, paymentDate, note}; ' +
        'create_shopping_item {itemName, quantity, category}; ' +
        'cancel_shopping_items {itemName, mode}; ' +
        'create_ticket {title, description, category}. ' +
        'Use cancel_shopping_items when the user asks to remove, cancel, delete, or clear shopping items from the shopping list. ' +
        'For "תבטל הכל" or "תמחק את כל..." return mode "all_matching". For a single item return mode "single_latest". ' +
        'When the user specifies who shares an expense, include those roommate names in create_expense.participantNames. ' +
        'If the user says the expense is split equally only between specific people, do not include other roommates. ' +
        'If the user describes money transfer between roommates such as "דוד שילם לי 500", "שילמתי לדוד", or "תרשום תשלום", use create_payment and not create_expense. ' +
        'Examples: "אני ויוני", "ביני לבין יוני", "רק אני ויוני", "אני, יוני ודוד" should map to exactly those participants. ' +
        'Allowed status values: open, in_progress, done, cancelled. ' +
        'Allowed taskType values: cleaning, maintenance, shopping, inspection, other. ' +
        'Allowed ticket categories: issue, request, finance, other. ' +
        'If context.balanceSummary exists, use it directly for debt and balance questions. ' +
        'Interpretation: each settlement means payerName owes payeeName the listed amount. ' +
        'A positive net balance means others owe that roommate money. A negative net balance means that roommate owes money to others. ' +
        'If the user asks why they owe money or who owes them money, explain based on balanceSummary and the actual expenses/payments context, not with a generic answer. ' +
        'If required information is missing, ask a short follow-up question and do not return an action.',
      input: [
          `Site context:\n${JSON.stringify(openAIContext, null, 2)}`,
          pendingFollowUp
            ? `Pending clarification:\nOriginal user request: ${pendingFollowUp.originalMessage}\nAssistant follow-up question: ${pendingFollowUp.latestAssistantQuestion}\nLatest user continuation: ${normalizedUserMessage}\nUser continuation type: ${
              looksLikeAffirmation(normalizedUserMessage)
                ? 'affirmative confirmation'
                : looksLikeRejection(normalizedUserMessage)
                  ? 'rejection'
                  : 'additional information'
            }`
          : '',
        history ? `Conversation history:\n${history}` : '',
        `User message: ${body.message}`,
        normalizedUserMessage !== body.message
          ? `Normalized user message: ${normalizedUserMessage}`
          : '',
      ]
        .filter(Boolean)
        .join('\n\n'),
    })

    const aiResponseText = extractResponseText(aiResponse)
    let agentOutput = parseAgentOutput(aiResponseText)
    let validatedAction = agentOutput.action ? validateAgentAction(agentOutput.action) : null

    if (pendingFollowUp && looksLikeAffirmation(normalizedUserMessage) && !validatedAction) {
      const confirmationResponse = await client.responses.create({
        model: env.OPENAI_MODEL,
        max_output_tokens: 220,
        instructions:
          'The user confirmed a previously proposed action inside the ERT shared apartment app. ' +
          'Return valid JSON only in this format: {"reply":"short Hebrew confirmation","action":object}. ' +
          'Do not return action null unless the original request is still truly ambiguous. ' +
          'If the original request was to change data in the app and the user answered "כן", return the structured action now. ' +
          'Allowed actions: ' +
          'create_task {title, taskType, targetItemName, description, assigneeName, dueDate}; ' +
          'update_task_due_date {taskId, taskTitle, dueDate}; ' +
          'update_task_status {taskId, taskTitle, status}; ' +
          'create_expense {description, amount, category, date, paidByName, participantNames}; ' +
          'create_payment {payerName, payeeName, amount, paymentDate, note}; ' +
          'create_shopping_item {itemName, quantity, category}; ' +
          'cancel_shopping_items {itemName, mode}; ' +
          'create_ticket {title, description, category}.',
        input: [
          `Site context:\n${JSON.stringify(openAIContext, null, 2)}`,
          `Original user request: ${pendingFollowUp.originalMessage}`,
          `Assistant follow-up question: ${pendingFollowUp.latestAssistantQuestion}`,
          `User confirmation: ${body.message}`,
          normalizedUserMessage !== body.message
            ? `Normalized user confirmation: ${normalizedUserMessage}`
            : '',
        ].join('\n\n'),
      })

      const confirmationOutput = parseAgentOutput(extractResponseText(confirmationResponse))
      const confirmationAction = confirmationOutput.action
        ? validateAgentAction(confirmationOutput.action)
        : null

      if (confirmationAction) {
        agentOutput = confirmationOutput
        validatedAction = confirmationAction
      }
    }

    if (!hasMeaningfulAgentReply(agentOutput.reply, agentOutput.action, validatedAction)) {
      logAgentEvent('fallback_freeform_start', {
        accountId,
        apartmentId,
        message: truncateForLog(body.message),
      })
      const fallbackResponse = await client.responses.create({
        model: env.OPENAI_MODEL,
        max_output_tokens: 260,
        instructions:
          'You are an AI assistant inside the ERT shared apartment app. ' +
          'Respond in short, natural Hebrew. ' +
          'Do not return JSON. ' +
          'Answer based only on the provided site context. ' +
          'If the user asked to change data in the app but details are missing, ask one short clarification question. ' +
          'If the user asked about existing data, answer directly and clearly.',
        input: [
          `Site context:\n${JSON.stringify(openAIContext, null, 2)}`,
          pendingFollowUp
            ? `Pending clarification:\nOriginal user request: ${pendingFollowUp.originalMessage}\nAssistant follow-up question: ${pendingFollowUp.latestAssistantQuestion}\nLatest user continuation: ${normalizedUserMessage}`
            : '',
          history ? `Conversation history:\n${history}` : '',
          `User message: ${body.message}`,
          normalizedUserMessage !== body.message
            ? `Normalized user message: ${normalizedUserMessage}`
            : '',
        ]
          .filter(Boolean)
          .join('\n\n'),
      })

      const fallbackReply = extractResponseText(fallbackResponse).trim()
      logAgentEvent('fallback_freeform_result', {
        accountId,
        apartmentId,
        hasFallbackReply: Boolean(fallbackReply),
        fallbackReply: truncateForLog(fallbackReply, 220),
      })
      if (fallbackReply) {
        agentOutput = {
          ...agentOutput,
          reply: fallbackReply,
        }
      }
    }

    const pendingAction = validatedAction
      ? createPendingAgentAction({
          accountId,
          apartmentId,
          action: validatedAction,
        })
      : null
    const finalReplyText =
      (agentOutput.reply || aiResponseText || '').trim() ||
      (pendingAction
        ? `זיהיתי פעולה מוצעת: ${pendingAction.summary}. לאשר?`
        : 'לא הצלחתי לנסח תשובה כרגע. נסה לנסח שוב או לפרט קצת יותר.')

    if (pendingAction) {
      clearPendingAgentFollowUp(accountId, apartmentId)
    } else if (looksLikeClarifyingQuestion(finalReplyText)) {
      storePendingAgentFollowUp({
        accountId,
        apartmentId,
        originalMessage: pendingFollowUp?.originalMessage ?? normalizedUserMessage,
        latestAssistantQuestion: finalReplyText,
      })
    } else {
      clearPendingAgentFollowUp(accountId, apartmentId)
    }

    logAgentEvent('request_complete', {
      accountId,
      apartmentId,
      hasPendingAction: Boolean(pendingAction),
      finalReply: truncateForLog(finalReplyText, 220),
    })

    response.json({
      reply: finalReplyText,
      pendingAction,
    })
  } catch (error) {
    next(error)
  }
})

agentRouter.post('/confirm', async (request, response, next) => {
  try {
    const body = validateBody(confirmBodySchema, request.body)
    const apartmentId = requireActiveApartment(request)
    const accountId = request.auth!.account.id
    const result = await confirmPendingAgentAction({
      token: body.token,
      accountId,
      apartmentId,
    })
    clearPendingAgentFollowUp(accountId, apartmentId)

    response.json(result)
  } catch (error) {
    next(error)
  }
})



