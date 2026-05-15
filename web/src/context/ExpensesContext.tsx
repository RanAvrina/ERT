/* eslint-disable react-refresh/only-export-components */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from 'react'
import {
  useExpensesStore,
  usePaymentsStore,
} from '../data/repositories/financeRepository'
import {
  createExpenseViaApi,
  createPaymentViaApi,
  deleteExpenseViaApi,
  deletePaymentViaApi,
  listExpensesViaApi,
  listPaymentsViaApi,
  updateExpenseViaApi,
  updatePaymentViaApi,
} from '../data/server/financeApi'
import { isSupabaseConfigured } from '../lib/supabase/env'
import { useApartment } from './ApartmentContext'
import type { Expense, Payment } from '../types/models'

interface NewExpenseInput {
  apartment_id: number
  paid_by: number
  amount: string
  description: string
  category: string | null
  date: string
  participant_ids: number[]
}

interface UpdateExpenseInput {
  paid_by: number
  amount: string
  description: string
  category: string | null
  date: string
  participant_ids: number[]
}

interface NewPaymentInput {
  apartment_id: number
  payer_id: number
  payee_id: number
  amount: string
  created_at: string
  note?: string | null
}

interface UpdatePaymentInput {
  payer_id: number
  payee_id: number
  amount: string
  created_at: string
  note?: string | null
}

export interface BalanceSettlement {
  id: string
  payer_id: number
  payee_id: number
  amount: string
}

interface ExpensesState {
  expenses: Expense[]
  payments: Payment[]
  addExpense: (expense: NewExpenseInput) => Promise<Expense | null>
  updateExpense: (expenseId: number, expense: UpdateExpenseInput) => Promise<Expense | null>
  addPayment: (payment: NewPaymentInput) => Promise<Payment | null>
  updatePayment: (paymentId: number, payment: UpdatePaymentInput) => Promise<Payment | null>
  deleteExpense: (expenseId: number) => Promise<void>
  deletePayment: (paymentId: number) => Promise<void>
  settlements: BalanceSettlement[]
  netBalanceByUser: Record<number, number>
}

const ExpensesContext = createContext<ExpensesState | null>(null)

function calculateBalances(expenses: Expense[], payments: Payment[]) {
  const netBalanceByUser: Record<number, number> = {}

  expenses
    .filter((expense) => expense.status === 'active')
    .forEach((expense) => {
      const amount = Number(expense.amount)
      const participants = expense.participant_ids
      if (!Number.isFinite(amount) || amount <= 0 || participants.length === 0) return

      const share = amount / participants.length
      netBalanceByUser[expense.paid_by] = (netBalanceByUser[expense.paid_by] ?? 0) + amount

      participants.forEach((participantId) => {
        netBalanceByUser[participantId] = (netBalanceByUser[participantId] ?? 0) - share
      })
    })

  payments
    .filter((payment) => payment.status === 'recorded')
    .forEach((payment) => {
      const amount = Number(payment.amount)
      if (!Number.isFinite(amount) || amount <= 0) return

      netBalanceByUser[payment.payer_id] = (netBalanceByUser[payment.payer_id] ?? 0) + amount
      netBalanceByUser[payment.payee_id] = (netBalanceByUser[payment.payee_id] ?? 0) - amount
    })

  const debtors = Object.entries(netBalanceByUser)
    .map(([userId, balance]) => ({ userId: Number(userId), amount: -balance }))
    .filter((entry) => entry.amount > 0.005)
    .sort((a, b) => b.amount - a.amount)

  const creditors = Object.entries(netBalanceByUser)
    .map(([userId, balance]) => ({ userId: Number(userId), amount: balance }))
    .filter((entry) => entry.amount > 0.005)
    .sort((a, b) => b.amount - a.amount)

  const settlements: BalanceSettlement[] = []
  let debtorIndex = 0
  let creditorIndex = 0

  while (debtors[debtorIndex] && creditors[creditorIndex]) {
    const debtor = debtors[debtorIndex]
    const creditor = creditors[creditorIndex]
    const amount = Math.min(debtor.amount, creditor.amount)

    if (amount > 0.005) {
      settlements.push({
        id: `balance-${debtor.userId}-${creditor.userId}-${settlements.length}`,
        payer_id: debtor.userId,
        payee_id: creditor.userId,
        amount: amount.toFixed(2),
      })
    }

    debtor.amount -= amount
    creditor.amount -= amount
    if (debtor.amount <= 0.005) debtorIndex += 1
    if (creditor.amount <= 0.005) creditorIndex += 1
  }

  return { netBalanceByUser, settlements }
}

export function ExpensesProvider({ children }: { children: ReactNode }) {
  const { current } = useApartment()
  const [expenses, setExpenses] = useExpensesStore()
  const [payments, setPayments] = usePaymentsStore()
  const nextExpenseId = useRef(Math.max(...expenses.map((expense) => expense.id), 0) + 1)
  const nextPaymentId = useRef(Math.max(...payments.map((payment) => payment.id), 0) + 1)
  const loadedApartmentIdRef = useRef<number | null>(null)

  useEffect(() => {
    let cancelled = false

    async function loadApartmentFinance() {
      if (!isSupabaseConfigured || !current?.apartment.id) return
      if (loadedApartmentIdRef.current === current.apartment.id) return

      try {
        const [nextExpenses, nextPayments] = await Promise.all([
          listExpensesViaApi(current.apartment.id),
          listPaymentsViaApi(current.apartment.id),
        ])

        if (!cancelled) {
          setExpenses(nextExpenses)
          setPayments(nextPayments)
          nextExpenseId.current = Math.max(...nextExpenses.map((expense) => expense.id), 0) + 1
          nextPaymentId.current = Math.max(...nextPayments.map((payment) => payment.id), 0) + 1
          loadedApartmentIdRef.current = current.apartment.id
        }
      } catch {
        if (!cancelled) {
          setExpenses([])
          setPayments([])
          loadedApartmentIdRef.current = null
        }
      }
    }

    void loadApartmentFinance()

    return () => {
      cancelled = true
    }
  }, [current?.apartment.id, setExpenses, setPayments])

  const addExpense = useCallback(
    async (expense: NewExpenseInput) => {
      if (isSupabaseConfigured) {
        const nextExpense = await createExpenseViaApi({
          apartmentId: expense.apartment_id,
          paidByAccountId: expense.paid_by,
          amount: expense.amount,
          description: expense.description,
          category: expense.category,
          date: expense.date,
          participantAccountIds: expense.participant_ids,
        })

        if (!nextExpense) return null
        setExpenses((currentExpenses) => [nextExpense, ...currentExpenses.filter((item) => item.id !== nextExpense.id)])
        return nextExpense
      }

      const nextExpense: Expense = {
        id: nextExpenseId.current,
        status: 'active',
        ...expense,
      }
      nextExpenseId.current += 1
      setExpenses((currentExpenses) => [nextExpense, ...currentExpenses])
      return nextExpense
    },
    [setExpenses],
  )

  const addPayment = useCallback(
    async (payment: NewPaymentInput) => {
      if (isSupabaseConfigured) {
        const nextPayment = await createPaymentViaApi({
          apartmentId: payment.apartment_id,
          payerAccountId: payment.payer_id,
          payeeAccountId: payment.payee_id,
          amount: payment.amount,
          paymentDate: payment.created_at,
          note: payment.note ?? null,
        })

        if (!nextPayment) return null
        setPayments((currentPayments) => [nextPayment, ...currentPayments.filter((item) => item.id !== nextPayment.id)])
        return nextPayment
      }

      const nextPayment: Payment = {
        id: nextPaymentId.current,
        status: 'recorded',
        ...payment,
      }
      nextPaymentId.current += 1
      setPayments((currentPayments) => [nextPayment, ...currentPayments])
      return nextPayment
    },
    [setPayments],
  )

  const updatePayment = useCallback(
    async (paymentId: number, payment: UpdatePaymentInput) => {
      if (isSupabaseConfigured) {
        const apartmentId = current?.apartment.id ?? 0
        const updatedPayment = await updatePaymentViaApi({
          paymentId,
          apartmentId,
          payerAccountId: payment.payer_id,
          payeeAccountId: payment.payee_id,
          amount: payment.amount,
          paymentDate: payment.created_at,
          note: payment.note ?? null,
        })

        if (!updatedPayment) return null
        setPayments((currentPayments) =>
          currentPayments.map((item) => (item.id === paymentId ? updatedPayment : item)),
        )
        return updatedPayment
      }

      let updatedPayment: Payment | null = null
      setPayments((currentPayments) =>
        currentPayments.map((item) => {
          if (item.id !== paymentId) return item
          updatedPayment = { ...item, ...payment }
          return updatedPayment
        }),
      )
      return updatedPayment
    },
    [current?.apartment.id, setPayments],
  )

  const updateExpense = useCallback(
    async (expenseId: number, expense: UpdateExpenseInput) => {
      if (isSupabaseConfigured) {
        const apartmentId = current?.apartment.id ?? 0
        const updatedExpense = await updateExpenseViaApi({
          expenseId,
          apartmentId,
          paidByAccountId: expense.paid_by,
          amount: expense.amount,
          description: expense.description,
          category: expense.category,
          date: expense.date,
          participantAccountIds: expense.participant_ids,
        })

        if (!updatedExpense) return null
        setExpenses((currentExpenses) =>
          currentExpenses.map((item) => (item.id === expenseId ? updatedExpense : item)),
        )
        return updatedExpense
      }

      let updatedExpense: Expense | null = null
      setExpenses((currentExpenses) =>
        currentExpenses.map((item) => {
          if (item.id !== expenseId) return item
          updatedExpense = { ...item, ...expense }
          return updatedExpense
        }),
      )
      return updatedExpense
    },
    [current?.apartment.id, setExpenses],
  )

  const deleteExpense = useCallback(
    async (expenseId: number) => {
      if (isSupabaseConfigured) {
        const apartmentId = current?.apartment.id ?? 0
        await deleteExpenseViaApi(apartmentId, expenseId)
      }

      setExpenses((currentExpenses) =>
        currentExpenses.map((expense) =>
          expense.id === expenseId ? { ...expense, status: 'deleted' } : expense,
        ),
      )
    },
    [current?.apartment.id, setExpenses],
  )

  const deletePayment = useCallback(
    async (paymentId: number) => {
      if (isSupabaseConfigured) {
        const apartmentId = current?.apartment.id ?? 0
        await deletePaymentViaApi(apartmentId, paymentId)
      }

      setPayments((currentPayments) =>
        currentPayments.map((payment) =>
          payment.id === paymentId ? { ...payment, status: 'cancelled' } : payment,
        ),
      )
    },
    [current?.apartment.id, setPayments],
  )

  const { netBalanceByUser, settlements } = useMemo(
    () => calculateBalances(expenses, payments),
    [expenses, payments],
  )

  const value = useMemo(
    () => ({
      expenses,
      payments,
      addExpense,
      updateExpense,
      addPayment,
      updatePayment,
      deleteExpense,
      deletePayment,
      settlements,
      netBalanceByUser,
    }),
    [
      expenses,
      payments,
      addExpense,
      updateExpense,
      addPayment,
      updatePayment,
      deleteExpense,
      deletePayment,
      settlements,
      netBalanceByUser,
    ],
  )

  return <ExpensesContext.Provider value={value}>{children}</ExpensesContext.Provider>
}

export function useExpenses() {
  const context = useContext(ExpensesContext)
  if (!context) throw new Error('useExpenses must be used within ExpensesProvider')
  return context
}
