function readEnv(name: 'VITE_SUPABASE_URL' | 'VITE_SUPABASE_ANON_KEY') {
  const value = import.meta.env[name]
  return typeof value === 'string' ? value.trim() : ''
}

export const supabaseUrl = readEnv('VITE_SUPABASE_URL')
export const supabaseAnonKey = readEnv('VITE_SUPABASE_ANON_KEY')

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey)
