import { apiRequest } from '../../lib/api/client'
import type { ApartmentHomeItem } from '../../types/models'

interface ApartmentHomeItemApiResponse {
  id: number
  apartmentId: number
  itemKey: string
  area: string
  name: string
  defaultNote: string
  createdAt: string
  updatedAt: string
}

function mapHomeItem(item: ApartmentHomeItemApiResponse): ApartmentHomeItem {
  return {
    id: item.id,
    apartment_id: item.apartmentId,
    item_key: item.itemKey,
    area: item.area,
    name: item.name,
    default_note: item.defaultNote,
    created_at: item.createdAt,
    updated_at: item.updatedAt,
  }
}

export async function listHomeItemsViaApi(apartmentId: number) {
  return apiRequest<{ items: ApartmentHomeItemApiResponse[] }>(
    `/apartments/${apartmentId}/home-items`,
    {
      method: 'GET',
    },
  ).then((response) => response.items.map(mapHomeItem))
}

export async function updateHomeItemViaApi(input: {
  apartmentId: number
  itemId: number
  area: string
  name: string
  defaultNote: string
}) {
  return apiRequest<{ item: ApartmentHomeItemApiResponse | null }>(
    `/apartments/${input.apartmentId}/home-items/${input.itemId}`,
    {
      method: 'PATCH',
      body: JSON.stringify(input),
    },
  ).then((response) => (response.item ? mapHomeItem(response.item) : null))
}

export async function createHomeItemViaApi(input: {
  apartmentId: number
  area: string
  name: string
  defaultNote: string
}) {
  return apiRequest<{ item: ApartmentHomeItemApiResponse | null }>(
    `/apartments/${input.apartmentId}/home-items`,
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
  ).then((response) => (response.item ? mapHomeItem(response.item) : null))
}
