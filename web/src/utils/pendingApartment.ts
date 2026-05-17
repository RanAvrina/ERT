import { localStorageAdapter } from '../data/persistence/localStorageAdapter'
import { storageKeys } from '../data/repositories/storageKeys'

export interface PendingApartmentCreation {
  apartmentName: string
  adminName: string
  adminPhone: string
  adminEmail: string
}

export function savePendingApartment(input: PendingApartmentCreation) {
  localStorageAdapter.write(storageKeys.pendingApartment, input)
}

export function readPendingApartment() {
  return localStorageAdapter.read<PendingApartmentCreation | null>(
    storageKeys.pendingApartment,
    null,
  )
}

export function clearPendingApartment() {
  localStorageAdapter.remove(storageKeys.pendingApartment)
}
