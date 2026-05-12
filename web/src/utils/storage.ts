import { persistenceAdapter } from '../data/persistence'
export { storageKeys } from '../data/repositories/storageKeys'

export function readStorage<T>(key: string, fallback: T): T {
  return persistenceAdapter.read(key, fallback)
}

export function writeStorage<T>(key: string, value: T) {
  persistenceAdapter.write(key, value)
}

export function removeStorage(key: string) {
  persistenceAdapter.remove(key)
}
