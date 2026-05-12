import { apiRequest } from '../../lib/api/client'
import type { ShoppingItem, ShoppingItemStatus } from '../../types/models'

interface ShoppingItemApiResponse {
  id: number
  apartmentId: number
  shoppingListId: number
  itemName: string
  quantity: string | null
  category: string | null
  status: ShoppingItemStatus
  addedByAccountId: number
  purchasedByAccountId: number | null
  createdAt: string
  purchasedAt: string | null
}

function mapShoppingItem(item: ShoppingItemApiResponse): ShoppingItem {
  return {
    id: item.id,
    apartment_id: item.apartmentId,
    shopping_list_id: item.shoppingListId,
    item_name: item.itemName,
    quantity: item.quantity,
    category: item.category,
    status: item.status,
    added_by: item.addedByAccountId,
    purchased_by: item.purchasedByAccountId,
    created_at: item.createdAt,
    purchased_at: item.purchasedAt,
  }
}

export async function listShoppingItemsViaApi(apartmentId: number) {
  return apiRequest<{ items: ShoppingItemApiResponse[] }>(`/apartments/${apartmentId}/shopping`, {
    method: 'GET',
  }).then((response) => response.items.map(mapShoppingItem))
}

export async function createShoppingItemViaApi(input: {
  apartmentId: number
  itemName: string
  quantity: string | null
  category: string | null
  status: ShoppingItemStatus
}) {
  return apiRequest<{ item: ShoppingItemApiResponse | null }>(
    `/apartments/${input.apartmentId}/shopping`,
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
  ).then((response) => (response.item ? mapShoppingItem(response.item) : null))
}

export async function updateShoppingItemViaApi(input: {
  apartmentId: number
  itemId: number
  itemName: string
  quantity: string | null
  category: string | null
  status: ShoppingItemStatus
  purchasedByAccountId: number | null
  purchasedAt: string | null
}) {
  return apiRequest<{ item: ShoppingItemApiResponse | null }>(
    `/apartments/${input.apartmentId}/shopping/${input.itemId}`,
    {
      method: 'PUT',
      body: JSON.stringify(input),
    },
  ).then((response) => (response.item ? mapShoppingItem(response.item) : null))
}

export async function deleteShoppingItemViaApi(apartmentId: number, itemId: number) {
  return apiRequest<null>(`/apartments/${apartmentId}/shopping/${itemId}`, {
    method: 'DELETE',
  })
}
