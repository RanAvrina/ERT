import { apiRequest } from '../../lib/api/client'

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

export interface AssistantActionProposal {
  token: string
  type: 'create_payment' | 'create_shopping_item'
  summary: string
  confirmLabel: string
}

export interface AssistantQueryResponse {
  answer: string
  context: AssistantContextSnapshot
  suggestions: string[]
  proposedAction?: AssistantActionProposal
}

export async function readAssistantContextViaApi(apartmentId: number) {
  const response = await apiRequest<{ context: AssistantContextSnapshot }>(
    `/apartments/${apartmentId}/assistant/context`,
  )

  return response.context
}

export async function queryAssistantViaApi(apartmentId: number, question: string) {
  return apiRequest<AssistantQueryResponse>(`/apartments/${apartmentId}/assistant/query`, {
    method: 'POST',
    body: JSON.stringify({ question }),
  })
}

export async function confirmAssistantActionViaApi(apartmentId: number, token: string) {
  return apiRequest<{ message: string }>(`/apartments/${apartmentId}/assistant/action/confirm`, {
    method: 'POST',
    body: JSON.stringify({ token }),
  })
}

export async function cancelAssistantActionViaApi(apartmentId: number, token: string) {
  return apiRequest<null>(`/apartments/${apartmentId}/assistant/action/cancel`, {
    method: 'POST',
    body: JSON.stringify({ token }),
  })
}
