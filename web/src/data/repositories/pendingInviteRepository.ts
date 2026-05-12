import type { PendingInviteRepository } from '../contracts/repositories'
import type { PendingInvite } from '../../utils/invite'
import { persistenceAdapter } from '../persistence'
import { storageKeys } from './storageKeys'

const pendingInviteRepository: PendingInviteRepository = {
  savePendingInviteRecord(invite: PendingInvite) {
    persistenceAdapter.write(storageKeys.pendingInvite, invite)
  },

  readPendingInviteRecord() {
    return persistenceAdapter.read<PendingInvite | null>(storageKeys.pendingInvite, null)
  },

  clearPendingInviteRecord() {
    persistenceAdapter.remove(storageKeys.pendingInvite)
  },
}

export function savePendingInviteRecord(invite: PendingInvite) {
  pendingInviteRepository.savePendingInviteRecord(invite)
}

export function readPendingInviteRecord() {
  return pendingInviteRepository.readPendingInviteRecord()
}

export function clearPendingInviteRecord() {
  pendingInviteRepository.clearPendingInviteRecord()
}
