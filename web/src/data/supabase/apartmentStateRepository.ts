import { findApartmentRowById } from './apartmentsRepository'
import { loadApartmentUsers } from './membershipsRepository'
import { ensureValue } from './errors'
import {
  mapAggregateToApartmentState,
  mapApartmentRowToModel,
} from './mappers'

export async function loadApartmentState(apartmentId: number) {
  const apartmentRow = await findApartmentRowById(apartmentId)
  const row = ensureValue(apartmentRow, 'Apartment not found in Supabase.')
  const users = await loadApartmentUsers(apartmentId)
  const adminUser = ensureValue(
    users.find((user) => user.role === 'admin') ?? null,
    'Apartment admin membership is missing.',
  )

  return mapAggregateToApartmentState({
    apartment: mapApartmentRowToModel(row),
    users,
    adminUser,
    landlordUser: users.find((user) => user.role === 'landlord') ?? null,
  })
}
