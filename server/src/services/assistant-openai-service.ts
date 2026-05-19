import { env } from '../config/env.js'
import { ApiError } from '../lib/api-error.js'
import type { AuthAccount } from '../types/auth.js'
import {
  createExpenseAction,
  createPaymentAction,
  createShoppingItemAction,
  createShoppingStatusAction,
  createTaskAction,
  createTaskStatusAction,
  createTicketAction,
  createTicketStatusAction,
  type AssistantActionProposal,
} from './assistant-action-service.js'
import { getApartmentStateSnapshot } from './apartment-service.js'
import { listApartmentInfoItemsByApartmentId } from './apartment-info-service.js'
import { listExpensesByApartmentId, listPaymentsByApartmentId } from './finance-service.js'
import {
  isOpenAiResponsesEnabled,
  runOpenAiToolLoop,
  type OpenAiFunctionToolDefinition,
} from './openai-responses-service.js'
import { listShoppingItemsByApartmentId } from './shopping-service.js'
import { listTasksByApartmentId } from './task-service.js'
import { listTicketsByApartmentId } from './ticket-service.js'

type ApartmentStateSnapshot = Awaited<ReturnType<typeof getApartmentStateSnapshot>>
type Expense = Awaited<ReturnType<typeof listExpensesByApartmentId>>[number]
type Payment = Awaited<ReturnType<typeof listPaymentsByApartmentId>>[number]
type Task = Awaited<ReturnType<typeof listTasksByApartmentId>>[number]
type ShoppingItem = Awaited<ReturnType<typeof listShoppingItemsByApartmentId>>[number]
type Ticket = Awaited<ReturnType<typeof listTicketsByApartmentId>>[number]
type ApartmentInfoItem = Awaited<ReturnType<typeof listApartmentInfoItemsByApartmentId>>[number]

export interface AssistantContextSnapshot {
  apartment: {
    id: number
    name: string
  }
  roommatesCount: number
  openTasksCount: number
  openShoppingItemsCount: number
  openTicketsCount: number
  recentExpensesCount: number
  recentPaymentsCount: number
  apartmentInfoCount: number
  shoppingItems: Array<{
    id: number
    itemName: string
    quantity: string | null
    status: string
  }>
  debts: Array<{
    fromName: string
    toName: string
    amount: number
  }>
  insights: string[]
  reminders: string[]
}

interface AssistantHistoryMessage {
  role: 'user' | 'assistant'
  text: string
}

interface AssistantData {
  apartmentState: ApartmentStateSnapshot
  tasks: Task[]
  shoppingItems: ShoppingItem[]
  tickets: Ticket[]
  expenses: Expense[]
  payments: Payment[]
  apartmentInfoItems: ApartmentInfoItem[]
}

const defaultSuggestions = [
  'תן לי תמונת מצב קצרה',
  'מה הכי דחוף בדירה כרגע?',
  'למה אני חייב כסף?',
  'מה צריך לקנות עכשיו?',
]

const hebrewMonthMap: Record<string, string> = {
  ינואר: '01',
  פברואר: '02',
  מרץ: '03',
  אפריל: '04',
  מאי: '05',
  יוני: '06',
  יולי: '07',
  אוגוסט: '08',
  ספטמבר: '09',
  אוקטובר: '10',
  נובמבר: '11',
  דצמבר: '12',
}

function money(amount: number) {
  return `${amount.toFixed(2)} ש"ח`
}

function isTaskOpen(task: Task) {
  return task.status !== 'done' && task.status !== 'cancelled'
}

function formatTaskStatus(status: Task['status']) {
  switch (status) {
    case 'open':
      return 'פתוחה'
    case 'in_progress':
      return 'בביצוע'
    case 'done':
      return 'בוצעה'
    default:
      return 'בוטלה'
  }
}

function formatShoppingStatus(status: ShoppingItem['status']) {
  switch (status) {
    case 'open':
      return 'פתוח'
    case 'purchased':
      return 'נקנה'
    default:
      return 'בוטל'
  }
}

function formatTicketStatus(status: Ticket['status']) {
  switch (status) {
    case 'open':
      return 'פתוח'
    case 'in_progress':
      return 'בטיפול'
    default:
      return 'סגור'
  }
}

function userNameById(apartmentState: ApartmentStateSnapshot) {
  return new Map(apartmentState.users.map((user) => [user.id, user.name]))
}

function buildDebtSummary(
  apartmentState: ApartmentStateSnapshot,
  expenses: Expense[],
  payments: Payment[],
) {
  const userNames = userNameById(apartmentState)
  const balances = new Map<number, number>()

  for (const user of apartmentState.users) {
    balances.set(user.id, 0)
  }

  for (const expense of expenses.filter((item) => item.status === 'active')) {
    const amount = Number(expense.amount)
    const participants = expense.participantAccountIds.length
      ? expense.participantAccountIds
      : apartmentState.users.map((user) => user.id)

    if (!Number.isFinite(amount) || !participants.length) continue
    const share = amount / participants.length

    balances.set(expense.paidByAccountId, (balances.get(expense.paidByAccountId) ?? 0) + amount)
    for (const participantId of participants) {
      balances.set(participantId, (balances.get(participantId) ?? 0) - share)
    }
  }

  for (const payment of payments.filter((item) => item.status === 'recorded')) {
    const amount = Number(payment.amount)
    if (!Number.isFinite(amount)) continue
    balances.set(payment.payerAccountId, (balances.get(payment.payerAccountId) ?? 0) + amount)
    balances.set(payment.payeeAccountId, (balances.get(payment.payeeAccountId) ?? 0) - amount)
  }

  const debtors = [...balances.entries()]
    .filter(([, balance]) => balance < -0.01)
    .map(([accountId, amount]) => ({ accountId, amount: Math.abs(amount) }))
    .sort((left, right) => right.amount - left.amount)

  const creditors = [...balances.entries()]
    .filter(([, balance]) => balance > 0.01)
    .map(([accountId, amount]) => ({ accountId, amount }))
    .sort((left, right) => right.amount - left.amount)

  const debts: AssistantContextSnapshot['debts'] = []

  for (const debtor of debtors) {
    let remaining = debtor.amount
    for (const creditor of creditors) {
      if (remaining <= 0.01 || creditor.amount <= 0.01) continue
      const transfer = Math.min(remaining, creditor.amount)
      debts.push({
        fromName: userNames.get(debtor.accountId) ?? `#${debtor.accountId}`,
        toName: userNames.get(creditor.accountId) ?? `#${creditor.accountId}`,
        amount: Number(transfer.toFixed(2)),
      })
      remaining -= transfer
      creditor.amount -= transfer
    }
  }

  return debts
}

function buildSnapshot(data: AssistantData): AssistantContextSnapshot {
  const overdueTasks = data.tasks.filter(
    (task) => isTaskOpen(task) && Boolean(task.dueDate) && task.dueDate! < new Date().toISOString().slice(0, 10),
  )
  const recentExpense = data.expenses.find((expense) => expense.status === 'active')

  return {
    apartment: data.apartmentState.apartment,
    roommatesCount: data.apartmentState.users.length,
    openTasksCount: data.tasks.filter(isTaskOpen).length,
    openShoppingItemsCount: data.shoppingItems.filter((item) => item.status === 'open').length,
    openTicketsCount: data.tickets.filter((ticket) => ticket.status !== 'closed').length,
    recentExpensesCount: data.expenses.filter((expense) => expense.status === 'active').length,
    recentPaymentsCount: data.payments.filter((payment) => payment.status === 'recorded').length,
    apartmentInfoCount: data.apartmentInfoItems.length,
    shoppingItems: data.shoppingItems.slice(0, 8).map((item) => ({
      id: item.id,
      itemName: item.itemName,
      quantity: item.quantity,
      status: item.status,
    })),
    debts: buildDebtSummary(data.apartmentState, data.expenses, data.payments),
    insights: [
      ...(overdueTasks.length ? [`יש כרגע ${overdueTasks.length} מטלות באיחור.`] : []),
      ...(recentExpense
        ? [`הוצאה אחרונה: ${recentExpense.description} בסך ${money(Number(recentExpense.amount))}.`]
        : []),
    ].slice(0, 4),
    reminders: data.tasks
      .filter((task) => isTaskOpen(task) && task.dueDate)
      .sort((left, right) => String(left.dueDate).localeCompare(String(right.dueDate)))
      .slice(0, 4)
      .map((task) => `${task.title} עד ${task.dueDate}`),
  }
}

async function loadAssistantData(apartmentId: number): Promise<AssistantData> {
  const [apartmentState, tasks, shoppingItems, tickets, expenses, payments, apartmentInfoItems] =
    await Promise.all([
      getApartmentStateSnapshot(apartmentId),
      listTasksByApartmentId(apartmentId),
      listShoppingItemsByApartmentId(apartmentId),
      listTicketsByApartmentId(apartmentId),
      listExpensesByApartmentId(apartmentId),
      listPaymentsByApartmentId(apartmentId),
      listApartmentInfoItemsByApartmentId(apartmentId),
    ])

  return { apartmentState, tasks, shoppingItems, tickets, expenses, payments, apartmentInfoItems }
}

function buildPrompt(data: AssistantData, account: AuthAccount) {
  const currentUser = data.apartmentState.users.find((user) => user.id === account.id)
  const snapshot = buildSnapshot(data)

  return [
    'אתה הסוכן של אפליקציית ERT עבור דירה משותפת.',
    'ענה תמיד בעברית קצרה וברורה.',
    'אתה נשען רק על המידע שנשלח אליך כאן.',
    'אם המשתמש מבקש לבצע שינוי נתונים, השתמש רק בפונקציות הזמינות.',
    'אם חסר מידע לביצוע פעולה, שאל שאלה אחת קצרה.',
    `תאריך נוכחי: ${new Date().toISOString()}.`,
    `נתוני דירה: ${JSON.stringify(
      {
        apartment: data.apartmentState.apartment,
        currentUser: currentUser
          ? { id: currentUser.id, name: currentUser.name, role: currentUser.role }
          : { id: account.id, name: account.fullName },
        roommates: data.apartmentState.users.map((user) => ({
          id: user.id,
          name: user.name,
          role: user.role,
        })),
        summary: snapshot,
        openTasks: data.tasks
          .filter(isTaskOpen)
          .slice(0, 10)
          .map((task) => ({
            id: task.id,
            title: task.title,
            assigneeAccountId: task.assigneeAccountId,
            dueDate: task.dueDate,
            status: task.status,
          })),
        openShoppingItems: data.shoppingItems
          .filter((item) => item.status === 'open')
          .slice(0, 10)
          .map((item) => ({
            id: item.id,
            itemName: item.itemName,
            quantity: item.quantity,
            category: item.category,
          })),
        openTickets: data.tickets
          .filter((ticket) => ticket.status !== 'closed')
          .slice(0, 8)
          .map((ticket) => ({
            id: ticket.id,
            title: ticket.title,
            category: ticket.category,
            status: ticket.status,
          })),
        recentExpenses: data.expenses.slice(0, 6).map((expense) => ({
          id: expense.id,
          amount: expense.amount,
          description: expense.description,
          category: expense.category,
          date: expense.date,
        })),
        recentPayments: data.payments.slice(0, 6).map((payment) => ({
          id: payment.id,
          amount: payment.amount,
          payerAccountId: payment.payerAccountId,
          payeeAccountId: payment.payeeAccountId,
          paymentDate: payment.paymentDate,
        })),
      },
      null,
      2,
    )}`,
  ].join('\n\n')
}

function buildTools(): OpenAiFunctionToolDefinition[] {
  return [
    {
      type: 'function',
      name: 'create_payment',
      description: 'Prepare a payment record between apartment members.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          payerAccountId: { type: 'number' },
          payeeAccountId: { type: 'number' },
          amount: { type: 'number' },
        },
        required: ['payeeAccountId', 'amount'],
      },
    },
    {
      type: 'function',
      name: 'create_shopping_item',
      description: 'Prepare a new shopping list item.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          itemName: { type: 'string' },
          quantity: { type: 'string' },
        },
        required: ['itemName'],
      },
    },
    {
      type: 'function',
      name: 'create_expense',
      description: 'Prepare a new expense entry for the apartment.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          amount: { type: 'number' },
          description: { type: 'string' },
          category: { type: 'string' },
          participantAccountIds: { type: 'array', items: { type: 'number' } },
        },
        required: ['amount', 'description', 'participantAccountIds'],
      },
    },
    {
      type: 'function',
      name: 'create_task',
      description: 'Prepare a new apartment task.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          title: { type: 'string' },
          description: { type: 'string' },
          assigneeAccountId: { type: 'number' },
          dueDate: { type: 'string' },
        },
        required: ['title'],
      },
    },
    {
      type: 'function',
      name: 'create_ticket',
      description: 'Prepare a new maintenance or request ticket.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          title: { type: 'string' },
          description: { type: 'string' },
          category: {
            type: 'string',
            enum: ['issue', 'request', 'finance', 'other'],
          },
        },
        required: ['title', 'description', 'category'],
      },
    },
    {
      type: 'function',
      name: 'update_task_status',
      description: 'Prepare a status change for an existing task.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          taskId: { type: 'number' },
          status: { type: 'string', enum: ['open', 'in_progress', 'done', 'cancelled'] },
        },
        required: ['taskId', 'status'],
      },
    },
    {
      type: 'function',
      name: 'update_shopping_status',
      description: 'Prepare a status change for an existing shopping item.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          itemId: { type: 'number' },
          status: { type: 'string', enum: ['open', 'purchased', 'cancelled'] },
        },
        required: ['itemId', 'status'],
      },
    },
    {
      type: 'function',
      name: 'update_ticket_status',
      description: 'Prepare a status change for an existing ticket.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ticketId: { type: 'number' },
          status: { type: 'string', enum: ['open', 'in_progress', 'closed'] },
        },
        required: ['ticketId', 'status'],
      },
    },
  ]
}

function requireApartmentUser(data: AssistantData, accountId: number, label: string) {
  const user = data.apartmentState.users.find((entry) => entry.id === accountId)
  if (!user) {
    throw new ApiError(400, `User ${label} was not found in this apartment.`)
  }
  return user
}

function buildParticipantLabel(data: AssistantData, ids: number[]) {
  if (
    ids.length === data.apartmentState.users.length &&
    ids.every((accountId) => data.apartmentState.users.some((user) => user.id === accountId))
  ) {
    return 'בין כל הדיירים'
  }
  return ids.map((id) => requireApartmentUser(data, id, String(id)).name).join(', ')
}

function normalizeHistory(history: AssistantHistoryMessage[]) {
  return history.slice(-8).map((message) => ({
    role: message.role,
    text: message.text,
  }))
}

function isWriteIntent(question: string) {
  const normalized = question.trim().toLowerCase()
  return [
    'תוסיף',
    'הוסף',
    'תפתח',
    'פתח',
    'תרשום',
    'רשום',
    'סמן',
    'תעדכן',
    'עדכן',
    'תשנה',
    'שנה',
    'תעביר',
    'העבר',
    'תסגור',
    'סגור',
  ].some((fragment) => normalized.includes(fragment))
}

function parseHebrewDate(question: string) {
  const normalized = question.trim().toLowerCase()
  const slashMatch = normalized.match(/(\d{1,2})[./-](\d{1,2})(?:[./-](\d{2,4}))?/)
  if (slashMatch) {
    const year = slashMatch[3] ? slashMatch[3].padStart(4, '20') : String(new Date().getFullYear())
    return `${year}-${slashMatch[2].padStart(2, '0')}-${slashMatch[1].padStart(2, '0')}`
  }

  const words = normalized.split(/\s+/)
  for (let index = 0; index < words.length - 1; index += 1) {
    const day = words[index].replace(/[^\d]/g, '')
    const nextWord = words[index + 1].replace(/[^\p{L}]/gu, '')
    if (!day || !hebrewMonthMap[nextWord]) continue
    return `${new Date().getFullYear()}-${hebrewMonthMap[nextWord]}-${day.padStart(2, '0')}`
  }

  return null
}

function proposalOutput(proposal: AssistantActionProposal) {
  return {
    token: proposal.token,
    type: proposal.type,
    summary: proposal.summary,
    confirmLabel: proposal.confirmLabel,
  }
}

function parseCreateTaskFastPath(data: AssistantData, account: AuthAccount, apartmentId: number, question: string) {
  const normalized = question.trim().toLowerCase()
  const taskIntent =
    (normalized.includes('מטלה') || normalized.includes('משימה')) &&
    ['תוסיף', 'הוסף', 'תפתח', 'פתח', 'תרשום', 'רשום'].some((fragment) => normalized.includes(fragment))

  if (!taskIntent) return null

  const dueDate = parseHebrewDate(question)
  const assignee =
    data.apartmentState.users.find((user) => normalized.includes(user.name.toLowerCase())) ??
    (normalized.includes('בשבילי') || normalized.includes('עבורי') || normalized.includes('לי')
      ? data.apartmentState.users.find((user) => user.id === account.id) ?? null
      : null)

  let title = question
    .replace(/תוסיף|הוסף|תפתח|פתח|תרשום|רשום/gu, '')
    .replace(/מטלה חדשה|מטלה|משימה/gu, '')
    .replace(/בשבילי|עבורי|לי/gu, '')
    .replace(/עם תאריך יעד.*$/gu, '')
    .trim()

  for (const user of data.apartmentState.users) {
    title = title.replace(new RegExp(user.name, 'gu'), '').trim()
  }

  title = title.replace(/\s{2,}/g, ' ').trim()

  if (!title) {
    return {
      answer: assignee ? `איזו מטלה לפתוח עבור ${assignee.name}?` : 'איזו מטלה לפתוח?',
      context: buildSnapshot(data),
      suggestions: defaultSuggestions,
      source: 'rules' as const,
    }
  }

  const proposal = createTaskAction({
    apartmentId,
    account,
    title,
    description: null,
    assigneeAccountId: assignee?.id ?? null,
    assigneeLabel: assignee?.name ?? 'ללא אחראי',
    dueDate,
  })

  return {
    answer: `זיהיתי בקשה לפתוח מטלה: ${proposal.summary} אם זה נכון, תאשר ואכין אותה.`,
    context: buildSnapshot(data),
    suggestions: defaultSuggestions,
    proposedAction: proposal,
    source: 'rules' as const,
  }
}

export async function getAssistantContextSnapshotOpenAi(apartmentId: number) {
  return buildSnapshot(await loadAssistantData(apartmentId))
}

export async function answerAssistantQuestionOpenAi(
  apartmentId: number,
  question: string,
  account: AuthAccount,
  previousQuestion?: string | null,
  history: AssistantHistoryMessage[] = [],
) {
  if (!isOpenAiResponsesEnabled()) {
    throw new ApiError(503, 'סוכן ה-AI לא פעיל כרגע בשרת.')
  }

  const trimmedQuestion = question.trim()
  if (!trimmedQuestion) {
    throw new ApiError(400, 'צריך לכתוב שאלה או בקשה לסוכן.')
  }

  const data = await loadAssistantData(apartmentId)
  const context = buildSnapshot(data)

  const fastTaskResult = parseCreateTaskFastPath(data, account, apartmentId, trimmedQuestion)
  if (fastTaskResult) {
    return fastTaskResult
  }

  try {
    const result = await runOpenAiToolLoop<AssistantActionProposal>({
      systemPrompt: buildPrompt(data, account),
      userPrompt: previousQuestion
        ? `שאלה קודמת: ${previousQuestion}\n\nשאלה נוכחית: ${trimmedQuestion}`
        : trimmedQuestion,
      history: normalizeHistory(history),
      tools: isWriteIntent(trimmedQuestion) ? buildTools() : [],
      onToolCall: async (name, args) => {
        if (name === 'create_payment') {
          const payeeAccountId = Number(args.payeeAccountId)
          const payerAccountId = args.payerAccountId == null ? account.id : Number(args.payerAccountId)
          const payee = requireApartmentUser(data, payeeAccountId, 'payee')
          const payer = requireApartmentUser(data, payerAccountId, 'payer')
          const proposal = createPaymentAction({
            apartmentId,
            account,
            payerAccountId,
            payerName: payer.name,
            payeeAccountId,
            payeeName: payee.name,
            amount: Number(args.amount).toFixed(2),
          })
          return { output: proposalOutput(proposal), sideEffect: proposal }
        }

        if (name === 'create_shopping_item') {
          const itemName = String(args.itemName ?? '').trim()
          if (!itemName) throw new ApiError(400, 'Shopping item name is required.')
          const proposal = createShoppingItemAction({
            apartmentId,
            account,
            itemName,
            quantity: args.quantity == null ? null : String(args.quantity),
          })
          return { output: proposalOutput(proposal), sideEffect: proposal }
        }

        if (name === 'create_expense') {
          const participantAccountIds = Array.isArray(args.participantAccountIds)
            ? args.participantAccountIds.map((value) => Number(value))
            : []
          if (!participantAccountIds.length) {
            throw new ApiError(400, 'At least one participant is required for an expense.')
          }
          participantAccountIds.forEach((id) => requireApartmentUser(data, id, String(id)))
          const proposal = createExpenseAction({
            apartmentId,
            account,
            amount: Number(args.amount).toFixed(2),
            description: String(args.description ?? '').trim(),
            category: args.category == null ? null : String(args.category),
            participantAccountIds,
            participantLabel: buildParticipantLabel(data, participantAccountIds),
          })
          return { output: proposalOutput(proposal), sideEffect: proposal }
        }

        if (name === 'create_task') {
          const assigneeAccountId = args.assigneeAccountId == null ? null : Number(args.assigneeAccountId)
          const assigneeLabel =
            assigneeAccountId == null ? 'ללא אחראי' : requireApartmentUser(data, assigneeAccountId, 'assignee').name
          const proposal = createTaskAction({
            apartmentId,
            account,
            title: String(args.title ?? '').trim(),
            description: args.description == null ? null : String(args.description),
            assigneeAccountId,
            assigneeLabel,
            dueDate: args.dueDate == null ? null : String(args.dueDate),
          })
          return { output: proposalOutput(proposal), sideEffect: proposal }
        }

        if (name === 'create_ticket') {
          const proposal = createTicketAction({
            apartmentId,
            account,
            title: String(args.title ?? '').trim(),
            description: String(args.description ?? '').trim(),
            category: (args.category as 'issue' | 'request' | 'finance' | 'other') ?? 'other',
          })
          return { output: proposalOutput(proposal), sideEffect: proposal }
        }

        if (name === 'update_task_status') {
          const task = data.tasks.find((item) => item.id === Number(args.taskId))
          if (!task) throw new ApiError(404, 'Task not found.')
          const nextStatus = args.status as Task['status']
          const proposal = createTaskStatusAction({
            apartmentId,
            account,
            taskId: task.id,
            title: task.title,
            description: task.description,
            assigneeAccountId: task.assigneeAccountId,
            dueDate: task.dueDate,
            status: nextStatus,
            statusLabel: formatTaskStatus(nextStatus),
          })
          return { output: proposalOutput(proposal), sideEffect: proposal }
        }

        if (name === 'update_shopping_status') {
          const item = data.shoppingItems.find((entry) => entry.id === Number(args.itemId))
          if (!item) throw new ApiError(404, 'Shopping item not found.')
          const nextStatus = args.status as ShoppingItem['status']
          const proposal = createShoppingStatusAction({
            apartmentId,
            account,
            itemId: item.id,
            itemName: item.itemName,
            quantity: item.quantity,
            category: item.category,
            status: nextStatus,
            statusLabel: formatShoppingStatus(nextStatus),
          })
          return { output: proposalOutput(proposal), sideEffect: proposal }
        }

        if (name === 'update_ticket_status') {
          const ticket = data.tickets.find((entry) => entry.id === Number(args.ticketId))
          if (!ticket) throw new ApiError(404, 'Ticket not found.')
          const nextStatus = args.status as Ticket['status']
          const proposal = createTicketStatusAction({
            apartmentId,
            account,
            ticketId: ticket.id,
            title: ticket.title,
            status: nextStatus,
            statusLabel: formatTicketStatus(nextStatus),
          })
          return { output: proposalOutput(proposal), sideEffect: proposal }
        }

        throw new ApiError(400, `Unsupported tool: ${name}`)
      },
    })

    if (!result.text && !result.sideEffect) {
      throw new ApiError(502, 'הסוכן לא הצליח לנסח תשובה תקינה.')
    }

    return {
      answer: result.text || 'הפעולה הוכנה לאישור.',
      context,
      suggestions: defaultSuggestions,
      proposedAction: result.sideEffect ?? undefined,
      source: 'openai' as const,
    }
  } catch (error) {
    if (error instanceof ApiError) {
      throw error
    }

    const message = error instanceof Error ? error.message : 'Unknown assistant error.'
    console.error('[assistant-openai] failed', {
      apartmentId,
      question: trimmedQuestion,
      message,
    })
    throw new ApiError(
      502,
      env.NODE_ENV === 'production'
        ? 'הסוכן לא הצליח להשלים את הבקשה כרגע. נסה שוב בעוד רגע.'
        : `Assistant error: ${message}`,
    )
  }
}

export async function getAssistantOpenAiHealth() {
  return {
    enabled: isOpenAiResponsesEnabled(),
  }
}
