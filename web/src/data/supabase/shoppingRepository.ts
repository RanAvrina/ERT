import type { ShoppingItem } from '../../types/models'
import type { ShoppingItemRow, ShoppingListRow } from '../../types/database'
import { supabase } from '../../lib/supabase/client'
import { ensureSupabaseResult, ensureValue } from './errors'
import { listMembershipRowsByApartmentId } from './membershipsRepository'

async function loadMembershipMaps(apartmentId: number) {
  const rows = await listMembershipRowsByApartmentId(apartmentId)
  return {
    accountToMembership: new Map(rows.map((row) => [row.account_id, row.id])),
    membershipToAccount: new Map(rows.map((row) => [row.id, row.account_id])),
  }
}

function mapShoppingItemRowToModel(
  row: ShoppingItemRow,
  membershipToAccount: Map<number, number>,
): ShoppingItem {
  return {
    id: row.id,
    apartment_id: row.apartment_id,
    shopping_list_id: row.shopping_list_id,
    item_name: row.item_name,
    quantity: row.quantity,
    category: row.category,
    status: row.status,
    added_by: membershipToAccount.get(row.added_by_membership_id) ?? 0,
    purchased_by:
      row.purchased_by_membership_id == null
        ? null
        : (membershipToAccount.get(row.purchased_by_membership_id) ?? null),
    created_at: row.created_at,
    purchased_at: row.purchased_at,
  }
}

async function ensureDefaultShoppingList(apartmentId: number, createdByAccountId: number) {
  const client = ensureValue(supabase, 'Supabase client is not configured.')
  const { accountToMembership } = await loadMembershipMaps(apartmentId)
  const createdByMembershipId = accountToMembership.get(createdByAccountId)

  if (!createdByMembershipId) {
    throw new Error('לא נמצא שיוך דייר תקף לרשימת הקניות.')
  }

  const { data, error } = await client
    .from('shopping_lists')
    .select('*')
    .eq('apartment_id', apartmentId)
    .eq('status', 'active')
    .order('id', { ascending: true })
    .limit(1)
  ensureSupabaseResult(error, 'Failed to load shopping lists')

  const existingList = ((data ?? []) as ShoppingListRow[])[0]
  if (existingList) return existingList.id

  const { data: createdList, error: createError } = await client
    .from('shopping_lists')
    .insert({
      apartment_id: apartmentId,
      title: 'רשימת קניות',
      status: 'active',
      created_by_membership_id: createdByMembershipId,
    })
    .select('id')
    .single()
  ensureSupabaseResult(createError, 'Failed to create shopping list')

  return ensureValue(createdList, 'Failed to create shopping list').id as number
}

export async function listShoppingItemsByApartmentId(apartmentId: number) {
  const client = ensureValue(supabase, 'Supabase client is not configured.')
  const { membershipToAccount } = await loadMembershipMaps(apartmentId)

  const { data, error } = await client
    .from('shopping_items')
    .select('*')
    .eq('apartment_id', apartmentId)
    .neq('status', 'cancelled')
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
  ensureSupabaseResult(error, 'Failed to load shopping items')

  return ((data ?? []) as ShoppingItemRow[]).map((row) =>
    mapShoppingItemRowToModel(row, membershipToAccount),
  )
}

export async function createShoppingItemRecord(input: {
  apartmentId: number
  actorAccountId: number
  itemName: string
  quantity: string | null
  category: string | null
  status: ShoppingItem['status']
}) {
  const client = ensureValue(supabase, 'Supabase client is not configured.')
  const { accountToMembership } = await loadMembershipMaps(input.apartmentId)
  const addedByMembershipId = accountToMembership.get(input.actorAccountId)
  if (!addedByMembershipId) {
    throw new Error('לא נמצא שיוך דייר תקף לפריט הקניות.')
  }

  const shoppingListId = await ensureDefaultShoppingList(input.apartmentId, input.actorAccountId)
  const isPurchased = input.status === 'purchased'

  const { data, error } = await client
    .from('shopping_items')
    .insert({
      apartment_id: input.apartmentId,
      shopping_list_id: shoppingListId,
      item_name: input.itemName,
      quantity: input.quantity,
      category: input.category,
      status: input.status,
      added_by_membership_id: addedByMembershipId,
      purchased_by_membership_id: isPurchased ? addedByMembershipId : null,
      purchased_at: isPurchased ? new Date().toISOString() : null,
    })
    .select('*')
    .single()
  ensureSupabaseResult(error, 'Failed to create shopping item')

  const items = await listShoppingItemsByApartmentId(input.apartmentId)
  return items.find((item) => item.id === (data as ShoppingItemRow).id) ?? null
}

export async function updateShoppingItemRecord(input: {
  apartmentId: number
  itemId: number
  actorAccountId: number
  itemName: string
  quantity: string | null
  category: string | null
  status: ShoppingItem['status']
  purchasedByAccountId: number | null
  purchasedAt: string | null
}) {
  const client = ensureValue(supabase, 'Supabase client is not configured.')
  const { accountToMembership } = await loadMembershipMaps(input.apartmentId)
  const purchasedByMembershipId =
    input.status === 'purchased'
      ? (accountToMembership.get(input.purchasedByAccountId ?? input.actorAccountId) ?? null)
      : null

  const { error } = await client
    .from('shopping_items')
    .update({
      item_name: input.itemName,
      quantity: input.quantity,
      category: input.category,
      status: input.status,
      purchased_by_membership_id: purchasedByMembershipId,
      purchased_at:
        input.status === 'purchased' ? (input.purchasedAt ?? new Date().toISOString()) : null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', input.itemId)
  ensureSupabaseResult(error, 'Failed to update shopping item')

  const items = await listShoppingItemsByApartmentId(input.apartmentId)
  return items.find((item) => item.id === input.itemId) ?? null
}

export async function deleteShoppingItemRecord(itemId: number) {
  const client = ensureValue(supabase, 'Supabase client is not configured.')
  const { error } = await client.from('shopping_items').delete().eq('id', itemId)
  ensureSupabaseResult(error, 'Failed to delete shopping item')
}
