import { supabase } from '../../lib/supabase/client'
import { invalidateApiAuthState, primeApiAccessToken } from '../../lib/api/client'
import { ensureValue } from './errors'
import type { AuthChangeEvent, User } from '@supabase/supabase-js'

export async function signUpWithPassword(input: {
  email: string
  password: string
  name: string
  phone: string
  emailRedirectTo?: string
}) {
  const client = ensureValue(supabase, 'Supabase client is not configured.')
  const { data, error } = await client.auth.signUp({
    email: input.email.trim().toLowerCase(),
    password: input.password,
    options: {
      emailRedirectTo: input.emailRedirectTo,
      data: {
        full_name: input.name.trim(),
        phone: input.phone.trim(),
      },
    },
  })

  if (error) throw new Error(error.message)
  primeApiAccessToken(data.session?.access_token ?? null, data.session?.expires_at ?? null)
  return {
    user: data.user,
    hasSession: Boolean(data.session?.access_token),
  }
}

export async function signInWithPassword(input: { email: string; password: string }) {
  const client = ensureValue(supabase, 'Supabase client is not configured.')
  const { data, error } = await client.auth.signInWithPassword({
    email: input.email.trim().toLowerCase(),
    password: input.password,
  })

  if (error) throw new Error(error.message)
  primeApiAccessToken(data.session?.access_token ?? null, data.session?.expires_at ?? null)
  return data.user
}

export async function signOutAuth() {
  const client = ensureValue(supabase, 'Supabase client is not configured.')
  const { error } = await client.auth.signOut({ scope: 'local' })
  invalidateApiAuthState()
  if (error) throw new Error(error.message)
}

export async function sendPasswordResetEmail(email: string, redirectTo: string) {
  const client = ensureValue(supabase, 'Supabase client is not configured.')
  const { error } = await client.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
    redirectTo,
  })

  if (error) throw new Error(error.message)
}

export async function updateAuthPassword(password: string) {
  const client = ensureValue(supabase, 'Supabase client is not configured.')
  const { data, error } = await client.auth.updateUser({ password })
  if (error) throw new Error(error.message)
  return data.user
}

export async function hasAuthSession() {
  const client = ensureValue(supabase, 'Supabase client is not configured.')
  const { data, error } = await client.auth.getSession()
  if (error) throw new Error(error.message)
  return Boolean(data.session)
}

export async function getCurrentAuthUser() {
  const client = ensureValue(supabase, 'Supabase client is not configured.')
  const { data, error } = await client.auth.getUser()
  if (error) throw new Error(error.message)
  return (data.user as User | null) ?? null
}

export async function getCurrentAccessToken() {
  const client = ensureValue(supabase, 'Supabase client is not configured.')
  const { data, error } = await client.auth.getSession()
  if (error) throw new Error(error.message)
  return data.session?.access_token ?? null
}

export function subscribeToAuthChanges(
  callback: (event: AuthChangeEvent, user: User | null) => void,
) {
  const client = ensureValue(supabase, 'Supabase client is not configured.')
  const {
    data: { subscription },
  } = client.auth.onAuthStateChange((event, session) => {
    primeApiAccessToken(session?.access_token ?? null, session?.expires_at ?? null)
    callback(event, session?.user ?? null)
  })

  return () => subscription.unsubscribe()
}
