import {
  clearPendingInviteRecord,
  readPendingInviteRecord,
  savePendingInviteRecord,
} from '../data/repositories/pendingInviteRepository'

export type InviteRole = 'tenant' | 'landlord'

export interface PendingInvite {
  apartmentId: number
  apartmentName?: string | null
  role: InviteRole
  token: string | null
}

export function savePendingInvite(invite: PendingInvite) {
  savePendingInviteRecord(invite)
}

export function readPendingInvite() {
  return readPendingInviteRecord()
}

export function clearPendingInvite() {
  clearPendingInviteRecord()
}

export function isTerminalPendingInviteError(rawMessage: string) {
  const message = rawMessage.trim().toLowerCase()

  return (
    message.includes('invite is no longer active') ||
    message.includes('invite has expired') ||
    message.includes('invite was not found') ||
    (message.includes('קישור ההזמנה') && message.includes('לא פעיל'))
  )
}
