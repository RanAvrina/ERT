import { apiRequest } from '../../lib/api/client'
import type { ApartmentState } from '../../types/apartmentState'
import type { Apartment, User } from '../../types/models'

interface ApartmentSummaryApi {
  id: number
  name: string
  isActive: boolean
}

export interface ApartmentStateApiResponse {
  apartment: {
    id: number
    name: string
    is_active: boolean
  }
  adminUser: User
  landlordUser: User | null
  users: User[]
}

function mapApartmentSummary(apartment: ApartmentSummaryApi): Apartment {
  return {
    id: apartment.id,
    name: apartment.name,
    is_active: apartment.isActive,
  }
}

export function mapApartmentState(state: ApartmentStateApiResponse): ApartmentState {
  const adminUser = state.adminUser

  return {
    apartment: state.apartment,
    adminUser,
    adminContact: { phone: '' },
    roommates: state.users.filter((user) => user.role !== 'landlord'),
    roommateContacts: Object.fromEntries(
      state.users
        .filter((user) => user.role !== 'landlord')
        .map((user) => [user.id, { phone: '' }]),
    ),
    landlordUser: state.landlordUser,
    landlordContact: state.landlordUser ? { phone: '' } : null,
    credentialsByEmail: {},
  }
}

export async function createApartmentViaApi(name: string) {
  return apiRequest<{
    apartment: ApartmentSummaryApi
  }>('/apartments', {
    method: 'POST',
    body: JSON.stringify({ name: name.trim() }),
  })
}

export async function loadApartmentStateViaApi(apartmentId: number) {
  return apiRequest<ApartmentStateApiResponse>(`/apartments/${apartmentId}/state`, {
    method: 'GET',
  }).then(mapApartmentState)
}

export async function listApartmentsViaApi() {
  return apiRequest<{ apartments: ApartmentSummaryApi[] }>('/apartments', {
    method: 'GET',
  }).then((response) => response.apartments.map(mapApartmentSummary))
}
