import type { ApartmentInfoRepository } from '../contracts/repositories'
import type { ApartmentInfoItem } from '../../types/models'
import { useMemoryValue } from '../persistence/useMemoryValue'

const apartmentInfoRepository: ApartmentInfoRepository = {
  useApartmentInfoStore() {
    return useMemoryValue<ApartmentInfoItem[]>([])
  },
}

export function useApartmentInfoStore() {
  return apartmentInfoRepository.useApartmentInfoStore()
}
