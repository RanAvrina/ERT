export type PersistenceMode = 'localStorage' | 'supabase'

export interface PersistenceAdapter {
  read<T>(key: string, fallback: T): T
  write<T>(key: string, value: T): void
  remove(key: string): void
}
