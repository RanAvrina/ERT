import { apiRequest } from '../../lib/api/client'

export interface AgentHistoryItem {
  role: 'user' | 'assistant'
  content: string
}

export interface PendingAgentAction {
  token: string
  type: string
  summary: string
  expiresAt: string
}

export interface AgentQueryResult {
  reply: string
  pendingAction: PendingAgentAction | null
}

export interface AgentConfirmResult {
  ok: boolean
  message: string
  apartmentId: number
}

export async function queryAgentViaApi(input: {
  message: string
  history: AgentHistoryItem[]
}) {
  return apiRequest<AgentQueryResult>('/agent', {
    method: 'POST',
    body: JSON.stringify({
      message: input.message,
      history: input.history,
    }),
  })
}

export async function confirmAgentActionViaApi(token: string) {
  return apiRequest<AgentConfirmResult>('/agent/confirm', {
    method: 'POST',
    body: JSON.stringify({ token }),
  })
}
