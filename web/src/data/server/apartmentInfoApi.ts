import { apiRequest } from '../../lib/api/client'
import type { ApartmentInfoAttachment, ApartmentInfoItem } from '../../types/models'

interface ApartmentInfoAttachmentApiResponse extends ApartmentInfoAttachment {}

interface ApartmentInfoItemApiResponse {
  id: number
  apartmentId: number
  title: string
  categoryLabel: string | null
  provider: string | null
  meterNumber: string | null
  accountNumber: string | null
  phone: string | null
  notes: string | null
  attachments: ApartmentInfoAttachmentApiResponse[]
  createdAt: string
  updatedAt: string
}

function mapApartmentInfoItem(item: ApartmentInfoItemApiResponse): ApartmentInfoItem {
  return {
    id: item.id,
    apartment_id: item.apartmentId,
    title: item.title,
    category_label: item.categoryLabel,
    provider: item.provider,
    meter_number: item.meterNumber,
    account_number: item.accountNumber,
    phone: item.phone,
    notes: item.notes,
    attachments: item.attachments,
    created_at: item.createdAt,
    updated_at: item.updatedAt,
  }
}

export async function listApartmentInfoViaApi(apartmentId: number) {
  return apiRequest<{ items: ApartmentInfoItemApiResponse[] }>(
    `/apartments/${apartmentId}/apartment-info`,
    {
      method: 'GET',
    },
  ).then((response) => response.items.map(mapApartmentInfoItem))
}

export async function createApartmentInfoItemViaApi(input: {
  apartmentId: number
  title: string
  categoryLabel: string | null
  provider: string | null
  meterNumber: string | null
  accountNumber: string | null
  phone: string | null
  notes: string | null
  attachments: ApartmentInfoAttachment[]
}) {
  return apiRequest<{ item: ApartmentInfoItemApiResponse | null }>(
    `/apartments/${input.apartmentId}/apartment-info`,
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
  ).then((response) => (response.item ? mapApartmentInfoItem(response.item) : null))
}

export async function updateApartmentInfoItemViaApi(input: {
  apartmentId: number
  itemId: number
  title: string
  categoryLabel: string | null
  provider: string | null
  meterNumber: string | null
  accountNumber: string | null
  phone: string | null
  notes: string | null
  attachments: ApartmentInfoAttachment[]
}) {
  return apiRequest<{ item: ApartmentInfoItemApiResponse | null }>(
    `/apartments/${input.apartmentId}/apartment-info/${input.itemId}`,
    {
      method: 'PUT',
      body: JSON.stringify(input),
    },
  ).then((response) => (response.item ? mapApartmentInfoItem(response.item) : null))
}

export async function deleteApartmentInfoItemViaApi(apartmentId: number, itemId: number) {
  return apiRequest<null>(`/apartments/${apartmentId}/apartment-info/${itemId}`, {
    method: 'DELETE',
  })
}
