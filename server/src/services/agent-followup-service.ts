interface PendingAgentFollowUpEntry {
  accountId: number
  apartmentId: number
  originalMessage: string
  latestAssistantQuestion: string
  expiresAt: number
}

const FOLLOW_UP_TTL_MS = 10 * 60 * 1000
const pendingFollowUps = new Map<string, PendingAgentFollowUpEntry>()

function buildKey(accountId: number, apartmentId: number) {
  return `${accountId}:${apartmentId}`
}

function cleanupExpiredFollowUps() {
  const now = Date.now()
  for (const [key, entry] of pendingFollowUps.entries()) {
    if (entry.expiresAt <= now) {
      pendingFollowUps.delete(key)
    }
  }
}

export function getPendingAgentFollowUp(accountId: number, apartmentId: number) {
  cleanupExpiredFollowUps()
  return pendingFollowUps.get(buildKey(accountId, apartmentId)) ?? null
}

export function storePendingAgentFollowUp(input: {
  accountId: number
  apartmentId: number
  originalMessage: string
  latestAssistantQuestion: string
}) {
  cleanupExpiredFollowUps()
  pendingFollowUps.set(buildKey(input.accountId, input.apartmentId), {
    accountId: input.accountId,
    apartmentId: input.apartmentId,
    originalMessage: input.originalMessage,
    latestAssistantQuestion: input.latestAssistantQuestion,
    expiresAt: Date.now() + FOLLOW_UP_TTL_MS,
  })
}

export function clearPendingAgentFollowUp(accountId: number, apartmentId: number) {
  pendingFollowUps.delete(buildKey(accountId, apartmentId))
}
