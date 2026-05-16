import type { AuthAccount } from '../types/auth.js'
import {
  createPaymentAction,
  createShoppingItemAction,
  type AssistantActionProposal,
} from './assistant-action-service.js'
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

function isTaskOpen(task: Task) {
  return task.status !== 'done' && task.status !== 'cancelled'
}

function hasTerm(haystack: string, terms: string[]) {
  const normalizedHaystack = haystack.toLowerCase()
  return terms.some((term) => normalizedHaystack.includes(term))
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
  const currentMonth = new Date().toISOString().slice(0, 7)
  const currentMonthExpenses = data.expenses.filter(
    (expense) => expense.status === 'active' && expense.date.startsWith(currentMonth),
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

  if (!insights.length) {
    insights.push('כרגע אין חריגה בולטת במיוחד בנתונים של הדירה.')
  }

  return insights
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

  return reminders
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

function detectAssistantAction(
  question: string,
  currentQuestion: string,
  account: AuthAccount,
  data: AssistantData,
) {
  return (
    parsePaymentAction(question, currentQuestion, account, data) ??
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
  const { debts, credits, debtReasons, creditReasons } = buildPersonalDebtLines(data, account.id)

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
      return 'כרגע לא מופיע שמישהו חייב לך כסף לפי הנתונים בדירה.'
    }

    const relevantCreditReasons = creditReasons
      .filter((reason) => credits.some((credit) => credit.counterpartyAccountId === reason.counterpartyAccountId))
      .slice(0, 12)

    return [
      `לפי הנתונים, חייבים לך בסך הכול ${money(credits.reduce((sum, item) => sum + item.amount, 0))}:`,
      ...credits.map((credit) => `• ${credit.counterpartyName}: ${money(credit.amount)}`),
      '',
      relevantCreditReasons.length
        ? 'הסיבות המרכזיות לכך שחייבים לך כסף:'
        : 'לא מצאתי פירוט הוצאות מספק שמסביר את היתרה מעבר לקיזוז התשלומים.',
      ...relevantCreditReasons.map((reason) => {
        const category = reason.category ? `, קטגוריה: ${reason.category}` : ''
        return `• ${reason.description} (${formatDate(reason.date)}${category}) - אתה שילמת ${money(reason.totalAmount)}, והחלק של ${reason.counterpartyName} הוא ${money(reason.yourShare)}`
      }),
      '',
      'היתרה הסופית כבר כוללת קיזוז של תשלומים שנרשמו במערכת.',
    ].join('\n')
  }

  if (!debts.length) {
    return credits.length
      ? `אתה לא חייב כרגע כסף לאחרים. להפך, חייבים לך ${money(credits.reduce((sum, item) => sum + item.amount, 0))}.`
      : 'כרגע לא מופיע שאתה חייב כסף למישהו בדירה.'
  }

  const relevantDebtReasons = debtReasons
    .filter((reason) => debts.some((debt) => debt.counterpartyAccountId === reason.counterpartyAccountId))
    .slice(0, 12)

  return [
    `לפי הנתונים, אתה חייב כרגע ${money(debts.reduce((sum, item) => sum + item.amount, 0))}:`,
    ...debts.map((debt) => `• ל-${debt.counterpartyName}: ${money(debt.amount)}`),
    '',
    relevantDebtReasons.length
      ? 'ההוצאות המרכזיות שיצרו את החוב:'
      : 'לא מצאתי פירוט הוצאות שמסביר את החוב מעבר לקיזוז התשלומים.',
    ...relevantDebtReasons.map((reason) => {
      const category = reason.category ? `, קטגוריה: ${reason.category}` : ''
      return `• ${reason.description} (${formatDate(reason.date)}${category}) - ${reason.counterpartyName} שילם ${money(reason.totalAmount)}, והחלק שלך הוא ${money(reason.yourShare)}`
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
    return ['למה אני חייב כסף?', 'למה חייבים לי כסף?', 'מה הוצאנו הכי הרבה כסף?', 'האם שולם חשמל החודש?']
  }

  if (includesAny(normalized, ['משימ', 'מטל'])) {
    return ['אילו משימות שלי פתוחות?', 'יש משימות באיחור?', 'תן לי תמונת מצב קצרה']
  }

  if (includesAny(normalized, ['קני', 'לקנות', 'חסר'])) {
    return ['מה צריך לקנות עכשיו?', 'תוסיף חלב לרשימת קניות', 'יש קניות דחופות?']
  }

  if (includesAny(normalized, ['פני', 'תקל', 'תחזוק'])) {
    return ['אילו פניות פתוחות כרגע?', 'יש פניות סגורות לאחרונה?', 'מה הפנייה הכי ישנה שעדיין פתוחה?']
  }

  return ['למה אני חייב כסף?', 'מה צריך לקנות עכשיו?', 'אילו משימות פתוחות יש?', 'האם שולם חשמל החודש?']
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
      suggestions: ['למה אני חייב כסף?', 'מה צריך לקנות עכשיו?', 'אילו משימות פתוחות יש?', 'האם שולם חשמל החודש?'],
    }
  }

  const proposedAction = detectAssistantAction(
    normalizedEffectiveQuestion,
    normalizedQuestion,
    account,
    data,
  )
  const answer = proposedAction
    ? `זיהיתי בקשה לביצוע פעולה:\n• ${proposedAction.summary}\n\nאם זה נכון, תאשר ואבצע את זה עבורך.`
    : answerSmartQuestion(data, account, normalizedEffectiveQuestion)

  return {
    answer,
    context: snapshot,
    suggestions: buildSuggestions(normalizedEffectiveQuestion),
    proposedAction,
  }
}
