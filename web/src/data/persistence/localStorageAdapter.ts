import type { PersistenceAdapter } from './types'

export const localStorageAdapter: PersistenceAdapter = {
  read<T>(key: string, fallback: T): T {
    if (typeof window === 'undefined') return fallback

    try {
      const storedValue = window.localStorage.getItem(key)
      return storedValue ? (JSON.parse(storedValue) as T) : fallback
    } catch {
      window.localStorage.removeItem(key)
      return fallback
    }
  },

  write<T>(key: string, value: T) {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(key, JSON.stringify(value))
  },

  remove(key: string) {
    if (typeof window === 'undefined') return
    window.localStorage.removeItem(key)
  },
}
