import { apiRequest } from '../../lib/api/client'
import type { Expense, ExpenseAttachment, Payment } from '../../types/models'

interface ExpenseAttachmentApiResponse extends ExpenseAttachment {}

interface ExpenseApiResponse {
  id: number
  apartmentId: number
  paidByAccountId: number
  amount: string
  description: string
  category: string | null
  date: string
  status: 'active' | 'deleted'
  participantAccountIds: number[]
  attachments?: ExpenseAttachmentApiResponse[]
  createdAt?: string
  updatedAt?: string
}

interface PaymentApiResponse {
  id: number
  apartmentId: number
  payerAccountId: number
  payeeAccountId: number
  amount: string
  status: 'recorded' | 'cancelled'
  paymentDate: string
  note?: string | null
  createdAt?: string
  updatedAt?: string
}

function mapExpense(expense: ExpenseApiResponse): Expense {
  return {
    id: expense.id,
    apartment_id: expense.apartmentId,
    paid_by: expense.paidByAccountId,
    amount: expense.amount,
    description: expense.description,
    category: expense.category,
    date: expense.date,
    status: expense.status,
    participant_ids: expense.participantAccountIds,
    attachments: expense.attachments ?? [],
  }
}

function mapPayment(payment: PaymentApiResponse): Payment {
  return {
    id: payment.id,
    apartment_id: payment.apartmentId,
    payer_id: payment.payerAccountId,
    payee_id: payment.payeeAccountId,
    amount: payment.amount,
    status: payment.status,
    created_at: payment.paymentDate,
    note: payment.note ?? null,
  }
}

export async function listExpensesViaApi(apartmentId: number) {
  return apiRequest<{ expenses: ExpenseApiResponse[] }>(`/apartments/${apartmentId}/expenses`, {
    method: 'GET',
  }).then((response) => response.expenses.map(mapExpense))
}

export async function createExpenseViaApi(input: {
  apartmentId: number
  paidByAccountId: number
  amount: string
  description: string
  category: string | null
  date: string
  participantAccountIds: number[]
  attachments?: ExpenseAttachmentApiResponse[]
}) {
  return apiRequest<{ expense: ExpenseApiResponse | null }>(`/apartments/${input.apartmentId}/expenses`, {
    method: 'POST',
    body: JSON.stringify(input),
  }).then((response) => (response.expense ? mapExpense(response.expense) : null))
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
  attachments?: ExpenseAttachmentApiResponse[]
}) {
  return apiRequest<{ expense: ExpenseApiResponse | null }>(
    `/apartments/${input.apartmentId}/expenses/${input.expenseId}`,
    {
      method: 'PUT',
      body: JSON.stringify(input),
    },
  ).then((response) => (response.expense ? mapExpense(response.expense) : null))
}

export async function deleteExpenseViaApi(apartmentId: number, expenseId: number) {
  return apiRequest<null>(`/apartments/${apartmentId}/expenses/${expenseId}`, {
    method: 'DELETE',
  })
}

export async function listPaymentsViaApi(apartmentId: number) {
  return apiRequest<{ payments: PaymentApiResponse[] }>(`/apartments/${apartmentId}/payments`, {
    method: 'GET',
  }).then((response) => response.payments.map(mapPayment))
}

export async function createPaymentViaApi(input: {
  apartmentId: number
  payerAccountId: number
  payeeAccountId: number
  amount: string
  paymentDate: string
  note?: string | null
}) {
  return apiRequest<{ payment: PaymentApiResponse | null }>(`/apartments/${input.apartmentId}/payments`, {
    method: 'POST',
    body: JSON.stringify(input),
  }).then((response) => (response.payment ? mapPayment(response.payment) : null))
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
  return apiRequest<{ payment: PaymentApiResponse | null }>(
    `/apartments/${input.apartmentId}/payments/${input.paymentId}`,
    {
      method: 'PUT',
      body: JSON.stringify(input),
    },
  ).then((response) => (response.payment ? mapPayment(response.payment) : null))
}

export async function deletePaymentViaApi(apartmentId: number, paymentId: number) {
  return apiRequest<null>(`/apartments/${apartmentId}/payments/${paymentId}`, {
    method: 'DELETE',
  })
}
