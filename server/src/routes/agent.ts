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
    tasks: scope.tasks ? context.tasks.slice(0, 8) : undefined,
    expenses: scope.finance
      ? context.expenses.slice(0, 6).map((expense) => ({
          id: expense.id,
          description: expense.description,
          amount: expense.amount,
          category: expense.category,
          date: expense.date,
          paidByName: expense.paidByName,
        }))
      : undefined,
    payments: scope.finance
      ? context.payments.slice(0, 6).map((payment) => ({
          id: payment.id,
          amount: payment.amount,
          date: payment.date,
          payerName: payment.payerName,
          payeeName: payment.payeeName,
          note: payment.note,
        }))
      : undefined,
    shoppingItems: scope.shopping ? context.shoppingItems.slice(0, 8) : undefined,
    tickets: scope.tickets ? context.tickets.slice(0, 6) : undefined,
    homeItems: scope.homeItems || scope.tasks ? context.homeItems.slice(0, 8) : undefined,
    apartmentInfoItems: ['דירה', 'כתובת', 'מונה', 'חשמל', 'מים', 'ספק', 'חשבון', 'טלפון'].some(
      (term) => normalizedCombinedMessage.includes(term),
    )
      ? context.apartmentInfoItems.slice(0, 10)
      : undefined,
    balanceSummary: scope.finance ? context.balanceSummary : undefined,
  }
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
    const drivers = buildDebtDriversSummary(context, 'owed_to_user')
    const parts = [
      `כרגע חייבים לך בסך הכול ${formatCurrency(totalOwed)}. ${details}.`,
    ]

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
    const parts = [`כרגע אתה חייב בסך הכול ${formatCurrency(totalOwed)}. ${reply}.`]
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

  const asksForOverdueTasks =
    includesHebrew(normalizedMessage, HE.overdueTasks) ||
    includesHebrew(normalizedMessage, HE.anyOverdueTasks)

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
    const context = await buildAgentContext(apartmentId, accountId)
    const deterministicDebtReply = getDeterministicDebtReply(body.message, context)
    const deterministicOperationsReply = getDeterministicOperationsReply(body.message, context)
    const deterministicApartmentInfoReply = getDeterministicApartmentInfoReply(body.message, context)
    const deterministicExpenseSummaryReply = getDeterministicExpenseSummaryReply(body.message, context)
    const deterministicTodayReply = getDeterministicTodayReply(body.message, context)
    const pendingFollowUp = getPendingAgentFollowUp(accountId, apartmentId)

    if (deterministicDebtReply) {
      clearPendingAgentFollowUp(accountId, apartmentId)
      response.json({
        reply: deterministicDebtReply,
        pendingAction: null,
      })
      return
    }

    if (deterministicOperationsReply) {
      clearPendingAgentFollowUp(accountId, apartmentId)
      response.json({
        reply: deterministicOperationsReply,
        pendingAction: null,
      })
      return
    }

    if (deterministicApartmentInfoReply) {
      clearPendingAgentFollowUp(accountId, apartmentId)
      response.json({
        reply: deterministicApartmentInfoReply,
        pendingAction: null,
      })
      return
    }

    if (deterministicExpenseSummaryReply) {
      clearPendingAgentFollowUp(accountId, apartmentId)
      response.json({
        reply: deterministicExpenseSummaryReply,
        pendingAction: null,
      })
      return
    }

    if (deterministicTodayReply) {
      clearPendingAgentFollowUp(accountId, apartmentId)
      response.json({
        reply: deterministicTodayReply,
        pendingAction: null,
      })
      return
    }

    const client = new OpenAI({ apiKey: env.OPENAI_API_KEY })
    const history = (body.history ?? [])
      .slice(-8)
      .map((item) => `${item.role === 'user' ? 'User' : 'Assistant'}: ${item.content}`)
      .join('\n')
    const openAIContext = buildScopedOpenAIContext(
      context,
      body.message,
      pendingFollowUp?.originalMessage,
    )

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
        'create_shopping_item {itemName, quantity, category}; ' +
        'cancel_shopping_items {itemName, mode}; ' +
        'create_ticket {title, description, category}. ' +
        'Use cancel_shopping_items when the user asks to remove, cancel, delete, or clear shopping items from the shopping list. ' +
        'For "תבטל הכל" or "תמחק את כל..." return mode "all_matching". For a single item return mode "single_latest". ' +
        'When the user specifies who shares an expense, include those roommate names in create_expense.participantNames. ' +
        'If the user says the expense is split equally only between specific people, do not include other roommates. ' +
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
          ? `Pending clarification:\nOriginal user request: ${pendingFollowUp.originalMessage}\nAssistant follow-up question: ${pendingFollowUp.latestAssistantQuestion}\nLatest user continuation: ${body.message}\nUser continuation type: ${
              looksLikeAffirmation(body.message)
                ? 'affirmative confirmation'
                : looksLikeRejection(body.message)
                  ? 'rejection'
                  : 'additional information'
            }`
          : '',
        history ? `Conversation history:\n${history}` : '',
        `User message: ${body.message}`,
      ]
        .filter(Boolean)
        .join('\n\n'),
    })

    const aiResponseText = extractResponseText(aiResponse)
    let agentOutput = parseAgentOutput(aiResponseText)
    let validatedAction = agentOutput.action ? validateAgentAction(agentOutput.action) : null

    if (pendingFollowUp && looksLikeAffirmation(body.message) && !validatedAction) {
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
          'create_shopping_item {itemName, quantity, category}; ' +
          'cancel_shopping_items {itemName, mode}; ' +
          'create_ticket {title, description, category}.',
        input: [
          `Site context:\n${JSON.stringify(openAIContext, null, 2)}`,
          `Original user request: ${pendingFollowUp.originalMessage}`,
          `Assistant follow-up question: ${pendingFollowUp.latestAssistantQuestion}`,
          `User confirmation: ${body.message}`,
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

    const pendingAction = validatedAction
      ? createPendingAgentAction({
          accountId,
          apartmentId,
          action: validatedAction,
        })
      : null
    const rawReplyText =
      agentOutput.reply ||
      aiResponse.output_text ||
      (pendingAction ? `זיהיתי פעולה מוצעת: ${pendingAction.summary}. לאשר?` : '')
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
        originalMessage: pendingFollowUp?.originalMessage ?? body.message,
        latestAssistantQuestion: finalReplyText,
      })
    } else {
      clearPendingAgentFollowUp(accountId, apartmentId)
    }

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
