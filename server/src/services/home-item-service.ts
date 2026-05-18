import { ApiError } from '../lib/api-error.js'
import { supabaseAdmin } from '../lib/supabase.js'

export interface ApartmentHomeItemRow {
  id: number
  apartment_id: number
  item_key: string
  area: string
  name: string
  default_note: string
  created_at: string
  updated_at: string
}

export interface ApartmentHomeItemTemplate {
  itemKey: string
  area: string
  name: string
  defaultNote: string
}

export const DEFAULT_HOME_ITEM_TEMPLATES: ApartmentHomeItemTemplate[] = [
  {
    itemKey: 'bathroom-cleaning',
    area: 'שירותים ומקלחת',
    name: 'ניקיון שירותים',
    defaultNote: 'לנקות אסלה, כיור ורצפה. להשאיר חלון פתוח לאוורור אחרי ניקוי.',
  },
  {
    itemKey: 'kitchen-cleaning',
    area: 'מטבח',
    name: 'ניקיון מטבח',
    defaultNote: 'לנקות משטחי עבודה, כיריים ורצפה. להשאיר את אזור הכיור יבש בסיום.',
  },
]

function normalizeItemKeyPart(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

async function buildUniqueItemKey(apartmentId: number, area: string, name: string) {
  const baseKey =
    `${normalizeItemKeyPart(area)}-${normalizeItemKeyPart(name)}`.replace(/^-+|-+$/g, '') ||
    `item-${Date.now()}`

  const { data, error } = await supabaseAdmin
    .from('apartment_home_items')
    .select('item_key')
    .eq('apartment_id', apartmentId)
    .like('item_key', `${baseKey}%`)

  if (error) throw new Error(`Failed to build apartment home item key: ${error.message}`)

  const existingKeys = new Set(
    ((data ?? []) as Array<{ item_key: string }>).map((row) => row.item_key),
  )

  if (!existingKeys.has(baseKey)) return baseKey

  let suffix = 2
  while (existingKeys.has(`${baseKey}-${suffix}`)) {
    suffix += 1
  }

  return `${baseKey}-${suffix}`
}

function mapHomeItem(row: ApartmentHomeItemRow) {
  return {
    id: row.id,
    apartmentId: row.apartment_id,
    itemKey: row.item_key,
    area: row.area,
    name: row.name,
    defaultNote: row.default_note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export async function seedApartmentHomeItems(apartmentId: number) {
  const { error } = await supabaseAdmin.from('apartment_home_items').upsert(
    DEFAULT_HOME_ITEM_TEMPLATES.map((item) => ({
      apartment_id: apartmentId,
      item_key: item.itemKey,
      area: item.area,
      name: item.name,
      default_note: item.defaultNote,
    })),
    {
      onConflict: 'apartment_id,item_key',
      ignoreDuplicates: true,
    },
  )

  if (error) {
    throw new Error(`Failed to seed apartment home items: ${error.message}`)
  }
}

export async function listHomeItemsByApartmentId(apartmentId: number) {
  const { data, error } = await supabaseAdmin
    .from('apartment_home_items')
    .select('*')
    .eq('apartment_id', apartmentId)
    .order('id', { ascending: true })

  if (error) throw new Error(`Failed to load apartment home items: ${error.message}`)
  return ((data ?? []) as ApartmentHomeItemRow[]).map(mapHomeItem)
}

async function requireHomeItemRowInApartment(apartmentId: number, itemId: number) {
  const { data, error } = await supabaseAdmin
    .from('apartment_home_items')
    .select('*')
    .eq('id', itemId)
    .single()

  if (error) {
    if (error.code === 'PGRST116') {
      throw new ApiError(404, 'Home item not found.')
    }
    throw new Error(`Failed to load apartment home item: ${error.message}`)
  }

  const row = data as ApartmentHomeItemRow
  if (row.apartment_id !== apartmentId) {
    throw new ApiError(404, 'Home item not found in this apartment.')
  }

  return row
}

export async function updateApartmentHomeItem(input: {
  apartmentId: number
  itemId: number
  area: string
  name: string
  defaultNote: string
}) {
  await requireHomeItemRowInApartment(input.apartmentId, input.itemId)

  const { data, error } = await supabaseAdmin
    .from('apartment_home_items')
    .update({
      area: input.area,
      name: input.name,
      default_note: input.defaultNote,
      updated_at: new Date().toISOString(),
    })
    .eq('id', input.itemId)
    .select('*')
    .single()

  if (error) throw new Error(`Failed to update apartment home item: ${error.message}`)
  return mapHomeItem(data as ApartmentHomeItemRow)
}

export async function createApartmentHomeItem(input: {
  apartmentId: number
  area: string
  name: string
  defaultNote: string
}) {
  const itemKey = await buildUniqueItemKey(input.apartmentId, input.area, input.name)

  const { data, error } = await supabaseAdmin
    .from('apartment_home_items')
    .insert({
      apartment_id: input.apartmentId,
      item_key: itemKey,
      area: input.area,
      name: input.name,
      default_note: input.defaultNote,
    })
    .select('*')
    .single()

  if (error) throw new Error(`Failed to create apartment home item: ${error.message}`)
  return mapHomeItem(data as ApartmentHomeItemRow)
}

export async function deleteApartmentHomeItem(input: {
  apartmentId: number
  itemId: number
}) {
  await requireHomeItemRowInApartment(input.apartmentId, input.itemId)

  const { error } = await supabaseAdmin
    .from('apartment_home_items')
    .delete()
    .eq('id', input.itemId)

  if (error) throw new Error(`Failed to delete apartment home item: ${error.message}`)
}
