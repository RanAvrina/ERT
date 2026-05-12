import type { FinanceRepository } from '../contracts/repositories'
import type { Expense, Payment } from '../../types/models'
import { useMemoryValue } from '../persistence/useMemoryValue'

const financeRepository: FinanceRepository = {
  useExpensesStore() {
    return useMemoryValue<Expense[]>([])
  },

  usePaymentsStore() {
    return useMemoryValue<Payment[]>([])
  },
}

export function useExpensesStore() {
  return financeRepository.useExpensesStore()
}

export function usePaymentsStore() {
  return financeRepository.usePaymentsStore()
}
