import { getApartmentStateSnapshot } from './apartment-service.js'
import { listApartmentInfoItemsByApartmentId } from './apartment-info-service.js'
import { listExpensesByApartmentId, listPaymentsByApartmentId } from './finance-service.js'
import { listShoppingItemsByApartmentId } from './shopping-service.js'
import { listTasksByApartmentId } from './task-service.js'
import { listTicketsByApartmentId } from './ticket-service.js'

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
}

function buildDebtSummary(apartmentState: Awaited<ReturnType<typeof getApartmentStateSnapshot>>, expenses: Awaited<ReturnType<typeof listExpensesByApartmentId>>, payments: Awaited<ReturnType<typeof listPaymentsByApartmentId>>) {
  const users = apartmentState.users

  const userNames = new Map(users.map((user) => [user.id, user.name]))
  const balances = new Map<number, number>()

  for (const user of users) {
    balances.set(user.id, 0)
  }

  for (const expense of expenses.filter((item) => item.status === 'active')) {
    const amount = Number(expense.amount)
    const participants = expense.participantAccountIds.length
      ? expense.participantAccountIds
      : users.map((user) => user.id)

    if (!participants.length || !Number.isFinite(amount)) continue

    const share = amount / participants.length
    balances.set(
      expense.paidByAccountId,
      (balances.get(expense.paidByAccountId) ?? 0) + amount,
    )

    for (const participantId of participants) {
      balances.set(
        participantId,
        (balances.get(participantId) ?? 0) - share,
      )
    }
  }

  for (const payment of payments.filter((item) => item.status === 'recorded')) {
    const amount = Number(payment.amount)
    if (!Number.isFinite(amount)) continue

    balances.set(
      payment.payerAccountId,
      (balances.get(payment.payerAccountId) ?? 0) + amount,
    )
    balances.set(
      payment.payeeAccountId,
      (balances.get(payment.payeeAccountId) ?? 0) - amount,
    )
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

export async function getAssistantContextSnapshot(apartmentId: number): Promise<AssistantContextSnapshot> {
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

  const debts = buildDebtSummary(apartmentState, expenses, payments)

  return {
    apartment: {
      id: apartmentState.apartment.id,
      name: apartmentState.apartment.name,
    },
    roommatesCount: apartmentState.users.length,
    openTasksCount: tasks.filter((task) => task.status !== 'done' && task.status !== 'cancelled').length,
    openShoppingItemsCount: shoppingItems.filter((item) => item.status === 'open').length,
    openTicketsCount: tickets.filter((ticket) => ticket.status !== 'closed' && ticket.status !== 'cancelled').length,
    recentExpensesCount: expenses.filter((expense) => expense.status === 'active').length,
    recentPaymentsCount: payments.filter((payment) => payment.status === 'recorded').length,
    apartmentInfoCount: apartmentInfoItems.length,
    shoppingItems: shoppingItems
      .filter((item) => item.status === 'open')
      .slice(0, 8)
      .map((item) => ({
        id: item.id,
        itemName: item.itemName,
        quantity: item.quantity,
        status: item.status,
      })),
    debts: debts.slice(0, 8),
  }
}

export async function answerAssistantQuestion(apartmentId: number, question: string) {
  const snapshot = await getAssistantContextSnapshot(apartmentId)
  const normalizedQuestion = question.trim().toLowerCase()

  if (!normalizedQuestion) {
    return {
      answer: 'צריך לכתוב שאלה כדי שאוכל לענות עליה.',
      context: snapshot,
      suggestions: [
        'למה אני חייב כסף?',
        'מה צריך לקנות עכשיו?',
        'כמה משימות פתוחות יש?',
      ],
    }
  }

  if (normalizedQuestion.includes('קני') || normalizedQuestion.includes('לקנות')) {
    const shoppingSummary = snapshot.shoppingItems.length
      ? snapshot.shoppingItems
          .map((item) =>
            item.quantity ? `${item.itemName} (${item.quantity})` : item.itemName,
          )
          .join(', ')
      : 'כרגע אין פריטי קניות פתוחים.'

    return {
      answer: snapshot.shoppingItems.length
        ? `כרגע פתוחים ${snapshot.openShoppingItemsCount} פריטי קניות: ${shoppingSummary}.`
        : shoppingSummary,
      context: snapshot,
      suggestions: ['יש פניות פתוחות?', 'כמה משימות פתוחות יש?'],
    }
  }

  if (
    normalizedQuestion.includes('חייב') ||
    normalizedQuestion.includes('כסף') ||
    normalizedQuestion.includes('למה אני')
  ) {
    const debtSummary = snapshot.debts.length
      ? snapshot.debts
          .map((debt) => `${debt.fromName} חייב${debt.fromName.endsWith('ה') ? 'ת' : ''} ל־${debt.toName} ${debt.amount} ש"ח`)
          .join(', ')
      : 'כרגע אין יתרות לתיאום.'

    return {
      answer: debtSummary,
      context: snapshot,
      suggestions: ['מה צריך לקנות עכשיו?', 'יש פניות פתוחות?'],
    }
  }

  if (normalizedQuestion.includes('משימ') || normalizedQuestion.includes('מטל')) {
    return {
      answer: `כרגע יש ${snapshot.openTasksCount} משימות פתוחות בדירה.`,
      context: snapshot,
      suggestions: ['מה צריך לקנות עכשיו?', 'יש פניות פתוחות?'],
    }
  }

  if (normalizedQuestion.includes('פניות') || normalizedQuestion.includes('תקלה')) {
    return {
      answer: `כרגע יש ${snapshot.openTicketsCount} פניות פתוחות במערכת.`,
      context: snapshot,
      suggestions: ['כמה משימות פתוחות יש?', 'מה צריך לקנות עכשיו?'],
    }
  }

  return {
    answer:
      'התשתית של הסוכן מוכנה. כרגע אני יודע לענות על קניות, יתרות לתיאום, משימות ופניות. השלב הבא הוא לחבר לכאן את לוגיקת הסוכן המלאה.',
    context: snapshot,
    suggestions: [
      'למה אני חייב כסף?',
      'מה צריך לקנות עכשיו?',
      'כמה משימות פתוחות יש?',
    ],
  }
}
