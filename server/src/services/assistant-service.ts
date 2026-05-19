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
import {
  isOpenAiResponsesEnabled,
  runOpenAiToolLoop,
  type OpenAiFunctionToolDefinition,
} from './openai-responses-service.js'
import { getApartmentStateSnapshot } from './apartment-service.js'
import { listApartmentInfoItemsByApartmentId } from './apartment-info-service.js'
import { listExpensesByApartmentId, listPaymentsByApartmentId } from './finance-service.js'
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

interface DebtLine {
  counterpartyAccountId: number
  counterpartyName: string
  amount: number
}

interface PersonalExpenseReason {
  counterpartyAccountId: number
  counterpartyName: string
  description: string
  category: string | null
  date: string
  totalAmount: number
  yourShare: number
}

type AssistantIntent =
  | 'overview'
  | 'money'
  | 'shopping'
  | 'tasks'
  | 'tickets'
  | 'apartment_info'

const defaultSuggestions = [
  'תן לי תמונת מצב קצרה',
  'למה אני חייב כסף?',
  'מה צריך לקנות עכשיו?',
  'מה הוצאנו הכי הרבה כסף החודש?',
]

const genericQuestionWords = new Set([
  'אני',
  'אתה',
  'את',
  'של',
  'שלי',
  'שלנו',
  'מה',
  'מי',
  'למה',
  'כמה',
  'יש',
  'אין',
  'עם',
  'על',
  'אל',
  'לי',
  'לך',
  'זה',
  'הזה',
  'כרגע',
  'עכשיו',
  'בדירה',
  'בבית',
  'אותו',
  'אותה',
  'שולם',
  'שולמו',
])

const intentKeywords: Record<AssistantIntent, string[]> = {
  overview: ['סיכום', 'מצב', 'תמונת מצב', 'מה קורה', 'בקצרה', 'עדכן אותי'],
  money: [
    'כסף',
    'חייב',
    'חוב',
    'יתרה',
    'יתרות',
    'תשלום',
    'תשלומים',
    'הוצאה',
    'הוצאות',
    'שילמתי',
    'שלימתי',
    'שלמתי',
    'שילם לי',
    'שילמה לי',
    'העברתי',
    'חשמל',
  ],
  shopping: ['קניות', 'קנייה', 'לקנות', 'מכולת', 'סופר', 'מוצר', 'מוצרים', 'רשימה', 'חסר'],
  tasks: ['משימה', 'משימות', 'מטלה', 'מטלות', 'לעשות', 'דחוף', 'איחור', 'באחריות', 'שלי'],
  tickets: ['פנייה', 'פניות', 'תקלה', 'תקלות', 'תיקון', 'תחזוקה', 'בעיה', 'בעל הדירה'],
  apartment_info: ['מונה', 'חשבון', 'טלפון', 'ספק', 'חוזה', 'פרטים', 'מידע'],
}

const monthAliases: Record<string, string[]> = {
  '01': ['ינואר'],
  '02': ['פברואר', 'פבר׳', 'פברואר'],
  '03': ['מרץ'],
  '04': ['אפריל'],
  '05': ['מאי'],
  '06': ['יוני'],
  '07': ['יולי'],
  '08': ['אוגוסט'],
  '09': ['ספטמבר'],
  '10': ['אוקטובר'],
  '11': ['נובמבר'],
  '12': ['דצמבר'],
}

function money(amount: number) {
  return `${amount.toFixed(2)} ש"ח`
}

function formatDate(date: string | null | undefined) {
  if (!date) return 'ללא תאריך'
  return new Intl.DateTimeFormat('he-IL', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(date))
}

function normalizeText(value: string) {
  return value.trim().toLowerCase()
}

function includesAny(text: string, fragments: string[]) {
  return fragments.some((fragment) => text.includes(fragment))
}

function answerSystemQuestion(question: string) {
  const normalized = normalizeText(question)
  const now = new Date()

  if (includesAny(normalized, ['איזה יום היום', 'מה היום', 'היום איזה יום'])) {
    return new Intl.DateTimeFormat('he-IL', { weekday: 'long' }).format(now)
  }

  if (includesAny(normalized, ['מה התאריך היום', 'איזה תאריך היום', 'מה התאריך'])) {
    return new Intl.DateTimeFormat('he-IL', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).format(now)
  }

  if (includesAny(normalized, ['מה השעה', 'איזו שעה', 'כמה השעה'])) {
    return new Intl.DateTimeFormat('he-IL', {
      hour: '2-digit',
      minute: '2-digit',
    }).format(now)
  }

  return null
}

function termsFromQuestion(question: string) {
  return question
    .split(/\s+/)
    .map((term) => term.replace(/[^\p{L}\p{N}"'-]/gu, '').trim())
    .filter((term) => term.length > 1 && !genericQuestionWords.has(term))
}

function countKeywordMatches(question: string, keywords: string[]) {
  return keywords.reduce((score, keyword) => (question.includes(keyword) ? score + 1 : score), 0)
}

function rankIntents(question: string) {
  return (Object.keys(intentKeywords) as AssistantIntent[])
    .map((intent) => ({
      intent,
      score: countKeywordMatches(question, intentKeywords[intent]),
    }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score)
}

function userNameById(apartmentState: ApartmentStateSnapshot) {
  return new Map(apartmentState.users.map((user) => [user.id, user.name]))
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

function isTaskOpen(task: Task) {
  return task.status !== 'done' && task.status !== 'cancelled'
}

function hasTerm(haystack: string, terms: string[]) {
  const normalizedHaystack = haystack.toLowerCase()
  return terms.some((term) => normalizedHaystack.includes(term))
}

function monthKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

function daysBetween(from: string, to = new Date().toISOString().slice(0, 10)) {
  const fromTime = new Date(from).getTime()
  const toTime = new Date(to).getTime()
  if (!Number.isFinite(fromTime) || !Number.isFinite(toTime)) return 0
  return Math.floor((toTime - fromTime) / (1000 * 60 * 60 * 24))
}

function stripTrailingPunctuation(value: string) {
  return value.replace(/[?.!,:;]+$/g, '').trim()
}

function inferExpenseCategory(question: string) {
  const normalized = normalizeText(question)
  if (normalized.includes('חשמל')) return 'חשמל'
  if (normalized.includes('מים')) return 'מים'
  if (normalized.includes('אינטרנט')) return 'אינטרנט'
  if (normalized.includes('שכירות') || normalized.includes('שכר דירה')) return 'שכירות'
  if (normalized.includes('גז')) return 'גז'
  if (normalized.includes('סופר') || normalized.includes('קניות') || normalized.includes('מכולת')) return 'קניות'
  return null
}

function inferTicketCategory(question: string): 'issue' | 'request' | 'finance' | 'other' {
  const normalized = normalizeText(question)
  if (normalized.includes('כסף') || normalized.includes('תשלום') || normalized.includes('חיוב')) return 'finance'
  if (normalized.includes('בקשה') || normalized.includes('מבקש')) return 'request'
  if (
    normalized.includes('תקלה') ||
    normalized.includes('נזילה') ||
    normalized.includes('שבור') ||
    normalized.includes('לא עובד') ||
    normalized.includes('מקלחת') ||
    normalized.includes('מזגן') ||
    normalized.includes('חשמל')
  ) {
    return 'issue'
  }
  return 'other'
}

function inferDueDate(question: string) {
  const normalized = normalizeText(question)
  const now = new Date()

  if (normalized.includes('מחר')) {
    const date = new Date(now)
    date.setDate(date.getDate() + 1)
    return date.toISOString().slice(0, 10)
  }

  if (normalized.includes('היום')) {
    return now.toISOString().slice(0, 10)
  }

  const inDaysMatch = normalized.match(/(?:עוד|בעוד)\s+(\d+)\s+ימים?/)
  if (inDaysMatch) {
    const date = new Date(now)
    date.setDate(date.getDate() + Number(inDaysMatch[1]))
    return date.toISOString().slice(0, 10)
  }

  const isoMatch = normalized.match(/20\d{2}-\d{2}-\d{2}/)
  if (isoMatch) return isoMatch[0]

  const slashMatch = normalized.match(/(\d{1,2})[./-](\d{1,2})[./-](20\d{2})/)
  if (slashMatch) {
    return `${slashMatch[3]}-${slashMatch[2].padStart(2, '0')}-${slashMatch[1].padStart(2, '0')}`
  }

  return null
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

    if (!participants.length || !Number.isFinite(amount)) continue

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
    .map(([accountId, balance]) => ({ accountId, amount: Math.abs(balance) }))
    .sort((left, right) => right.amount - left.amount)

  const creditors = [...balances.entries()]
    .filter(([, balance]) => balance > 0.01)
    .map(([accountId, balance]) => ({ accountId, amount: balance }))
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

function buildPersonalDebtLines(data: AssistantData, accountId: number) {
  const userNames = userNameById(data.apartmentState)
  const balances = new Map<number, number>()
  const debtReasons: PersonalExpenseReason[] = []
  const creditReasons: PersonalExpenseReason[] = []

  for (const user of data.apartmentState.users) {
    if (user.id !== accountId) balances.set(user.id, 0)
  }

  for (const expense of data.expenses.filter((item) => item.status === 'active')) {
    const amount = Number(expense.amount)
    const participants = expense.participantAccountIds.length
      ? expense.participantAccountIds
      : data.apartmentState.users.map((user) => user.id)

    if (!Number.isFinite(amount) || !participants.length) continue
    const share = amount / participants.length

    if (participants.includes(accountId) && expense.paidByAccountId !== accountId) {
      balances.set(expense.paidByAccountId, (balances.get(expense.paidByAccountId) ?? 0) - share)
      debtReasons.push({
        counterpartyAccountId: expense.paidByAccountId,
        counterpartyName: userNames.get(expense.paidByAccountId) ?? `#${expense.paidByAccountId}`,
        description: expense.description,
        category: expense.category,
        date: expense.date,
        totalAmount: amount,
        yourShare: share,
      })
    }

    if (expense.paidByAccountId === accountId) {
      for (const participantId of participants.filter((id) => id !== accountId)) {
        balances.set(participantId, (balances.get(participantId) ?? 0) + share)
        creditReasons.push({
          counterpartyAccountId: participantId,
          counterpartyName: userNames.get(participantId) ?? `#${participantId}`,
          description: expense.description,
          category: expense.category,
          date: expense.date,
          totalAmount: amount,
          yourShare: share,
        })
      }
    }
  }

  for (const payment of data.payments.filter((item) => item.status === 'recorded')) {
    const amount = Number(payment.amount)
    if (!Number.isFinite(amount)) continue

    if (payment.payerAccountId === accountId) {
      balances.set(payment.payeeAccountId, (balances.get(payment.payeeAccountId) ?? 0) + amount)
    }

    if (payment.payeeAccountId === accountId) {
      balances.set(payment.payerAccountId, (balances.get(payment.payerAccountId) ?? 0) - amount)
    }
  }

  const debts: DebtLine[] = [...balances.entries()]
    .filter(([, balance]) => balance < -0.01)
    .map(([counterpartyAccountId, balance]) => ({
      counterpartyAccountId,
      counterpartyName: userNames.get(counterpartyAccountId) ?? `#${counterpartyAccountId}`,
      amount: Number(Math.abs(balance).toFixed(2)),
    }))
    .sort((left, right) => right.amount - left.amount)

  const credits: DebtLine[] = [...balances.entries()]
    .filter(([, balance]) => balance > 0.01)
    .map(([counterpartyAccountId, balance]) => ({
      counterpartyAccountId,
      counterpartyName: userNames.get(counterpartyAccountId) ?? `#${counterpartyAccountId}`,
      amount: Number(balance.toFixed(2)),
    }))
    .sort((left, right) => right.amount - left.amount)

  return { debts, credits, debtReasons, creditReasons }
}

function buildInsights(data: AssistantData) {
  const insights: string[] = []
  const now = new Date()
  const currentMonth = monthKey(now)
  const previousMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const previousMonth = monthKey(previousMonthDate)
  const currentMonthExpenses = data.expenses.filter(
    (expense) => expense.status === 'active' && expense.date.startsWith(currentMonth),
  )
  const previousMonthExpenses = data.expenses.filter(
    (expense) => expense.status === 'active' && expense.date.startsWith(previousMonth),
  )
  const categoryTotals = new Map<string, number>()

  for (const expense of currentMonthExpenses) {
    const key = (expense.category ?? expense.description).trim()
    categoryTotals.set(key, (categoryTotals.get(key) ?? 0) + Number(expense.amount))
  }

  const [topCategory, topCategoryAmount] =
    [...categoryTotals.entries()].sort((a, b) => b[1] - a[1])[0] ?? []

  if (topCategory && topCategoryAmount) {
    insights.push(`ההוצאה הבולטת החודש היא ${topCategory}: ${money(topCategoryAmount)}.`)
  }

  const electricityTotal = currentMonthExpenses
    .filter((expense) =>
      normalizeText(`${expense.description} ${expense.category ?? ''}`).includes('חשמל'),
    )
    .reduce((sum, expense) => sum + Number(expense.amount), 0)

  if (electricityTotal >= 400) {
    insights.push(`חשבון החשמל החודשי גבוה יחסית: ${money(electricityTotal)}.`)
  }

  const currentMonthTotal = currentMonthExpenses.reduce((sum, expense) => sum + Number(expense.amount), 0)
  const previousMonthTotal = previousMonthExpenses.reduce((sum, expense) => sum + Number(expense.amount), 0)
  if (
    currentMonthTotal >= 300 &&
    previousMonthTotal > 0 &&
    currentMonthTotal >= previousMonthTotal * 1.4
  ) {
    insights.push(
      `סך ההוצאות החודש גבוה משמעותית מהחודש הקודם: ${money(currentMonthTotal)} מול ${money(previousMonthTotal)}.`,
    )
  }

  const shoppingTotal = currentMonthExpenses
    .filter((expense) => normalizeText(`${expense.description} ${expense.category ?? ''}`).includes('קני'))
    .reduce((sum, expense) => sum + Number(expense.amount), 0)
  if (shoppingTotal >= 500) {
    insights.push(`נרשמו הוצאות קניות גבוהות החודש: ${money(shoppingTotal)}.`)
  }

  const openShoppingItems = data.shoppingItems.filter((item) => item.status === 'open')
  if (openShoppingItems.length >= 6) {
    insights.push(`רשימת הקניות מתחילה להצטבר: יש כרגע ${openShoppingItems.length} פריטים פתוחים.`)
  }

  const openTickets = data.tickets.filter((ticket) => ticket.status !== 'closed')
  const oldestOpenTicket = openTickets
    .map((ticket) => ({ ticket, age: daysBetween(ticket.createdAt.slice(0, 10)) }))
    .sort((left, right) => right.age - left.age)[0]
  if (oldestOpenTicket && oldestOpenTicket.age >= 7) {
    insights.push(
      `יש פנייה פתוחה ותיקה: "${oldestOpenTicket.ticket.title}" פתוחה כבר ${oldestOpenTicket.age} ימים.`,
    )
  }

  const overdueTasks = data.tasks.filter(
    (task) => isTaskOpen(task) && task.dueDate && task.dueDate < new Date().toISOString().slice(0, 10),
  )
  if (overdueTasks.length >= 2) {
    insights.push(`יש כבר ${overdueTasks.length} משימות באיחור, כנראה צריך לסגור אותן לפני שייווצר עומס.`)
  }

  const monthlyPayments = data.payments.filter(
    (payment) => payment.status === 'recorded' && payment.paymentDate.startsWith(currentMonth),
  )
  const monthlyDebts = buildDebtSummary(data.apartmentState, data.expenses, data.payments)
  if (monthlyDebts.length > 0 && monthlyPayments.length === 0) {
    insights.push('יש יתרות פתוחות בין דיירים, אבל עדיין לא נרשם שום תשלום החודש.')
  }

  const payerTotals = new Map<number, number>()
  for (const expense of currentMonthExpenses) {
    payerTotals.set(
      expense.paidByAccountId,
      (payerTotals.get(expense.paidByAccountId) ?? 0) + Number(expense.amount),
    )
  }
  const topPayer = [...payerTotals.entries()].sort((left, right) => right[1] - left[1])[0]
  if (topPayer && currentMonthTotal > 0 && topPayer[1] / currentMonthTotal >= 0.6) {
    const user = data.apartmentState.users.find((entry) => entry.id === topPayer[0])
    insights.push(
      `${user?.name ?? 'אחד הדיירים'} שילם עד עכשיו את רוב הוצאות החודש: ${money(topPayer[1])}.`,
    )
  }

  if (!insights.length) {
    insights.push('כרגע אין חריגה בולטת במיוחד בנתונים של הדירה.')
  }

  return insights.slice(0, 5)
}

function buildReminders(data: AssistantData) {
  const reminders: string[] = []
  const currentMonth = new Date().toISOString().slice(0, 7)
  const hasElectricityExpenseThisMonth = data.expenses.some((expense) => {
    const haystack = normalizeText(`${expense.description} ${expense.category ?? ''}`)
    return expense.status === 'active' && expense.date.startsWith(currentMonth) && haystack.includes('חשמל')
  })

  if (!hasElectricityExpenseThisMonth) {
    reminders.push('לא זוהתה הוצאת חשמל החודש. שווה לוודא אם החשבון כבר שולם או עדיין פתוח.')
  }

  const overdueTasks = data.tasks.filter(
    (task) => isTaskOpen(task) && task.dueDate && task.dueDate < new Date().toISOString().slice(0, 10),
  )

  if (overdueTasks.length > 0) {
    reminders.push(`יש ${overdueTasks.length} משימות באיחור שעדיין פתוחות.`)
  }

  const upcomingTasks = data.tasks.filter((task) => {
    if (!isTaskOpen(task) || !task.dueDate) return false
    const daysUntilDue = daysBetween(new Date().toISOString().slice(0, 10), task.dueDate)
    return daysUntilDue >= 0 && daysUntilDue <= 3
  })

  if (upcomingTasks.length > 0) {
    reminders.push(`יש ${upcomingTasks.length} משימות שיגיעו ליעד בימים הקרובים.`)
  }

  const openTickets = data.tickets.filter((ticket) => ticket.status !== 'closed')
  const staleTickets = openTickets.filter((ticket) => daysBetween(ticket.createdAt.slice(0, 10)) >= 10)
  if (staleTickets.length > 0) {
    reminders.push(`יש ${staleTickets.length} פניות פתוחות שכבר מחכות מעל 10 ימים.`)
  }

  const openShoppingItems = data.shoppingItems.filter((item) => item.status === 'open')
  if (openShoppingItems.length >= 8) {
    reminders.push('רשימת הקניות כבר ארוכה יחסית. שווה לסגור קנייה מרוכזת.')
  }

  const openDebts = buildDebtSummary(data.apartmentState, data.expenses, data.payments)
  if (openDebts.length >= 3) {
    reminders.push('יש כמה יתרות פתוחות בין דיירים. שווה לרשום תשלומים כדי לא לצבור פערים.')
  }

  return reminders.slice(0, 5)
}

async function loadAssistantData(apartmentId: number): Promise<AssistantData> {
  const [
    apartmentState,
    tasks,
    shoppingItems,
    tickets,
    expenses,
    payments,
    apartmentInfoItems,
  ] = await Promise.all([
    getApartmentStateSnapshot(apartmentId),
    listTasksByApartmentId(apartmentId),
    listShoppingItemsByApartmentId(apartmentId),
    listTicketsByApartmentId(apartmentId),
    listExpensesByApartmentId(apartmentId),
    listPaymentsByApartmentId(apartmentId),
    listApartmentInfoItemsByApartmentId(apartmentId),
  ])

  return {
    apartmentState,
    tasks,
    shoppingItems,
    tickets,
    expenses,
    payments,
    apartmentInfoItems,
  }
}

function buildSnapshot(data: AssistantData): AssistantContextSnapshot {
  return {
    apartment: {
      id: data.apartmentState.apartment.id,
      name: data.apartmentState.apartment.name,
    },
    roommatesCount: data.apartmentState.users.length,
    openTasksCount: data.tasks.filter(isTaskOpen).length,
    openShoppingItemsCount: data.shoppingItems.filter((item) => item.status === 'open').length,
    openTicketsCount: data.tickets.filter((ticket) => ticket.status !== 'closed').length,
    recentExpensesCount: data.expenses.filter((expense) => expense.status === 'active').length,
    recentPaymentsCount: data.payments.filter((payment) => payment.status === 'recorded').length,
    apartmentInfoCount: data.apartmentInfoItems.length,
    shoppingItems: data.shoppingItems
      .filter((item) => item.status === 'open')
      .slice(0, 8)
      .map((item) => ({
        id: item.id,
        itemName: item.itemName,
        quantity: item.quantity,
        status: item.status,
      })),
    debts: buildDebtSummary(data.apartmentState, data.expenses, data.payments).slice(0, 8),
    insights: buildInsights(data),
    reminders: buildReminders(data),
  }
}

function findMatchedRoommate(
  question: string,
  apartmentState: ApartmentStateSnapshot,
  excludeAccountId: number,
  preferredQuestion?: string,
) {
  const normalizedQuestion = normalizeText(question)
  const normalizedPreferredQuestion = preferredQuestion ? normalizeText(preferredQuestion) : ''
  const candidates = apartmentState.users
    .filter((user) => user.id !== excludeAccountId)
    .map((user) => ({
      accountId: user.id,
      name: user.name,
      tokens: normalizeText(user.name).split(/\s+/).filter(Boolean),
    }))

  let bestMatch: { accountId: number; name: string; score: number } | null = null

  for (const candidate of candidates) {
    const baseScore = candidate.tokens.reduce(
      (sum, token) => (normalizedQuestion.includes(token) ? sum + token.length : sum),
      0,
    )
    const preferredScore = normalizedPreferredQuestion
      ? candidate.tokens.reduce(
          (sum, token) =>
            normalizedPreferredQuestion.includes(token) ? sum + token.length * 4 : sum,
          0,
        )
      : 0
    const score = baseScore + preferredScore
    if (score <= 0) continue
    if (!bestMatch || score > bestMatch.score) {
      bestMatch = { accountId: candidate.accountId, name: candidate.name, score }
    }
  }

  return bestMatch
}

function findMentionedRoommates(
  question: string,
  apartmentState: ApartmentStateSnapshot,
  excludeAccountId?: number,
) {
  const normalizedQuestion = normalizeText(question)
  return apartmentState.users.filter((user) => {
    if (excludeAccountId != null && user.id === excludeAccountId) return false
    const tokens = normalizeText(user.name).split(/\s+/).filter(Boolean)
    return tokens.some((token) => normalizedQuestion.includes(token))
  })
}

function findMentionedUser(question: string, apartmentState: ApartmentStateSnapshot) {
  const normalizedQuestion = normalizeText(question)
  let bestMatch: { id: number; name: string; score: number } | null = null

  for (const user of apartmentState.users) {
    const tokens = normalizeText(user.name).split(/\s+/).filter(Boolean)
    const score = tokens.reduce(
      (sum, token) => (normalizedQuestion.includes(token) ? sum + token.length : sum),
      0,
    )

    if (score <= 0) continue
    if (!bestMatch || score > bestMatch.score) {
      bestMatch = { id: user.id, name: user.name, score }
    }
  }

  return bestMatch
}

function scoreEntityMatch(question: string, label: string) {
  const normalizedQuestion = normalizeText(question)
  const tokens = normalizeText(label).split(/\s+/).filter(Boolean)
  return tokens.reduce((sum, token) => (normalizedQuestion.includes(token) ? sum + token.length : sum), 0)
}

function parsePaymentAction(
  question: string,
  currentQuestion: string,
  account: AuthAccount,
  data: AssistantData,
): AssistantActionProposal | null {
  const normalized = normalizeText(question)
  const normalizedCurrentQuestion = normalizeText(currentQuestion)
  const paymentPhrases = [
    'שילמתי',
    'שלימתי',
    'שלמתי',
    'העברתי',
    'שילם לי',
    'שילמה לי',
    'לרשום תשלום',
    'תרשום תשלום',
    'תרשום ש',
  ]

  if (!includesAny(normalized, paymentPhrases)) return null

  const amountMatch = normalized.match(/(\d+(?:[.,]\d{1,2})?)/)
  if (!amountMatch) return null
  const amount = amountMatch[1].replace(',', '.')

  const roommate = findMatchedRoommate(
    normalized,
    data.apartmentState,
    account.id,
    normalizedCurrentQuestion,
  )
  if (!roommate) return null

  const currentUserName =
    data.apartmentState.users.find((user) => user.id === account.id)?.name ?? 'אתה'
  const roommatePaidMe =
    normalized.includes('שילם לי') ||
    normalized.includes('שילמה לי') ||
    normalizedCurrentQuestion.includes('שילם לי') ||
    normalizedCurrentQuestion.includes('שילמה לי') ||
    normalized.includes(`${normalizeText(roommate.name)} שילם לי`) ||
    normalized.includes(`${normalizeText(roommate.name)} שילמה לי`)

  if (roommatePaidMe) {
    return createPaymentAction({
      apartmentId: data.apartmentState.apartment.id,
      account,
      payerAccountId: roommate.accountId,
      payerName: roommate.name,
      payeeAccountId: account.id,
      payeeName: currentUserName,
      amount,
    })
  }

  return createPaymentAction({
    apartmentId: data.apartmentState.apartment.id,
    account,
    payerName: currentUserName,
    payeeAccountId: roommate.accountId,
    payeeName: roommate.name,
    amount,
  })
}

function parseShoppingAction(question: string, account: AuthAccount, data: AssistantData): AssistantActionProposal | null {
  const normalized = normalizeText(question)
  const impliesCreate =
    normalized.includes('תוסיף') ||
    normalized.includes('תוסיף לי') ||
    normalized.includes('הוסף') ||
    normalized.includes('תכניס') ||
    normalized.includes('לרשימת קניות') ||
    normalized.includes('לקניות')

  if (!impliesCreate) return null

  let itemName = question
    .replace(/לרשימת קניות/gi, '')
    .replace(/צריך לקנות/gi, '')
    .replace(/תוסיף לי/gi, '')
    .replace(/תוסיף/gi, '')
    .replace(/הוסף/gi, '')
    .replace(/תכניס/gi, '')
    .replace(/לקניות/gi, '')
    .replace(/^\s*את\s+/i, '')
    .trim()

  if (!itemName) return null

  let quantity: string | null = null
  const quantityMatch = itemName.match(/(.+?)\s+(\d+[^\s]*)$/)
  if (quantityMatch) {
    itemName = quantityMatch[1].trim()
    quantity = quantityMatch[2].trim()
  }

  if (!itemName || itemName.length < 2) return null

  return createShoppingItemAction({
    apartmentId: data.apartmentState.apartment.id,
    account,
    itemName,
    quantity,
  })
}

function parseExpenseAction(question: string, account: AuthAccount, data: AssistantData): AssistantActionProposal | null {
  const normalized = normalizeText(question)
  const impliesCreate =
    normalized.includes('תרשום הוצאה') ||
    normalized.includes('לרשום הוצאה') ||
    normalized.includes('תוסיף הוצאה') ||
    normalized.includes('פתח הוצאה') ||
    normalized.includes('הוצאה של')

  if (!impliesCreate) return null

  const amountMatch = normalized.match(/(\d+(?:[.,]\d{1,2})?)/)
  if (!amountMatch) return null

  const amount = amountMatch[1].replace(',', '.')
  const mentionedRoommates = findMentionedRoommates(question, data.apartmentState, account.id)
  let description = question
    .replace(/תרשום הוצאה/gi, '')
    .replace(/לרשום הוצאה/gi, '')
    .replace(/תוסיף הוצאה/gi, '')
    .replace(/פתח הוצאה/gi, '')
    .replace(/הוצאה של/gi, '')
    .replace(amountMatch[0], '')
    .replace(/שקל|ש"ח|₪/gi, '')
    .replace(/על\s+/gi, '')
    .replace(/לכל הבית/gi, '')
    .replace(/לכולם/gi, '')
    .replace(/לכולנו/gi, '')
    .replace(/ותחלק(?:י)?(?:\s+אותה)?\s+על/gi, '')
    .replace(/תחלק(?:י)?(?:\s+אותה)?\s+על/gi, '')
    .replace(/ביני\s+לבין/gi, '')
    .replace(/בין/gi, '')
    .trim()

  for (const roommate of mentionedRoommates) {
    const escapedName = roommate.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    description = description
      .replace(new RegExp(`\\s+ו?על\\s+${escapedName}`, 'gi'), '')
      .replace(new RegExp(`\\s+ו?${escapedName}`, 'gi'), '')
      .replace(new RegExp(`\\s+לבין\\s+${escapedName}`, 'gi'), '')
      .replace(new RegExp(`\\s+${escapedName}`, 'gi'), '')
      .trim()
  }

  description = stripTrailingPunctuation(description)
  if (!description || description.length < 2) return null

  const explicitSplit =
    normalized.includes('תחלק') ||
    normalized.includes('ותחלק') ||
    normalized.includes('עליי ועל') ||
    normalized.includes('עלי ועל') ||
    normalized.includes('ביני לבין') ||
    normalized.includes('בין ')

  const allParticipants =
    normalized.includes('לכל הבית') ||
    normalized.includes('לכולם') ||
    normalized.includes('לכולנו') ||
    data.apartmentState.users.length <= 2
  const participantIds = allParticipants
    ? data.apartmentState.users.map((user) => user.id)
    : explicitSplit && mentionedRoommates.length
      ? [account.id, ...mentionedRoommates.map((user) => user.id)]
      : [account.id]
  const uniqueParticipantIds = [...new Set(participantIds)]
  const participantLabel = allParticipants
    ? 'בין כל הדיירים'
    : uniqueParticipantIds.length > 1
      ? `בין ${[
          data.apartmentState.users.find((user) => user.id === account.id)?.name ?? 'אתה',
          ...mentionedRoommates.map((user) => user.name),
        ].join(' ו')}`
      : 'רק עבורך'

  return createExpenseAction({
    apartmentId: data.apartmentState.apartment.id,
    account,
    amount,
    description,
    category: inferExpenseCategory(question),
    participantAccountIds: uniqueParticipantIds,
    participantLabel,
  })
}

function parseTaskAction(question: string, account: AuthAccount, data: AssistantData): AssistantActionProposal | null {
  const normalized = normalizeText(question)
  const impliesCreate =
    normalized.includes('תפתח משימה') ||
    normalized.includes('פתח משימה') ||
    normalized.includes('תיצור משימה') ||
    normalized.includes('צור משימה') ||
    normalized.includes('תוסיף משימה')

  if (!impliesCreate) return null

  const roommate = findMatchedRoommate(normalized, data.apartmentState, account.id)
  let title = question
    .replace(/תפתח משימה/gi, '')
    .replace(/פתח משימה/gi, '')
    .replace(/תיצור משימה/gi, '')
    .replace(/צור משימה/gi, '')
    .replace(/תוסיף משימה/gi, '')
    .replace(/למחר/gi, '')
    .replace(/להיום/gi, '')
    .replace(/לעוד\s+\d+\s+ימים?/gi, '')
    .trim()

  if (roommate) {
    const escapedName = roommate.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    title = title
      .replace(new RegExp(`\\s+ל${escapedName}`, 'gi'), '')
      .replace(new RegExp(`\\s+עבור\\s+${escapedName}`, 'gi'), '')
      .replace(new RegExp(`\\s+${escapedName}`, 'gi'), '')
      .trim()
  }

  title = stripTrailingPunctuation(title)
  if (!title || title.length < 2) return null

  const assigneeAccountId = roommate ? roommate.accountId : account.id
  const assigneeLabel =
    assigneeAccountId === account.id
      ? 'אתה'
      : (data.apartmentState.users.find((user) => user.id === assigneeAccountId)?.name ?? 'דייר אחר')

  return createTaskAction({
    apartmentId: data.apartmentState.apartment.id,
    account,
    title,
    description: null,
    assigneeAccountId,
    assigneeLabel,
    dueDate: inferDueDate(question),
  })
}

function parseTicketAction(question: string, account: AuthAccount, data: AssistantData): AssistantActionProposal | null {
  const normalized = normalizeText(question)
  const impliesCreate =
    normalized.includes('תפתח פנייה') ||
    normalized.includes('פתח פנייה') ||
    normalized.includes('תיצור פנייה') ||
    normalized.includes('צור פנייה') ||
    normalized.includes('תדווח') ||
    normalized.includes('לדווח')

  if (!impliesCreate) return null

  let description = question
    .replace(/תפתח פנייה/gi, '')
    .replace(/פתח פנייה/gi, '')
    .replace(/תיצור פנייה/gi, '')
    .replace(/צור פנייה/gi, '')
    .replace(/תדווח/gi, '')
    .replace(/לדווח/gi, '')
    .trim()

  description = stripTrailingPunctuation(description)
  if (!description || description.length < 4) return null

  const title = description.split(/[,.]/)[0].trim().slice(0, 80)
  if (!title) return null

  return createTicketAction({
    apartmentId: data.apartmentState.apartment.id,
    account,
    title,
    description,
    category: inferTicketCategory(question),
  })
}

function parseStatusAction(question: string, account: AuthAccount, data: AssistantData): AssistantActionProposal | null {
  const normalized = normalizeText(question)
  const targetTaskStatus = normalized.includes('בוצע') || normalized.includes('הושלם') || normalized.includes('סיים')
    ? { value: 'done' as const, label: 'בוצעה' }
    : normalized.includes('בטיפול') || normalized.includes('התחל')
      ? { value: 'in_progress' as const, label: 'בביצוע' }
      : normalized.includes('פתח') || normalized.includes('להחזיר לפתוח')
        ? { value: 'open' as const, label: 'פתוחה' }
        : null

  const targetShoppingStatus = normalized.includes('נקנה') || normalized.includes('נקנתה') || normalized.includes('קניתי')
    ? { value: 'purchased' as const, label: 'נקנה' }
    : normalized.includes('בטל') || normalized.includes('לבטל')
      ? { value: 'cancelled' as const, label: 'בוטל' }
      : normalized.includes('פתוח') || normalized.includes('להחזיר')
        ? { value: 'open' as const, label: 'פתוח' }
        : null

  const targetTicketStatus = normalized.includes('בטיפול')
    ? { value: 'in_progress' as const, label: 'בטיפול' }
    : normalized.includes('סגור') || normalized.includes('נסגר')
      ? { value: 'closed' as const, label: 'סגורה' }
      : normalized.includes('פתח')
        ? { value: 'open' as const, label: 'פתוחה' }
        : null

  const taskIntent = normalized.includes('משימה') || normalized.includes('מטלה')
  const shoppingIntent = normalized.includes('קנייה') || normalized.includes('קניות') || normalized.includes('מוצר') || normalized.includes('פריט')
  const ticketIntent = normalized.includes('פנייה') || normalized.includes('תקלה')

  if (taskIntent && targetTaskStatus) {
    const task = [...data.tasks]
      .map((task) => ({ task, score: scoreEntityMatch(question, task.title) }))
      .filter((entry) => entry.score > 0)
      .sort((left, right) => right.score - left.score)[0]?.task

    if (!task) return null

    return createTaskStatusAction({
      apartmentId: data.apartmentState.apartment.id,
      account,
      taskId: task.id,
      title: task.title,
      description: task.description,
      assigneeAccountId: task.assigneeAccountId,
      dueDate: task.dueDate,
      status: targetTaskStatus.value,
      statusLabel: targetTaskStatus.label,
    })
  }

  if (shoppingIntent && targetShoppingStatus) {
    const item = [...data.shoppingItems]
      .map((item) => ({ item, score: scoreEntityMatch(question, item.itemName) }))
      .filter((entry) => entry.score > 0)
      .sort((left, right) => right.score - left.score)[0]?.item

    if (!item) return null

    return createShoppingStatusAction({
      apartmentId: data.apartmentState.apartment.id,
      account,
      itemId: item.id,
      itemName: item.itemName,
      quantity: item.quantity,
      category: item.category,
      status: targetShoppingStatus.value,
      statusLabel: targetShoppingStatus.label,
    })
  }

  if (ticketIntent && targetTicketStatus) {
    const ticket = [...data.tickets]
      .map((ticket) => ({ ticket, score: scoreEntityMatch(question, ticket.title) }))
      .filter((entry) => entry.score > 0)
      .sort((left, right) => right.score - left.score)[0]?.ticket

    if (!ticket) return null

    return createTicketStatusAction({
      apartmentId: data.apartmentState.apartment.id,
      account,
      ticketId: ticket.id,
      title: ticket.title,
      status: targetTicketStatus.value,
      statusLabel: targetTicketStatus.label,
    })
  }

  return null
}

function detectAssistantAction(
  question: string,
  currentQuestion: string,
  account: AuthAccount,
  data: AssistantData,
) {
  return (
    parsePaymentAction(question, currentQuestion, account, data) ??
    parseExpenseAction(currentQuestion, account, data) ??
    parseTaskAction(currentQuestion, account, data) ??
    parseTicketAction(currentQuestion, account, data) ??
    parseStatusAction(currentQuestion, account, data) ??
    parseShoppingAction(currentQuestion, account, data)
  )
}

function buildEffectiveQuestion(
  question: string,
  previousQuestion?: string | null,
  history: AssistantHistoryMessage[] = [],
) {
  const normalizedQuestion = normalizeText(question)
  const correctionPrefixes = ['לא ', 'לא,', 'תיקון', 'התכוונתי', 'בעצם', 'כלומר']
  const isShortFollowup = normalizedQuestion.split(/\s+/).filter(Boolean).length <= 3
  const isCorrection = correctionPrefixes.some((prefix) => normalizedQuestion.startsWith(prefix))
  const previousUserQuestion =
    previousQuestion?.trim() ||
    [...history]
      .reverse()
      .find((message) => message.role === 'user')?.text

  if (!previousUserQuestion) return question
  if (!isCorrection && !isShortFollowup) return question

  return `${previousUserQuestion}\nהבהרה: ${question}`
}

function answerOverview(data: AssistantData, account: AuthAccount) {
  const { debts, credits } = buildPersonalDebtLines(data, account.id)
  const openTasks = data.tasks.filter(isTaskOpen)
  const openShopping = data.shoppingItems.filter((item) => item.status === 'open')
  const openTickets = data.tickets.filter((ticket) => ticket.status !== 'closed')
  const insights = buildInsights(data)
  const reminders = buildReminders(data)

  return [
    `תמונת מצב קצרה לדירה "${data.apartmentState.apartment.name}":`,
    `• משימות פתוחות: ${openTasks.length}`,
    `• קניות פתוחות: ${openShopping.length}`,
    `• פניות פתוחות: ${openTickets.length}`,
    `• הוצאות פעילות: ${data.expenses.filter((expense) => expense.status === 'active').length}`,
    debts.length
      ? `• אתה חייב כרגע ${money(debts.reduce((sum, item) => sum + item.amount, 0))}`
      : credits.length
        ? `• חייבים לך כרגע ${money(credits.reduce((sum, item) => sum + item.amount, 0))}`
        : '• אין כרגע יתרה כספית פתוחה עבורך',
    insights[0] ? `• תובנה: ${insights[0]}` : '',
    reminders[0] ? `• תזכורת: ${reminders[0]}` : '',
  ].join('\n')
}

function monthKeyFromQuestion(question: string) {
  const normalized = normalizeText(question)
  const currentDate = new Date()

  if (normalized.includes('החודש')) {
    return currentDate.toISOString().slice(0, 7)
  }

  const numericMatch = normalized.match(/(0?[1-9]|1[0-2])[./-](20\d{2})/)
  if (numericMatch) {
    return `${numericMatch[2]}-${numericMatch[1].padStart(2, '0')}`
  }

  for (const [month, aliases] of Object.entries(monthAliases)) {
    if (aliases.some((alias) => normalized.includes(alias))) {
      const yearMatch = normalized.match(/20\d{2}/)
      const year = yearMatch?.[0] ?? String(currentDate.getFullYear())
      return `${year}-${month}`
    }
  }

  return null
}

function answerElectricityQuestion(data: AssistantData, question: string) {
  const monthKey = monthKeyFromQuestion(question) ?? new Date().toISOString().slice(0, 7)
  const electricityExpenses = data.expenses.filter((expense) => {
    const haystack = normalizeText(`${expense.description} ${expense.category ?? ''}`)
    return expense.status === 'active' && expense.date.startsWith(monthKey) && haystack.includes('חשמל')
  })

  if (!electricityExpenses.length) {
    return `לא מצאתי הוצאת חשמל רשומה עבור ${monthKey}.`
  }

  const userNames = userNameById(data.apartmentState)
  const total = electricityExpenses.reduce((sum, expense) => sum + Number(expense.amount), 0)

  return [
    `כן, מצאתי ${electricityExpenses.length} רישומי חשמל עבור ${monthKey}, בסך כולל של ${money(total)}:`,
    ...electricityExpenses.map(
      (expense) =>
        `• ${expense.description} - ${money(Number(expense.amount))}, שולם על ידי ${userNames.get(expense.paidByAccountId) ?? 'לא ידוע'}, בתאריך ${formatDate(expense.date)}`,
    ),
  ].join('\n')
}

function answerTopSpendingQuestion(data: AssistantData, question: string) {
  const monthKey = monthKeyFromQuestion(question) ?? new Date().toISOString().slice(0, 7)
  const monthlyExpenses = data.expenses.filter(
    (expense) => expense.status === 'active' && expense.date.startsWith(monthKey),
  )

  if (!monthlyExpenses.length) {
    return `לא מצאתי הוצאות רשומות עבור ${monthKey}.`
  }

  const categoryTotals = new Map<string, number>()
  for (const expense of monthlyExpenses) {
    const key = (expense.category ?? expense.description).trim()
    categoryTotals.set(key, (categoryTotals.get(key) ?? 0) + Number(expense.amount))
  }

  const sortedCategories = [...categoryTotals.entries()].sort((a, b) => b[1] - a[1])
  const topExpenses = [...monthlyExpenses]
    .sort((a, b) => Number(b.amount) - Number(a.amount))
    .slice(0, 5)

  return [
    `אלו ההוצאות הבולטות עבור ${monthKey}:`,
    `• הקטגוריה הגבוהה ביותר: ${sortedCategories[0][0]} - ${money(sortedCategories[0][1])}`,
    '',
    'הוצאות בודדות בולטות:',
    ...topExpenses.map((expense) => `• ${expense.description} - ${money(Number(expense.amount))}`),
  ].join('\n')
}

function answerMoneyQuestion(data: AssistantData, account: AuthAccount, question: string) {
  const normalized = normalizeText(question)
  const mentionedUser = findMentionedUser(question, data.apartmentState)
  const subjectAccountId =
    mentionedUser && mentionedUser.id !== account.id ? mentionedUser.id : account.id
  const subjectName =
    subjectAccountId === account.id
      ? 'אתה'
      : (data.apartmentState.users.find((user) => user.id === subjectAccountId)?.name ?? 'הדייר הזה')
  const subjectShareLabel = subjectAccountId === account.id ? 'שלך' : `של ${subjectName}`
  const { debts, credits, debtReasons, creditReasons } = buildPersonalDebtLines(data, subjectAccountId)

  if (normalized.includes('חשמל') && (normalized.includes('שולם') || normalized.includes('שילמו') || normalized.includes('שילמנו'))) {
    return answerElectricityQuestion(data, normalized)
  }

  if (
    includesAny(normalized, [
      'הוצאנו הכי הרבה',
      'הוצאה הכי גבוהה',
      'על מה הוצאנו הכי הרבה',
      'מה הוצאנו הכי הרבה כסף',
      'מה ההוצאה הכי גבוהה',
    ])
  ) {
    return answerTopSpendingQuestion(data, normalized)
  }

  const asksGeneral = includesAny(normalized, ['כולם', 'איזון', 'יתרות', 'מצב יתרות'])
  if (asksGeneral) {
    const allDebts = buildDebtSummary(data.apartmentState, data.expenses, data.payments)
    if (!allDebts.length) {
      return 'כרגע אין יתרות לתיאום בדירה. לפי ההוצאות והתשלומים שנרשמו, כולם מאוזנים.'
    }

    return [
      'זה מצב היתרות בדירה לפי ההוצאות והתשלומים הרשומים:',
      ...allDebts.map((debt) => `• ${debt.fromName} צריך להעביר ל-${debt.toName}: ${money(debt.amount)}`),
      '',
      'החישוב מבוסס על הוצאות פעילות בלבד ועל תשלומים שמסומנים כרשומים.',
    ].join('\n')
  }

  const asksWhoOwesMe = includesAny(normalized, [
    'מי חייב לי',
    'חייבים לי',
    'למה חייבים לי',
    'על מה חייבים לי',
  ])

  if (asksWhoOwesMe) {
    if (!credits.length) {
      return subjectAccountId === account.id
        ? 'כרגע לא מופיע שמישהו חייב לך כסף לפי הנתונים בדירה.'
        : `כרגע לא מופיע שמישהו חייב ל-${subjectName} כסף לפי הנתונים בדירה.`
    }

    const relevantCreditReasons = creditReasons
      .filter((reason) => credits.some((credit) => credit.counterpartyAccountId === reason.counterpartyAccountId))
      .slice(0, 12)

    return [
      subjectAccountId === account.id
        ? `לפי הנתונים, חייבים לך בסך הכול ${money(credits.reduce((sum, item) => sum + item.amount, 0))}:`
        : `לפי הנתונים, חייבים ל-${subjectName} בסך הכול ${money(credits.reduce((sum, item) => sum + item.amount, 0))}:`,
      ...credits.map((credit) => `• ${credit.counterpartyName}: ${money(credit.amount)}`),
      '',
      relevantCreditReasons.length
        ? subjectAccountId === account.id
          ? 'הסיבות המרכזיות לכך שחייבים לך כסף:'
          : `הסיבות המרכזיות לכך שחייבים ל-${subjectName} כסף:`
        : 'לא מצאתי פירוט הוצאות מספק שמסביר את היתרה מעבר לקיזוז התשלומים.',
      ...relevantCreditReasons.map((reason) => {
        const category = reason.category ? `, קטגוריה: ${reason.category}` : ''
        return `• ${reason.description} (${formatDate(reason.date)}${category}) - ${subjectAccountId === account.id ? 'אתה' : subjectName} שילם ${money(reason.totalAmount)}, והחלק של ${reason.counterpartyName} הוא ${money(reason.yourShare)}`
      }),
      '',
      'היתרה הסופית כבר כוללת קיזוז של תשלומים שנרשמו במערכת.',
    ].join('\n')
  }

  if (!debts.length) {
    return credits.length
      ? subjectAccountId === account.id
        ? `אתה לא חייב כרגע כסף לאחרים. להפך, חייבים לך ${money(credits.reduce((sum, item) => sum + item.amount, 0))}.`
        : `${subjectName} לא חייב כרגע כסף לאחרים. להפך, חייבים לו ${money(credits.reduce((sum, item) => sum + item.amount, 0))}.`
      : subjectAccountId === account.id
        ? 'כרגע לא מופיע שאתה חייב כסף למישהו בדירה.'
        : `כרגע לא מופיע ש-${subjectName} חייב כסף למישהו בדירה.`
  }

  const relevantDebtReasons = debtReasons
    .filter((reason) => debts.some((debt) => debt.counterpartyAccountId === reason.counterpartyAccountId))
    .slice(0, 12)

  return [
    subjectAccountId === account.id
      ? `לפי הנתונים, אתה חייב כרגע ${money(debts.reduce((sum, item) => sum + item.amount, 0))}:`
      : `לפי הנתונים, ${subjectName} חייב כרגע ${money(debts.reduce((sum, item) => sum + item.amount, 0))}:`,
    ...debts.map((debt) => `• ל-${debt.counterpartyName}: ${money(debt.amount)}`),
    '',
    relevantDebtReasons.length
      ? subjectAccountId === account.id
        ? 'ההוצאות המרכזיות שיצרו את החוב:'
        : `ההוצאות המרכזיות שיצרו את החוב של ${subjectName}:`
      : 'לא מצאתי פירוט הוצאות שמסביר את החוב מעבר לקיזוז התשלומים.',
    ...relevantDebtReasons.map((reason) => {
      const category = reason.category ? `, קטגוריה: ${reason.category}` : ''
      return `• ${reason.description} (${formatDate(reason.date)}${category}) - ${reason.counterpartyName} שילם ${money(reason.totalAmount)}, והחלק ${subjectShareLabel} הוא ${money(reason.yourShare)}`
    }),
    '',
    'הסכום הסופי כולל גם קיזוז של תשלומים שכבר נרשמו במערכת.',
  ].join('\n')
}

function answerShoppingQuestion(data: AssistantData) {
  const openItems = data.shoppingItems.filter((item) => item.status === 'open')
  if (!openItems.length) return 'כרגע אין פריטי קניות פתוחים בדירה.'

  return [
    `יש כרגע ${openItems.length} פריטי קניות פתוחים:`,
    ...openItems
      .slice(0, 15)
      .map((item) => `• ${item.itemName}${item.quantity ? ` - כמות: ${item.quantity}` : ''}${item.category ? `, קטגוריה: ${item.category}` : ''}`),
    openItems.length > 15 ? `ועוד ${openItems.length - 15} פריטים נוספים.` : '',
  ]
    .filter(Boolean)
    .join('\n')
}

function answerTaskQuestion(data: AssistantData, account: AuthAccount, question: string) {
  const userNames = userNameById(data.apartmentState)
  const openTasks = data.tasks.filter(isTaskOpen)
  const onlyMine = question.includes('שלי') || question.includes('עליי')
  const asksUrgent = question.includes('דחוף') || question.includes('באיחור')
  let relevantTasks = onlyMine
    ? openTasks.filter((task) => task.assigneeAccountId === account.id)
    : openTasks

  if (asksUrgent) {
    const today = new Date().toISOString().slice(0, 10)
    relevantTasks = relevantTasks.filter((task) => task.dueDate && task.dueDate < today)
  }

  if (!relevantTasks.length) {
    if (asksUrgent) return 'אין כרגע משימות באיחור או דחופות לפי תאריך היעד.'
    return onlyMine ? 'אין לך כרגע משימות פתוחות.' : 'אין כרגע משימות פתוחות בדירה.'
  }

  return [
    onlyMine
      ? `יש לך ${relevantTasks.length} משימות פתוחות:`
      : `יש בדירה ${relevantTasks.length} משימות פתוחות:`,
    ...relevantTasks.slice(0, 12).map((task) => {
      const assignee = task.assigneeAccountId ? (userNames.get(task.assigneeAccountId) ?? 'לא ידוע') : 'לא משויך'
      return `• ${task.title} - סטטוס: ${formatTaskStatus(task.status)}, אחראי: ${assignee}, יעד: ${formatDate(task.dueDate)}`
    }),
    relevantTasks.length > 12 ? `ועוד ${relevantTasks.length - 12} משימות נוספות.` : '',
  ]
    .filter(Boolean)
    .join('\n')
}

function answerTicketQuestion(data: AssistantData, question: string) {
  const openTickets = data.tickets.filter((ticket) => ticket.status !== 'closed')
  const asksClosed = question.includes('סגורות') || question.includes('נסגר')
  const relevantTickets = asksClosed
    ? data.tickets.filter((ticket) => ticket.status === 'closed')
    : openTickets

  if (!relevantTickets.length) {
    return asksClosed ? 'אין כרגע פניות סגורות להצגה.' : 'כרגע אין פניות פתוחות בדירה.'
  }

  return [
    asksClosed
      ? `יש כרגע ${relevantTickets.length} פניות סגורות:`
      : `יש כרגע ${relevantTickets.length} פניות פתוחות:`,
    ...relevantTickets.slice(0, 10).map((ticket) => {
      return `• ${ticket.title} - סטטוס: ${formatTicketStatus(ticket.status)}, נפתחה ב-${formatDate(ticket.createdAt)}`
    }),
    relevantTickets.length > 10 ? `ועוד ${relevantTickets.length - 10} פניות נוספות.` : '',
  ]
    .filter(Boolean)
    .join('\n')
}

function answerApartmentInfoQuestion(data: AssistantData, question: string) {
  const normalized = normalizeText(question)
  const terms = termsFromQuestion(normalized)

  const matches = data.apartmentInfoItems.filter((item) => {
    const haystack = [
      item.title,
      item.categoryLabel,
      item.provider,
      item.meterNumber,
      item.accountNumber,
      item.phone,
      item.notes,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()

    return terms.some((term) => haystack.includes(term))
  })

  const items = matches.length ? matches : data.apartmentInfoItems
  if (!items.length) return 'לא מצאתי כרגע מידע שמור על הדירה.'

  return [
    matches.length ? 'מצאתי את פריטי המידע הכי רלוונטיים:' : 'אלה פריטי המידע ששמורים בדירה:',
    ...items.slice(0, 8).map((item) => {
      const details = [
        item.provider ? `ספק: ${item.provider}` : '',
        item.accountNumber ? `מספר חשבון: ${item.accountNumber}` : '',
        item.meterNumber ? `מספר מונה: ${item.meterNumber}` : '',
        item.phone ? `טלפון: ${item.phone}` : '',
      ].filter(Boolean)

      return `• ${item.title}${details.length ? ` - ${details.join(', ')}` : ''}${item.notes ? `. הערות: ${item.notes}` : ''}`
    }),
  ].join('\n')
}

function answerFreeSearchQuestion(data: AssistantData, question: string) {
  const terms = termsFromQuestion(question)
  if (!terms.length) return null

  const userNames = userNameById(data.apartmentState)
  const matches: string[] = []

  for (const expense of data.expenses.filter((item) => item.status === 'active')) {
    const haystack = [expense.description, expense.category, expense.date].filter(Boolean).join(' ')
    if (!hasTerm(haystack, terms)) continue
    matches.push(
      `• הוצאה: ${expense.description} - ${money(Number(expense.amount))}, שילם ${userNames.get(expense.paidByAccountId) ?? 'לא ידוע'}, תאריך ${formatDate(expense.date)}`,
    )
  }

  for (const payment of data.payments.filter((item) => item.status === 'recorded')) {
    const haystack = [String(payment.amount), payment.note, payment.paymentDate].filter(Boolean).join(' ')
    if (!hasTerm(haystack, terms)) continue
    matches.push(
      `• תשלום: ${money(Number(payment.amount))} מ-${userNames.get(payment.payerAccountId) ?? 'לא ידוע'} ל-${userNames.get(payment.payeeAccountId) ?? 'לא ידוע'}`
    )
  }

  for (const task of data.tasks.filter(isTaskOpen)) {
    const haystack = [task.title, task.description, task.status, task.dueDate].filter(Boolean).join(' ')
    if (!hasTerm(haystack, terms)) continue
    const assignee = task.assigneeAccountId ? (userNames.get(task.assigneeAccountId) ?? 'לא ידוע') : 'לא משויך'
    matches.push(`• משימה: ${task.title} - אחראי: ${assignee}, סטטוס: ${formatTaskStatus(task.status)}, יעד: ${formatDate(task.dueDate)}`)
  }

  for (const item of data.shoppingItems.filter((entry) => entry.status === 'open')) {
    const haystack = [item.itemName, item.quantity, item.category, item.status].filter(Boolean).join(' ')
    if (!hasTerm(haystack, terms)) continue
    matches.push(`• קניות: ${item.itemName}${item.quantity ? ` - כמות: ${item.quantity}` : ''}${item.category ? `, קטגוריה: ${item.category}` : ''}`)
  }

  for (const ticket of data.tickets.filter((item) => item.status !== 'closed')) {
    const haystack = [ticket.title, ticket.description, ticket.category, ticket.status].filter(Boolean).join(' ')
    if (!hasTerm(haystack, terms)) continue
    matches.push(`• פנייה: ${ticket.title} - סטטוס: ${formatTicketStatus(ticket.status)}`)
  }

  for (const item of data.apartmentInfoItems) {
    const haystack = [
      item.title,
      item.categoryLabel,
      item.provider,
      item.meterNumber,
      item.accountNumber,
      item.phone,
      item.notes,
    ]
      .filter(Boolean)
      .join(' ')
    if (!hasTerm(haystack, terms)) continue
    matches.push(`• מידע דירה: ${item.title}${item.provider ? ` - ספק: ${item.provider}` : ''}${item.accountNumber ? `, חשבון: ${item.accountNumber}` : ''}${item.phone ? `, טלפון: ${item.phone}` : ''}`)
  }

  if (!matches.length) return null

  return [
    'בדקתי את הנתונים של הדירה ומצאתי כמה דברים שיכולים להיות רלוונטיים:',
    ...matches.slice(0, 12),
    matches.length > 12 ? `ועוד ${matches.length - 12} תוצאות נוספות.` : '',
  ]
    .filter(Boolean)
    .join('\n')
}

function answerIntent(data: AssistantData, account: AuthAccount, intent: AssistantIntent, question: string) {
  if (intent === 'overview') return answerOverview(data, account)
  if (intent === 'money') return answerMoneyQuestion(data, account, question)
  if (intent === 'shopping') return answerShoppingQuestion(data)
  if (intent === 'tasks') return answerTaskQuestion(data, account, question)
  if (intent === 'tickets') return answerTicketQuestion(data, question)
  return answerApartmentInfoQuestion(data, question)
}

function answerSmartQuestion(data: AssistantData, account: AuthAccount, question: string) {
  const rankedIntents = rankIntents(question)

  if (!rankedIntents.length) {
    return answerFreeSearchQuestion(data, question) ?? answerOverview(data, account)
  }

  if (rankedIntents.length === 1) {
    return answerIntent(data, account, rankedIntents[0].intent, question)
  }

  return answerIntent(data, account, rankedIntents[0].intent, question)
}

function buildSuggestions(question: string) {
  const normalized = normalizeText(question)

  if (includesAny(normalized, ['כסף', 'חייב', 'חוב', 'תשלום', 'הוצאה'])) {
    return [
      'למה אני חייב כסף?',
      'למה חייבים לי כסף?',
      'מי חייב לי הכי הרבה?',
      'מה הוצאנו הכי הרבה כסף החודש?',
    ]
  }

  if (includesAny(normalized, ['משימ', 'מטל'])) {
    return ['אילו משימות שלי פתוחות?', 'יש משימות באיחור?', 'מה הכי דחוף כרגע?']
  }

  if (includesAny(normalized, ['קני', 'לקנות', 'חסר'])) {
    return ['מה צריך לקנות עכשיו?', 'מה חסר בבית כרגע?', 'תוסיף חלב לרשימת קניות']
  }

  if (includesAny(normalized, ['פני', 'תקל', 'תחזוק'])) {
    return ['אילו פניות פתוחות כרגע?', 'יש פניות סגורות לאחרונה?', 'מה הפנייה הכי ישנה שעדיין פתוחה?']
  }

  return defaultSuggestions
}

function buildOpenAiAssistantSystemPrompt(data: AssistantData, account: AuthAccount) {
  const apartmentUsers = data.apartmentState.users.map((user) => ({
    id: user.id,
    name: user.name,
    role: user.role,
    status: user.status,
  }))

  const tasks = data.tasks.slice(0, 30).map((task) => ({
    id: task.id,
    title: task.title,
    assigneeAccountId: task.assigneeAccountId,
    dueDate: task.dueDate,
    status: task.status,
  }))

  const shoppingItems = data.shoppingItems.slice(0, 30).map((item) => ({
    id: item.id,
    itemName: item.itemName,
    quantity: item.quantity,
    category: item.category,
    status: item.status,
  }))

  const tickets = data.tickets.slice(0, 20).map((ticket) => ({
    id: ticket.id,
    title: ticket.title,
    category: ticket.category,
    status: ticket.status,
  }))

  const apartmentInfoItems = data.apartmentInfoItems.slice(0, 20).map((item) => ({
    id: item.id,
    title: item.title,
    categoryLabel: item.categoryLabel,
    provider: item.provider,
    accountNumber: item.accountNumber,
    phone: item.phone,
    notes: item.notes,
  }))

  return [
    'You are the apartment assistant inside the ERT app.',
    'Always reply in concise Hebrew.',
    'You never access the database directly. You only use the provided context and tools.',
    'If the user asks to change data, call a tool instead of claiming the change is already done.',
    'Tool calls only prepare a confirmation proposal. After a tool call, explain briefly what was prepared and tell the user to confirm.',
    'If the request is unclear, ask one short clarifying question in Hebrew.',
    `Current apartment context: ${JSON.stringify(
      {
        apartment: data.apartmentState.apartment,
        currentUser: {
          id: account.id,
          name: data.apartmentState.users.find((user) => user.id === account.id)?.name ?? account.fullName,
          email: account.email,
        },
        users: apartmentUsers,
        tasks,
        shoppingItems,
        tickets,
        apartmentInfoItems,
      },
      null,
      2,
    )}`,
  ].join('\n\n')
}

function buildOpenAiAssistantTools(): OpenAiFunctionToolDefinition[] {
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
          participantAccountIds: {
            type: 'array',
            items: { type: 'number' },
          },
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
          dueDate: { type: 'string', description: 'ISO date in YYYY-MM-DD format' },
        },
        required: ['title'],
      },
    },
    {
      type: 'function',
      name: 'create_ticket',
      description: 'Prepare a new maintenance/request ticket.',
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
          status: {
            type: 'string',
            enum: ['open', 'in_progress', 'done', 'cancelled'],
          },
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
          status: {
            type: 'string',
            enum: ['open', 'purchased', 'cancelled'],
          },
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
          status: {
            type: 'string',
            enum: ['open', 'in_progress', 'closed'],
          },
        },
        required: ['ticketId', 'status'],
      },
    },
  ]
}

function requireApartmentUser(
  data: AssistantData,
  accountId: number,
  fallbackLabel: string,
) {
  const user = data.apartmentState.users.find((entry) => entry.id === accountId)
  if (!user) {
    throw new ApiError(400, `User ${fallbackLabel} was not found in this apartment.`)
  }

  return user
}

function buildParticipantLabel(data: AssistantData, participantAccountIds: number[]) {
  if (
    participantAccountIds.length === data.apartmentState.users.length &&
    participantAccountIds.every((accountId) => data.apartmentState.users.some((user) => user.id === accountId))
  ) {
    return 'בין כל הדיירים'
  }

  return participantAccountIds
    .map((accountId) => requireApartmentUser(data, accountId, String(accountId)).name)
    .join(', ')
}

async function answerAssistantQuestionWithOpenAi(
  apartmentId: number,
  question: string,
  account: AuthAccount,
  history: AssistantHistoryMessage[],
  data: AssistantData,
  fallbackAnswer: string,
) {
  if (!isOpenAiResponsesEnabled()) {
    return null
  }

  try {
    const result = await runOpenAiToolLoop<AssistantActionProposal>({
      systemPrompt: buildOpenAiAssistantSystemPrompt(data, account),
      userPrompt: question,
      history,
      tools: buildOpenAiAssistantTools(),
      onToolCall: async (name, args) => {
        if (name === 'create_payment') {
          const payeeAccountId = Number(args.payeeAccountId)
          const payerAccountId =
            args.payerAccountId == null ? account.id : Number(args.payerAccountId)
          const amount = Number(args.amount)

          const payee = requireApartmentUser(data, payeeAccountId, 'payee')
          const payer = requireApartmentUser(data, payerAccountId, 'payer')
          const proposal = createPaymentAction({
            apartmentId,
            account,
            payerAccountId,
            payerName: payer.name,
            payeeAccountId,
            payeeName: payee.name,
            amount: amount.toFixed(2),
          })

          return {
            output: {
              summary: proposal.summary,
              token: proposal.token,
              confirmLabel: proposal.confirmLabel,
            },
            sideEffect: proposal,
          }
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

          return {
            output: {
              summary: proposal.summary,
              token: proposal.token,
              confirmLabel: proposal.confirmLabel,
            },
            sideEffect: proposal,
          }
        }

        if (name === 'create_expense') {
          const participantAccountIds = Array.isArray(args.participantAccountIds)
            ? args.participantAccountIds.map((value) => Number(value))
            : []

          if (!participantAccountIds.length) {
            throw new ApiError(400, 'At least one participant is required for an expense.')
          }

          participantAccountIds.forEach((accountId) => requireApartmentUser(data, accountId, String(accountId)))

          const proposal = createExpenseAction({
            apartmentId,
            account,
            amount: Number(args.amount).toFixed(2),
            description: String(args.description ?? '').trim(),
            category: args.category == null ? null : String(args.category),
            participantAccountIds,
            participantLabel: buildParticipantLabel(data, participantAccountIds),
          })

          return {
            output: {
              summary: proposal.summary,
              token: proposal.token,
              confirmLabel: proposal.confirmLabel,
            },
            sideEffect: proposal,
          }
        }

        if (name === 'create_task') {
          const assigneeAccountId =
            args.assigneeAccountId == null ? null : Number(args.assigneeAccountId)
          const assigneeLabel =
            assigneeAccountId == null
              ? 'ללא אחראי'
              : requireApartmentUser(data, assigneeAccountId, 'assignee').name

          const proposal = createTaskAction({
            apartmentId,
            account,
            title: String(args.title ?? '').trim(),
            description: args.description == null ? null : String(args.description),
            assigneeAccountId,
            assigneeLabel,
            dueDate: args.dueDate == null ? null : String(args.dueDate),
          })

          return {
            output: {
              summary: proposal.summary,
              token: proposal.token,
              confirmLabel: proposal.confirmLabel,
            },
            sideEffect: proposal,
          }
        }

        if (name === 'create_ticket') {
          const proposal = createTicketAction({
            apartmentId,
            account,
            title: String(args.title ?? '').trim(),
            description: String(args.description ?? '').trim(),
            category: (args.category as 'issue' | 'request' | 'finance' | 'other') ?? 'other',
          })

          return {
            output: {
              summary: proposal.summary,
              token: proposal.token,
              confirmLabel: proposal.confirmLabel,
            },
            sideEffect: proposal,
          }
        }

        if (name === 'update_task_status') {
          const task = data.tasks.find((item) => item.id === Number(args.taskId))
          if (!task) throw new ApiError(404, 'Task not found for status update.')

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

          return {
            output: {
              summary: proposal.summary,
              token: proposal.token,
              confirmLabel: proposal.confirmLabel,
            },
            sideEffect: proposal,
          }
        }

        if (name === 'update_shopping_status') {
          const item = data.shoppingItems.find((entry) => entry.id === Number(args.itemId))
          if (!item) throw new ApiError(404, 'Shopping item not found for status update.')

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

          return {
            output: {
              summary: proposal.summary,
              token: proposal.token,
              confirmLabel: proposal.confirmLabel,
            },
            sideEffect: proposal,
          }
        }

        if (name === 'update_ticket_status') {
          const ticket = data.tickets.find((entry) => entry.id === Number(args.ticketId))
          if (!ticket) throw new ApiError(404, 'Ticket not found for status update.')

          const nextStatus = args.status as Ticket['status']
          const proposal = createTicketStatusAction({
            apartmentId,
            account,
            ticketId: ticket.id,
            title: ticket.title,
            status: nextStatus,
            statusLabel: formatTicketStatus(nextStatus),
          })

          return {
            output: {
              summary: proposal.summary,
              token: proposal.token,
              confirmLabel: proposal.confirmLabel,
            },
            sideEffect: proposal,
          }
        }

        throw new ApiError(400, `Unknown assistant tool: ${name}`)
      },
    })

    if (!result.text && !result.sideEffect) {
      return null
    }

    return {
      answer: result.text || fallbackAnswer,
      proposedAction: result.sideEffect ?? undefined,
    }
  } catch (error) {
    console.error('OpenAI assistant fallback failed.', error)
    return null
  }
}

export async function getAssistantContextSnapshot(apartmentId: number): Promise<AssistantContextSnapshot> {
  return buildSnapshot(await loadAssistantData(apartmentId))
}

export async function answerAssistantQuestion(
  apartmentId: number,
  question: string,
  account: AuthAccount,
  previousQuestion?: string | null,
  history: AssistantHistoryMessage[] = [],
) {
  const data = await loadAssistantData(apartmentId)
  const snapshot = buildSnapshot(data)
  const normalizedQuestion = normalizeText(question)
  const effectiveQuestion = buildEffectiveQuestion(question, previousQuestion, history)
  const normalizedEffectiveQuestion = normalizeText(effectiveQuestion)

  if (!normalizedQuestion) {
    return {
      answer: 'תכתוב שאלה, ואני אענה לפי הנתונים של הדירה שלך.',
      context: snapshot,
      suggestions: defaultSuggestions,
      source: 'rules' as const,
    }
  }

  const systemAnswer = answerSystemQuestion(normalizedEffectiveQuestion)
  if (systemAnswer) {
    console.log('[assistant] source=rules kind=system')
    return {
      answer: systemAnswer,
      context: snapshot,
      suggestions: buildSuggestions(normalizedEffectiveQuestion),
      source: 'rules' as const,
    }
  }

  const proposedAction = detectAssistantAction(
    normalizedEffectiveQuestion,
    normalizedQuestion,
    account,
    data,
  )
  const fallbackAnswer = answerSmartQuestion(data, account, normalizedEffectiveQuestion)

  if (proposedAction) {
    console.log('[assistant] source=rules kind=action')
    return {
      answer: `זיהיתי בקשה לביצוע פעולה:\n• ${proposedAction.summary}\n\nאם זה נכון, תאשר ואבצע את זה עבורך.`,
      context: snapshot,
      suggestions: buildSuggestions(normalizedEffectiveQuestion),
      proposedAction,
      source: 'rules' as const,
    }
  }

  const openAiResult = await answerAssistantQuestionWithOpenAi(
    apartmentId,
    effectiveQuestion,
    account,
    history,
    data,
    fallbackAnswer,
  )

  console.log(`[assistant] source=${openAiResult ? 'openai' : 'rules'} question="${question}"`)

  return {
    answer: openAiResult?.answer ?? fallbackAnswer,
    context: snapshot,
    suggestions: buildSuggestions(normalizedEffectiveQuestion),
    proposedAction: openAiResult?.proposedAction,
    source: openAiResult ? ('openai' as const) : ('rules' as const),
  }
}
