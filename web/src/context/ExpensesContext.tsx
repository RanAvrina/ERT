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
import { ASSISTANT_DATA_CHANGED_EVENT } from './AssistantContext'
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
  const nextTempExpenseId = useRef(-1)
  const nextTempPaymentId = useRef(-1)
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

  useEffect(() => {
    const apartmentId: number | null = current?.apartment.id ?? null
    if (!isSupabaseConfigured || !apartmentId) return
    const resolvedApartmentId = apartmentId

    async function refreshFinance() {
      try {
        const [nextExpenses, nextPayments] = await Promise.all([
          listExpensesViaApi(resolvedApartmentId),
          listPaymentsViaApi(resolvedApartmentId),
        ])
        setExpenses(nextExpenses)
        setPayments(nextPayments)
        nextExpenseId.current = Math.max(...nextExpenses.map((expense) => expense.id), 0) + 1
        nextPaymentId.current = Math.max(...nextPayments.map((payment) => payment.id), 0) + 1
        loadedApartmentIdRef.current = resolvedApartmentId
      } catch (error) {
        console.error('Failed to refresh finance after assistant action.', error)
      }
    }

    function handleAssistantDataChanged(event: Event) {
      const customEvent = event as CustomEvent<{ apartmentId?: number }>
      if (customEvent.detail?.apartmentId !== resolvedApartmentId) return
      void refreshFinance()
    }

    window.addEventListener(ASSISTANT_DATA_CHANGED_EVENT, handleAssistantDataChanged)
    return () => {
      window.removeEventListener(ASSISTANT_DATA_CHANGED_EVENT, handleAssistantDataChanged)
    }
  }, [current?.apartment.id, setExpenses, setPayments])

  const addExpense = useCallback(
    (expense: NewExpenseInput) => {
      if (isSupabaseConfigured) {
        const optimisticExpense: Expense = {
          id: nextTempExpenseId.current,
          status: 'active',
          ...expense,
        }
        nextTempExpenseId.current -= 1

        setExpenses((currentExpenses) => [optimisticExpense, ...currentExpenses])

        void createExpenseViaApi({
          apartmentId: expense.apartment_id,
          paidByAccountId: expense.paid_by,
          amount: expense.amount,
          description: expense.description,
          category: expense.category,
          date: expense.date,
          participantAccountIds: expense.participant_ids,
        })
          .then((nextExpense) => {
            if (!nextExpense) {
              setExpenses((currentExpenses) =>
                currentExpenses.filter((item) => item.id !== optimisticExpense.id),
              )
              return
            }

            setExpenses((currentExpenses) =>
              currentExpenses.map((item) =>
                item.id === optimisticExpense.id ? nextExpense : item,
              ),
            )
          })
          .catch((error) => {
            console.error('Failed to create expense.', error)
            setExpenses((currentExpenses) =>
              currentExpenses.filter((item) => item.id !== optimisticExpense.id),
            )
          })

        return Promise.resolve(optimisticExpense)
      }

      const nextExpense: Expense = {
        id: nextExpenseId.current,
        status: 'active',
        ...expense,
      }
      nextExpenseId.current += 1
      setExpenses((currentExpenses) => [nextExpense, ...currentExpenses])
      return Promise.resolve(nextExpense)
    },
    [setExpenses],
  )

  const addPayment = useCallback(
    (payment: NewPaymentInput) => {
      if (isSupabaseConfigured) {
        const optimisticPayment: Payment = {
          id: nextTempPaymentId.current,
          status: 'recorded',
          ...payment,
        }
        nextTempPaymentId.current -= 1

        setPayments((currentPayments) => [optimisticPayment, ...currentPayments])

        void createPaymentViaApi({
          apartmentId: payment.apartment_id,
          payerAccountId: payment.payer_id,
          payeeAccountId: payment.payee_id,
          amount: payment.amount,
          paymentDate: payment.created_at,
          note: payment.note ?? null,
        })
          .then((nextPayment) => {
            if (!nextPayment) {
              setPayments((currentPayments) =>
                currentPayments.filter((item) => item.id !== optimisticPayment.id),
              )
              return
            }

            setPayments((currentPayments) =>
              currentPayments.map((item) =>
                item.id === optimisticPayment.id ? nextPayment : item,
              ),
            )
          })
          .catch((error) => {
            console.error('Failed to create payment.', error)
            setPayments((currentPayments) =>
              currentPayments.filter((item) => item.id !== optimisticPayment.id),
            )
          })

        return Promise.resolve(optimisticPayment)
      }

      const nextPayment: Payment = {
        id: nextPaymentId.current,
        status: 'recorded',
        ...payment,
      }
      nextPaymentId.current += 1
      setPayments((currentPayments) => [nextPayment, ...currentPayments])
      return Promise.resolve(nextPayment)
    },
    [setPayments],
  )

  const updatePayment = useCallback(
    (paymentId: number, payment: UpdatePaymentInput) => {
      if (isSupabaseConfigured) {
        const previousPayment = payments.find((item) => item.id === paymentId)
        if (!previousPayment) return Promise.resolve(null)

        const optimisticPayment: Payment = {
          ...previousPayment,
          ...payment,
        }

        setPayments((currentPayments) =>
          currentPayments.map((item) => (item.id === paymentId ? optimisticPayment : item)),
        )

        const apartmentId = current?.apartment.id ?? 0
        void updatePaymentViaApi({
          paymentId,
          apartmentId,
          payerAccountId: payment.payer_id,
          payeeAccountId: payment.payee_id,
          amount: payment.amount,
          paymentDate: payment.created_at,
          note: payment.note ?? null,
        })
          .then((updatedPayment) => {
            if (!updatedPayment) {
              setPayments((currentPayments) =>
                currentPayments.map((item) => (item.id === paymentId ? previousPayment : item)),
              )
              return
            }

            setPayments((currentPayments) =>
              currentPayments.map((item) => (item.id === paymentId ? updatedPayment : item)),
            )
          })
          .catch((error) => {
            console.error('Failed to update payment.', error)
            setPayments((currentPayments) =>
              currentPayments.map((item) => (item.id === paymentId ? previousPayment : item)),
            )
          })

        return Promise.resolve(optimisticPayment)
      }

      let updatedPayment: Payment | null = null
      setPayments((currentPayments) =>
        currentPayments.map((item) => {
          if (item.id !== paymentId) return item
          updatedPayment = { ...item, ...payment }
          return updatedPayment
        }),
      )
      return Promise.resolve(updatedPayment)
    },
    [current?.apartment.id, payments, setPayments],
  )

  const updateExpense = useCallback(
    (expenseId: number, expense: UpdateExpenseInput) => {
      if (isSupabaseConfigured) {
        const previousExpense = expenses.find((item) => item.id === expenseId)
        if (!previousExpense) return Promise.resolve(null)

        const optimisticExpense: Expense = {
          ...previousExpense,
          ...expense,
        }

        setExpenses((currentExpenses) =>
          currentExpenses.map((item) => (item.id === expenseId ? optimisticExpense : item)),
        )

        const apartmentId = current?.apartment.id ?? 0
        void updateExpenseViaApi({
          expenseId,
          apartmentId,
          paidByAccountId: expense.paid_by,
          amount: expense.amount,
          description: expense.description,
          category: expense.category,
          date: expense.date,
          participantAccountIds: expense.participant_ids,
        })
          .then((updatedExpense) => {
            if (!updatedExpense) {
              setExpenses((currentExpenses) =>
                currentExpenses.map((item) => (item.id === expenseId ? previousExpense : item)),
              )
              return
            }

            setExpenses((currentExpenses) =>
              currentExpenses.map((item) => (item.id === expenseId ? updatedExpense : item)),
            )
          })
          .catch((error) => {
            console.error('Failed to update expense.', error)
            setExpenses((currentExpenses) =>
              currentExpenses.map((item) => (item.id === expenseId ? previousExpense : item)),
            )
          })

        return Promise.resolve(optimisticExpense)
      }

      let updatedExpense: Expense | null = null
      setExpenses((currentExpenses) =>
        currentExpenses.map((item) => {
          if (item.id !== expenseId) return item
          updatedExpense = { ...item, ...expense }
          return updatedExpense
        }),
      )
      return Promise.resolve(updatedExpense)
    },
    [current?.apartment.id, expenses, setExpenses],
  )

  const deleteExpense = useCallback(
    async (expenseId: number) => {
      const previousExpense = expenses.find((expense) => expense.id === expenseId)
      if (isSupabaseConfigured) {
        const apartmentId = current?.apartment.id ?? 0
        setExpenses((currentExpenses) =>
          currentExpenses.map((expense) =>
            expense.id === expenseId ? { ...expense, status: 'deleted' } : expense,
          ),
        )

        try {
          await deleteExpenseViaApi(apartmentId, expenseId)
          return
        } catch (error) {
          console.error('Failed to delete expense.', error)
          if (previousExpense) {
            setExpenses((currentExpenses) =>
              currentExpenses.map((expense) =>
                expense.id === expenseId ? previousExpense : expense,
              ),
            )
          }
          throw error
        }
      }

      setExpenses((currentExpenses) =>
        currentExpenses.map((expense) =>
          expense.id === expenseId ? { ...expense, status: 'deleted' } : expense,
        ),
      )
    },
    [current?.apartment.id, expenses, setExpenses],
  )

  const deletePayment = useCallback(
    async (paymentId: number) => {
      const previousPayment = payments.find((payment) => payment.id === paymentId)
      if (isSupabaseConfigured) {
        const apartmentId = current?.apartment.id ?? 0
        setPayments((currentPayments) =>
          currentPayments.map((payment) =>
            payment.id === paymentId ? { ...payment, status: 'cancelled' } : payment,
          ),
        )

        try {
          await deletePaymentViaApi(apartmentId, paymentId)
          return
        } catch (error) {
          console.error('Failed to delete payment.', error)
          if (previousPayment) {
            setPayments((currentPayments) =>
              currentPayments.map((payment) =>
                payment.id === paymentId ? previousPayment : payment,
              ),
            )
          }
          throw error
        }
      }

      setPayments((currentPayments) =>
        currentPayments.map((payment) =>
          payment.id === paymentId ? { ...payment, status: 'cancelled' } : payment,
        ),
      )
    },
    [current?.apartment.id, payments, setPayments],
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
