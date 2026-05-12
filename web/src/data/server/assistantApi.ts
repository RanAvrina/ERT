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
}

export interface AssistantQueryResponse {
  answer: string
  context: AssistantContextSnapshot
  suggestions: string[]
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
