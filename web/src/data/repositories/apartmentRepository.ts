import type { ApartmentRepository } from '../contracts/repositories'
import type { ApartmentState } from '../../types/apartmentState'
import { useMemoryValue } from '../persistence/useMemoryValue'

const apartmentRepository: ApartmentRepository = {
  useApartmentStateStore() {
    return useMemoryValue<ApartmentState | null>(null)
  },

  useApartmentsRegistryStore() {
    return useMemoryValue<Record<number, ApartmentState>>({})
  },
}

export function useApartmentStateStore() {
  return apartmentRepository.useApartmentStateStore()
}

export function useApartmentsRegistryStore() {
  return apartmentRepository.useApartmentsRegistryStore()
}
