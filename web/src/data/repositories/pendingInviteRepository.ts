import type { PendingInviteRepository } from '../contracts/repositories'
import type { PendingInvite } from '../../utils/invite'
import { localStorageAdapter } from '../persistence/localStorageAdapter'
import { storageKeys } from './storageKeys'

const pendingInviteRepository: PendingInviteRepository = {
  savePendingInviteRecord(invite: PendingInvite) {
    // Pending invite must survive auth redirects and account creation flows.
    localStorageAdapter.write(storageKeys.pendingInvite, invite)
  },

  readPendingInviteRecord() {
    return localStorageAdapter.read<PendingInvite | null>(storageKeys.pendingInvite, null)
  },

  clearPendingInviteRecord() {
    localStorageAdapter.remove(storageKeys.pendingInvite)
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
