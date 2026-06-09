import { listExpensesByApartmentId, listPaymentsByApartmentId } from './finance-service.js'
import { listHomeItemsByApartmentId } from './home-item-service.js'
import { listApartmentInfoItemsByApartmentId } from './apartment-info-service.js'
import { getApartmentStateSnapshot } from './apartment-service.js'
import { listShoppingItemsByApartmentId } from './shopping-service.js'
import { listTasksByApartmentId } from './task-service.js'
import { listTicketsByApartmentId } from './ticket-service.js'

interface BalanceSettlement {
  payerAccountId: number
  payerName: string
  payeeAccountId: number
  payeeName: string
  amount: number
}

function calculateBalances(
  expenses: Awaited<ReturnType<typeof listExpensesByApartmentId>>,
  payments: Awaited<ReturnType<typeof listPaymentsByApartmentId>>,
) {
  const netBalanceByUser: Record<number, number> = {}

  expenses
    .filter((expense) => expense.status === 'active')
    .forEach((expense) => {
      const amount = Number(expense.amount)
      const participants = expense.participantAccountIds
      if (!Number.isFinite(amount) || amount <= 0 || participants.length === 0) return

      const share = amount / participants.length
      netBalanceByUser[expense.paidByAccountId] =
        (netBalanceByUser[expense.paidByAccountId] ?? 0) + amount

      participants.forEach((participantId) => {
        netBalanceByUser[participantId] = (netBalanceByUser[participantId] ?? 0) - share
      })
    })

  payments
    .filter((payment) => payment.status === 'recorded')
    .forEach((payment) => {
      const amount = Number(payment.amount)
      if (!Number.isFinite(amount) || amount <= 0) return

      netBalanceByUser[payment.payerAccountId] =
        (netBalanceByUser[payment.payerAccountId] ?? 0) + amount
      netBalanceByUser[payment.payeeAccountId] =
        (netBalanceByUser[payment.payeeAccountId] ?? 0) - amount
    })

  const debtors = Object.entries(netBalanceByUser)
    .map(([userId, balance]) => ({ userId: Number(userId), amount: -balance }))
    .filter((entry) => entry.amount > 0.005)
    .sort((left, right) => right.amount - left.amount)

  const creditors = Object.entries(netBalanceByUser)
    .map(([userId, balance]) => ({ userId: Number(userId), amount: balance }))
    .filter((entry) => entry.amount > 0.005)
    .sort((left, right) => right.amount - left.amount)

  const settlements: Array<{ payerAccountId: number; payeeAccountId: number; amount: number }> = []
  let debtorIndex = 0
  let creditorIndex = 0

  while (debtors[debtorIndex] && creditors[creditorIndex]) {
    const debtor = debtors[debtorIndex]
    const creditor = creditors[creditorIndex]
    const amount = Math.min(debtor.amount, creditor.amount)

    if (amount > 0.005) {
      settlements.push({
        payerAccountId: debtor.userId,
        payeeAccountId: creditor.userId,
        amount: Number(amount.toFixed(2)),
      })
    }

    debtor.amount -= amount
    creditor.amount -= amount
    if (debtor.amount <= 0.005) debtorIndex += 1
    if (creditor.amount <= 0.005) creditorIndex += 1
  }

  return { netBalanceByUser, settlements }
}

export async function buildAgentContext(apartmentId: number, currentAccountId: number) {
  const [state, tasks, expenses, payments, shoppingItems, tickets, homeItems, apartmentInfoItems] = await Promise.all([
    getApartmentStateSnapshot(apartmentId),
    listTasksByApartmentId(apartmentId),
    listExpensesByApartmentId(apartmentId),
    listPaymentsByApartmentId(apartmentId),
    listShoppingItemsByApartmentId(apartmentId),
    listTicketsByApartmentId(apartmentId),
    listHomeItemsByApartmentId(apartmentId),
    listApartmentInfoItemsByApartmentId(apartmentId),
  ])

  const activeUsers = state.users.filter((user) => user.status === 'active')
  const residentUsers = activeUsers.filter((user) => user.role !== 'landlord')
  const currentUser = activeUsers.find((user) => user.id === currentAccountId) ?? null
  const { netBalanceByUser, settlements } = calculateBalances(expenses, payments)
  const settlementsWithNames: BalanceSettlement[] = settlements.map((settlement) => ({
    payerAccountId: settlement.payerAccountId,
    payerName: activeUsers.find((user) => user.id === settlement.payerAccountId)?.name ?? '',
    payeeAccountId: settlement.payeeAccountId,
    payeeName: activeUsers.find((user) => user.id === settlement.payeeAccountId)?.name ?? '',
    amount: settlement.amount,
  }))

  return {
    today: new Date().toISOString().slice(0, 10),
    user: currentUser
      ? {
          id: currentUser.id,
          name: currentUser.name,
          role: currentUser.role,
        }
      : null,
    apartment: state.apartment.name,
    roommates: residentUsers.map((user) => ({
      id: user.id,
      name: user.name,
      role: user.role,
      status: user.status,
    })),
    tasks: tasks.slice(0, 30).map((task) => ({
      id: task.id,
      title: task.title,
      description: task.description,
      dueDate: task.dueDate,
      status: task.status,
      assigneeAccountId: task.assigneeAccountId,
      assigneeName:
        activeUsers.find((user) => user.id === task.assigneeAccountId)?.name ?? null,
    })),
    expenses: expenses
      .filter((expense) => expense.status === 'active')
      .slice(0, 20)
      .map((expense) => ({
        id: expense.id,
        description: expense.description,
        amount: expense.amount,
        category: expense.category,
        date: expense.date,
        paidByAccountId: expense.paidByAccountId,
        paidByName:
          activeUsers.find((user) => user.id === expense.paidByAccountId)?.name ?? null,
        participantAccountIds: expense.participantAccountIds,
        participantNames: expense.participantAccountIds
          .map((accountId) => activeUsers.find((user) => user.id === accountId)?.name ?? null)
          .filter((name): name is string => Boolean(name)),
      })),
    payments: payments
      .filter((payment) => payment.status === 'recorded')
      .slice(0, 20)
      .map((payment) => ({
        id: payment.id,
        amount: payment.amount,
        note: payment.note,
        date: payment.paymentDate,
        payerAccountId: payment.payerAccountId,
        payerName:
          activeUsers.find((user) => user.id === payment.payerAccountId)?.name ?? null,
        payeeAccountId: payment.payeeAccountId,
        payeeName:
          activeUsers.find((user) => user.id === payment.payeeAccountId)?.name ?? null,
      })),
    shoppingItems: shoppingItems.slice(0, 25).map((item) => ({
      id: item.id,
      name: item.itemName,
      quantity: item.quantity,
      category: item.category,
      status: item.status,
      createdAt: item.createdAt,
      purchasedAt: item.purchasedAt,
    })),
    tickets: tickets.slice(0, 20).map((ticket) => ({
      id: ticket.id,
      title: ticket.title,
      category: ticket.category,
      status: ticket.status,
      createdAt: ticket.createdAt,
    })),
    homeItems: homeItems.map((item) => ({
      id: item.id,
      area: item.area,
      name: item.name,
      defaultNote: item.defaultNote,
    })),
    apartmentInfoItems: apartmentInfoItems.map((item) => ({
      id: item.id,
      title: item.title,
      categoryLabel: item.categoryLabel,
      provider: item.provider,
      meterNumber: item.meterNumber,
      accountNumber: item.accountNumber,
      phone: item.phone,
      notes: item.notes,
    })),
    balanceSummary: {
      currentUserNetBalance: currentUser ? netBalanceByUser[currentUser.id] ?? 0 : 0,
      roommates: activeUsers.map((user) => {
        const netBalance = netBalanceByUser[user.id] ?? 0
        return {
          id: user.id,
          name: user.name,
          netBalance,
          position:
            netBalance > 0.005 ? 'creditor' : netBalance < -0.005 ? 'debtor' : 'settled',
        }
      }),
      settlements: settlementsWithNames,
    },
  }
}
