import { apiRequest } from '../../lib/api/client'
import type { Expense, Payment } from '../../types/models'

interface ExpenseAttachmentPayload {
  id?: string
  name: string
  type: string
  size: number
  url: string
}

export async function listExpensesViaApi(apartmentId: number) {
  return apiRequest<{ expenses: Expense[] }>(`/apartments/${apartmentId}/expenses`, {
    method: 'GET',
  }).then((response) => response.expenses)
}

export async function createExpenseViaApi(input: {
  apartmentId: number
  paidByAccountId: number
  amount: string
  description: string
  category: string | null
  date: string
  participantAccountIds: number[]
  attachments?: ExpenseAttachmentPayload[]
}) {
  return apiRequest<{ expense: Expense | null }>(`/apartments/${input.apartmentId}/expenses`, {
    method: 'POST',
    body: JSON.stringify(input),
  }).then((response) => response.expense)
}

export async function updateExpenseViaApi(input: {
  apartmentId: number
  expenseId: number
  paidByAccountId: number
  amount: string
  description: string
  category: string | null
  date: string
  participantAccountIds: number[]
  attachments?: ExpenseAttachmentPayload[]
}) {
  return apiRequest<{ expense: Expense | null }>(
    `/apartments/${input.apartmentId}/expenses/${input.expenseId}`,
    {
      method: 'PUT',
      body: JSON.stringify(input),
    },
  ).then((response) => response.expense)
}

export async function deleteExpenseViaApi(apartmentId: number, expenseId: number) {
  return apiRequest<null>(`/apartments/${apartmentId}/expenses/${expenseId}`, {
    method: 'DELETE',
  })
}

export async function listPaymentsViaApi(apartmentId: number) {
  return apiRequest<{ payments: Payment[] }>(`/apartments/${apartmentId}/payments`, {
    method: 'GET',
  }).then((response) => response.payments)
}

export async function createPaymentViaApi(input: {
  apartmentId: number
  payerAccountId: number
  payeeAccountId: number
  amount: string
  paymentDate: string
  note?: string | null
}) {
  return apiRequest<{ payment: Payment | null }>(`/apartments/${input.apartmentId}/payments`, {
    method: 'POST',
    body: JSON.stringify(input),
  }).then((response) => response.payment)
}

export async function updatePaymentViaApi(input: {
  apartmentId: number
  paymentId: number
  payerAccountId: number
  payeeAccountId: number
  amount: string
  paymentDate: string
  note?: string | null
}) {
  return apiRequest<{ payment: Payment | null }>(
    `/apartments/${input.apartmentId}/payments/${input.paymentId}`,
    {
      method: 'PUT',
      body: JSON.stringify(input),
    },
  ).then((response) => response.payment)
}

export async function deletePaymentViaApi(apartmentId: number, paymentId: number) {
  return apiRequest<null>(`/apartments/${apartmentId}/payments/${paymentId}`, {
    method: 'DELETE',
  })
}
