import type { buildAgentContext } from './agent-context-service.js'

export type AgentLocalResolverContext = Awaited<ReturnType<typeof buildAgentContext>>

export type ReadToolName =
  | 'get_tasks'
  | 'get_task_summary'
  | 'get_expenses'
  | 'get_payments'
  | 'get_balances'
  | 'get_apartment_summary'
  | 'get_shopping_items'
  | 'get_tickets'
  | 'get_apartment_info'
  | 'get_home_items'

export interface ReadToolRequest {
  name: ReadToolName
  args?: Record<string, unknown>
}

export interface LocalWriteResolution {
  reply: string
  action: unknown
}

function inferCurrentUserName(context: AgentLocalResolverContext) {
  return context.user?.name ?? null
}

function parseAmountFromMessage(message: string) {
  const amountMatch =
    message.match(/(\d+(?:[.,]\d+)?)\s*(?:₪|ש["׳]ח|שח|שקל(?:ים)?)/u) ??
    message.match(/(\d+(?:[.,]\d+)?)/u)

  if (!amountMatch) return null

  const amount = Number(amountMatch[1].replace(',', '.'))
  return Number.isFinite(amount) && amount > 0 ? amount : null
}

function parseDateFromMessage(message: string) {
  const isoDateMatch = message.match(/\b(\d{4}-\d{2}-\d{2})\b/u)
  if (isoDateMatch) return isoDateMatch[1]

  const shortDateMatch = message.match(/\b(\d{1,2})[./](\d{1,2})[./](\d{4})\b/u)
  if (!shortDateMatch) return null

  const day = shortDateMatch[1].padStart(2, '0')
  const month = shortDateMatch[2].padStart(2, '0')
  const year = shortDateMatch[3]
  return `${year}-${month}-${day}`
}

function includesAny(text: string, options: string[]) {
  return options.some((option) => text.includes(option))
}

export function normalizeText(value: string) {
  return value.replace(/\s+/g, ' ').trim()
}

export function normalizeAgentMessage(value: string) {
  let normalized = normalizeText(value)

  const replacements: Array<[string, string]> = [
    ['כסך', 'כסף'],
    ['כספ', 'כסף'],
    ['שלצתטי', 'שילמתי'],
    ['שלצתי', 'שילמתי'],
    ['שלמתי', 'שילמתי'],
    ['שלחתי', 'שילמתי'],
    ['המטלטות', 'המטלות'],
    ['מטלטות', 'מטלות'],
    ['מטלטה', 'מטלה'],
    ['חשמלל', 'חשמל'],
    ['מיים', 'מים'],
    ['קנייות', 'קניות'],
    ['לחשבון חשמל', 'חשבון חשמל'],
    ['מחולר', 'מחולק'],
  ]

  for (const [source, target] of replacements) {
    normalized = normalized.split(source).join(target)
  }

  return normalizeText(normalized)
}

function extractMentionedRoommateNames(message: string, context: AgentLocalResolverContext) {
  const normalizedMessage = normalizeText(message)

  return [...context.roommates]
    .sort((left, right) => right.name.length - left.name.length)
    .filter((roommate) => {
      const normalizedRoommateName = normalizeText(roommate.name)
      const firstName = normalizedRoommateName.split(' ')[0] ?? normalizedRoommateName
      return (
        normalizedMessage.includes(normalizedRoommateName) ||
        normalizedMessage.includes(`ל${normalizedRoommateName}`) ||
        normalizedMessage.includes(firstName) ||
        normalizedMessage.includes(`ל${firstName}`)
      )
    })
    .map((roommate) => roommate.name)
}

function extractFirstMatchingTaskTitle(message: string, context: AgentLocalResolverContext) {
  const normalizedMessage = normalizeText(message)

  return [...context.tasks]
    .sort((left, right) => right.title.length - left.title.length)
    .find((task) => normalizedMessage.includes(normalizeText(task.title)))
    ?.title
}

function parseShoppingQuantity(commandBody: string) {
  const quantityMatch = commandBody.match(/(.+?)\s+(\d+(?:[.,]\d+)?)$/u)
  return {
    itemName: quantityMatch?.[1]?.trim() ?? commandBody.trim(),
    quantity: quantityMatch?.[2]?.trim() ?? null,
  }
}

function parseDirectShoppingAction(message: string): LocalWriteResolution | null {
  const normalizedMessage = normalizeText(message)
  if (!normalizedMessage.includes('תוסיף')) return null
  if (!includesAny(normalizedMessage, ['רשימת קניות', 'לקניות', 'לקנות'])) return null

  const itemMatch =
    message.match(/תוסיף\s+(.+?)\s+לרשימת\s+קניות/ui) ??
    message.match(/תוסיף\s+(.+?)\s+לקניות/ui) ??
    message.match(/תוסיף\s+(.+?)\s+לקנות/ui)

  const rawValue = itemMatch?.[1]?.trim()
  if (!rawValue) return null

  const { itemName, quantity } = parseShoppingQuantity(rawValue.replace(/^לי\s+/u, '').trim())
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

function parseDirectExpenseAction(message: string): LocalWriteResolution | null {
  const normalizedMessage = normalizeText(message)
  const amount = parseAmountFromMessage(message)
  if (!amount) return null
  if (!includesAny(normalizedMessage, ['הוצאה', 'תוסיף', 'תרשום', 'תכניס'])) return null

  const descriptionMatch =
    message.match(/על\s+(.+?)(?:\s+ותחלק|\s+ותחלקי|\s+בין\s+|$)/u) ??
    message.match(/הוצאה\s+של\s+(.+?)(?:\s+בסכום|\s+על\s+|\s+בין\s+|$)/u)

  const description = descriptionMatch?.[1]?.trim() ?? 'הוצאה חדשה'
  if (!description) return null

  const splitBetweenEveryone = includesAny(normalizedMessage, [
    'בין כולם',
    'בין כל הדיירים',
    'שווה בשווה',
  ])

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

function parsePaymentAction(
  message: string,
  context: AgentLocalResolverContext,
): LocalWriteResolution | null {
  const normalizedMessage = normalizeText(message)
  const amount = parseAmountFromMessage(message)
  if (!amount) return null

  const looksLikePayment = includesAny(normalizedMessage, [
    'שילם לי',
    'שילמה לי',
    'העביר לי',
    'העבירה לי',
    'שילמתי ל',
    'שילמתי ל',
    'העברתי ל',
    'העברתי ל',
    'תרשום תשלום',
    'תוסיף תשלום',
  ])

  if (!looksLikePayment) return null

  const roommateNames = extractMentionedRoommateNames(message, context)
  const currentUserName = inferCurrentUserName(context)

  const payerName = includesAny(normalizedMessage, ['שילם לי', 'שילמה לי', 'העביר לי', 'העבירה לי'])
    ? (roommateNames[0] ?? null)
    : currentUserName

  const payeeName = includesAny(normalizedMessage, ['שילם לי', 'שילמה לי', 'העביר לי', 'העבירה לי'])
    ? currentUserName
    : (roommateNames[0] ?? null)

  if (!payerName || !payeeName) return null

  return {
    reply: `זיהיתי בקשה לרשום תשלום של ${amount} ש"ח: ${payerName} -> ${payeeName}. לאשר?`,
    action: {
      type: 'create_payment',
      payload: {
        payerName,
        payeeName,
        amount,
        paymentDate: parseDateFromMessage(message),
        note: null,
      },
    },
  }
}

function parseContextualExpenseAction(
  message: string,
  context: AgentLocalResolverContext,
): LocalWriteResolution | null {
  const normalizedMessage = normalizeText(message)
  const amount = parseAmountFromMessage(message)
  if (!amount) return null

  const looksLikeExpenseAction =
    includesAny(normalizedMessage, ['הוצאה', 'תוסיף', 'תרשום', 'תכניס']) &&
    includesAny(normalizedMessage, ['תחלק', 'בין', 'מחולק', 'מחולקת'])

  if (!looksLikeExpenseAction) return null

  const descriptionMatch =
    message.match(/על\s+(.+?)(?:\s+ותחלק|\s+ותחלקי|\s+בין\s+|$)/iu) ??
    message.match(
      /הוצאה\s+(?:של\s+)?(.+?)(?:\s+בסך|\s+\d+(?:[.,]\d+)?\s*(?:₪|ש["׳]ח|שח|שקל(?:ים)?)|\s+בין\s+|\s+ותחלק|$)/iu,
    )

  const description = descriptionMatch?.[1]?.trim() ?? 'הוצאה חדשה'
  if (!description) return null

  const splitBetweenEveryone = includesAny(normalizedMessage, [
    'בין כולם',
    'בין כל הדיירים',
    'שווה בשווה',
  ])

  const participantNames = splitBetweenEveryone
    ? []
    : extractMentionedRoommateNames(message, context)

  if (!splitBetweenEveryone && normalizedMessage.includes('בין') && participantNames.length === 0) {
    return null
  }

  const participantSummary = participantNames.length ? ` (${participantNames.join(', ')})` : ''

  return {
    reply: `זיהיתי בקשה להוסיף הוצאה של ${amount} ש"ח עבור ${description}${participantSummary}. לאשר?`,
    action: {
      type: 'create_expense',
      payload: {
        description,
        amount,
        category: description,
        date: parseDateFromMessage(message),
        paidByName: null,
        participantNames: participantNames.length > 0 ? participantNames : null,
      },
    },
  }
}

function parseContextualShoppingAction(message: string): LocalWriteResolution | null {
  const normalizedMessage = normalizeText(message)
  const looksLikeShoppingAction =
    includesAny(normalizedMessage, ['רשימת קניות', 'לקניות', 'לקנות']) &&
    includesAny(normalizedMessage, ['תוסיף', 'תרשום', 'תכניס'])

  if (!looksLikeShoppingAction) return null

  const commandBody = normalizeText(
    message
      .replace(/^(?:תוסיף|תרשום|תכניס)\s+/u, '')
      .replace(/^לי\s+/u, '')
      .replace(/\s+לרשימת\s+קניות$/u, '')
      .replace(/\s+לקניות$/u, '')
      .replace(/\s+לקנות$/u, ''),
  )

  if (!commandBody) return null

  const { itemName, quantity } = parseShoppingQuantity(commandBody)
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

function parseContextualCancelShoppingAction(message: string): LocalWriteResolution | null {
  const normalizedMessage = normalizeText(message)
  const looksLikeCancel = includesAny(normalizedMessage, ['תבטל', 'תמחק', 'תסיר', 'תוריד'])
  const looksLikeShopping = includesAny(normalizedMessage, [
    'קניות',
    'רשימת קניות',
    'לקנות',
  ])

  if (!looksLikeCancel || !looksLikeShopping) return null

  const itemMatch = message.match(
    /(?:תבטל|תמחק|תסיר|תוריד)\s+(?:את\s+)?(?:הפריט\s+)?(.+?)(?:\s+מרשימת\s+הקניות|\s+מהקניות|\s+מהרשימה|$)/iu,
  )

  const itemName = itemMatch?.[1]?.trim()
  if (!itemName) return null

  return {
    reply: `זיהיתי בקשה לבטל את פריט הקניות ${itemName}. לאשר?`,
    action: {
      type: 'cancel_shopping_items',
      payload: {
        itemName,
        mode: includesAny(normalizedMessage, ['הכל', 'כל']) ? 'all_matching' : 'single_latest',
      },
    },
  }
}

function parseContextualTaskStatusAction(
  message: string,
  context: AgentLocalResolverContext,
): LocalWriteResolution | null {
  const normalizedMessage = normalizeText(message)
  const taskTitle = extractFirstMatchingTaskTitle(message, context)
  if (!taskTitle) return null

  const status =
    includesAny(normalizedMessage, ['הושלם', 'הושלמה', 'בוצע', 'בוצעה', 'סיים', 'סגור'])
      ? 'done'
      : includesAny(normalizedMessage, ['בביצוע', 'בתהליך'])
        ? 'in_progress'
        : includesAny(normalizedMessage, ['בטל', 'מבוטל'])
          ? 'cancelled'
          : includesAny(normalizedMessage, ['פתח', 'פתוח'])
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

function parseContextualTaskDueDateAction(
  message: string,
  context: AgentLocalResolverContext,
): LocalWriteResolution | null {
  const normalizedMessage = normalizeText(message)
  const taskTitle = extractFirstMatchingTaskTitle(message, context)
  if (!taskTitle) return null

  if (!includesAny(normalizedMessage, ['תאריך', 'יעד', 'עד '])) return null

  const dueDate = parseDateFromMessage(message)
  if (!dueDate) return null

  return {
    reply: `זיהיתי בקשה לעדכן את תאריך היעד של המטלה ${taskTitle}. לאשר?`,
    action: {
      type: 'update_task_due_date',
      payload: {
        taskTitle,
        dueDate,
      },
    },
  }
}

function parseContextualTaskAction(
  message: string,
  context: AgentLocalResolverContext,
): LocalWriteResolution | null {
  const normalizedMessage = normalizeText(message)
  const looksLikeTaskAction =
    includesAny(normalizedMessage, ['מטלה', 'משימה']) &&
    includesAny(normalizedMessage, ['תוסיף', 'תפתח', 'תיצור', 'תרשום'])

  if (!looksLikeTaskAction) return null

  const titleMatch =
    message.match(/(?:מטלה|משימה)\s+(?:של\s+)?(.+?)(?:\s+ל.+|\s+עד\s+|$)/iu) ??
    message.match(
      /(?:תוסיף|תפתח|תיצור|תרשום)\s+(?:לי\s+)?(?:מטלה|משימה)\s+(.+?)(?:\s+ל.+|\s+עד\s+|$)/iu,
    )

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
        dueDate: parseDateFromMessage(message),
      },
    },
  }
}

function parseContextualTicketAction(message: string): LocalWriteResolution | null {
  const normalizedMessage = normalizeText(message)
  const looksLikeTicketAction =
    includesAny(normalizedMessage, ['פנייה', 'תקלה', 'בקשה']) &&
    includesAny(normalizedMessage, ['תפתח', 'פתח', 'תיצור', 'תרשום'])

  if (!looksLikeTicketAction) return null

  const titleMatch =
    message.match(/(?:פנייה|תקלה|בקשה)\s+(?:על\s+)?(.+)$/iu) ??
    message.match(
      /(?:תפתח|פתח|תיצור|תרשום)\s+(?:לי\s+)?(?:פנייה|תקלה|בקשה)\s+(?:על\s+)?(.+)$/iu,
    )

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

export function resolveLocalWriteAction(
  message: string,
  context: AgentLocalResolverContext,
): LocalWriteResolution | null {
  const normalizedMessage = normalizeAgentMessage(message)

  return (
    parsePaymentAction(normalizedMessage, context) ??
    parseDirectShoppingAction(normalizedMessage) ??
    parseContextualShoppingAction(normalizedMessage) ??
    parseContextualCancelShoppingAction(normalizedMessage) ??
    parseContextualExpenseAction(normalizedMessage, context) ??
    parseDirectExpenseAction(normalizedMessage) ??
    parseContextualTaskStatusAction(normalizedMessage, context) ??
    parseContextualTaskDueDateAction(normalizedMessage, context) ??
    parseContextualTaskAction(normalizedMessage, context) ??
    parseContextualTicketAction(normalizedMessage)
  )
}

export function inferLocalReadToolRequest(
  message: string,
  context: AgentLocalResolverContext,
  conversationContext = '',
): ReadToolRequest | null {
  const normalizedMessage = normalizeAgentMessage(message)
  const normalizedConversationContext = normalizeAgentMessage(conversationContext)

  const asksForMoreDetail = includesAny(normalizedMessage, [
    'תפרט',
    'תראה לי הכל',
    'כולל תאריכים',
    'כולל סכום',
    'על מה',
    'מה שילמתי',
  ])

  const conversationIsAboutDebtFromExpenses = includesAny(normalizedConversationContext, [
    'למה חייבים לי',
    'מה שילמתי שיצר את החוב',
    'איזה הוצאות',
    'הוצאות שיצרו',
    'חייבים לי כסף',
  ])

  if (asksForMoreDetail && conversationIsAboutDebtFromExpenses) {
    return {
      name: 'get_expenses',
      args: { scope: 'mine', limit: 12 },
    }
  }

  if (
    includesAny(normalizedMessage, [
      'מה המטלות שלי',
      'המטלות שלי',
      'המשימות שלי',
      'מה יש לי לעשות',
    ])
  ) {
    return {
      name: 'get_tasks',
      args: { scope: 'mine', limit: 10 },
    }
  }

  if (
    includesAny(normalizedMessage, [
      'מה חסר לקנות',
      'מה צריך לקנות',
      'רשימת קניות',
      'קניות פתוחות',
    ])
  ) {
    return {
      name: 'get_shopping_items',
      args: { status: 'open', limit: 12 },
    }
  }

  if (
    includesAny(normalizedMessage, [
      'פניות פתוחות',
      'תקלות פתוחות',
      'איזה פניות',
      'איזה תקלות',
    ])
  ) {
    return {
      name: 'get_tickets',
      args: { status: 'open', limit: 10 },
    }
  }

  if (includesAny(normalizedMessage, ['מונה', 'ספק', 'מספר חשבון', 'טלפון'])) {
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
      name: 'get_apartment_info',
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
    includesAny(normalizedMessage, ['פריט', 'פריטים', 'יש ב', 'מה יש ב'])
  ) {
    return {
      name: 'get_home_items',
      args: { query: matchingHomeItem.area, limit: 12 },
    }
  }

  if (includesAny(normalizedMessage, ['מי שילם', 'תשלומים אחרונים', 'מי העביר'])) {
    return {
      name: 'get_payments',
      args: { scope: 'all', limit: 8 },
    }
  }

  if (
    includesAny(normalizedMessage, [
      'הוצאות אחרונות',
      'מה ההוצאות',
      'על מה הוצאנו',
      'למה חייבים לי',
      'למה חייב לי',
      'ממה נובע החוב אליי',
      'איזה הוצאות יצרו את החוב אליי',
    ])
  ) {
    return {
      name: 'get_expenses',
      args: {
        scope: includesAny(normalizedMessage, ['למה חייבים לי', 'למה חייב לי', 'החוב אליי'])
          ? 'mine'
          : 'all',
        limit: 12,
      },
    }
  }

  if (
    includesAny(normalizedMessage, ['כמה אני חייב', 'כמה חייבים לי', 'מי חייב לי', 'למי אני חייב'])
  ) {
    return {
      name: 'get_balances',
      args: {},
    }
  }

  if (
    includesAny(normalizedMessage, [
      'מה המצב',
      'סיכום הדירה',
      'מה קורה בדירה',
      'מצב הדירה',
      'תן לי סיכום',
      'תסכם לי',
      'עדכן אותי',
    ])
  ) {
    return {
      name: 'get_apartment_summary',
      args: {},
    }
  }

  return null
}
