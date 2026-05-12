import type { ApartmentRow } from '../../types/database'
import { supabase } from '../../lib/supabase/client'
import { ensureSupabaseResult, ensureValue } from './errors'
import { mapApartmentRowToModel } from './mappers'

const table = 'apartments'

export async function createApartmentRow(name: string) {
  const client = ensureValue(supabase, 'Supabase client is not configured.')
  const { data, error } = await client
    .from(table)
    .insert({ name: name.trim(), is_active: true })
    .select('*')
    .single()
  ensureSupabaseResult(error, 'Failed to create apartment')
  return data as ApartmentRow
}

export async function findApartmentRowById(apartmentId: number) {
  const client = ensureValue(supabase, 'Supabase client is not configured.')
  const { data, error } = await client
    .from(table)
    .select('*')
    .eq('id', apartmentId)
    .maybeSingle()
  ensureSupabaseResult(error, 'Failed to load apartment')
  return (data as ApartmentRow | null) ?? null
}

export async function listApartments() {
  const client = ensureValue(supabase, 'Supabase client is not configured.')
  const { data, error } = await client.from(table).select('*').order('id', { ascending: false })
  ensureSupabaseResult(error, 'Failed to list apartments')
  return ((data ?? []) as ApartmentRow[]).map(mapApartmentRowToModel)
}
