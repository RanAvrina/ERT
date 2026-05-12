import type { PersistenceMode } from './types'
import { isSupabaseConfigured } from '../../lib/supabase/env'

const requestedMode = import.meta.env.VITE_PERSISTENCE_MODE

export const persistenceMode: PersistenceMode =
  requestedMode === 'supabase' && isSupabaseConfigured ? 'supabase' : 'localStorage'

export const isSupabaseMode = persistenceMode === 'supabase'
