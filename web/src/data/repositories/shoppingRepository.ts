import type { ShoppingRepository } from '../contracts/repositories'
import type { ShoppingItem } from '../../types/models'
import { useMemoryValue } from '../persistence/useMemoryValue'

const shoppingRepository: ShoppingRepository = {
  useShoppingItemsStore() {
    return useMemoryValue<ShoppingItem[]>([])
  },
}

export function useShoppingItemsStore() {
  return shoppingRepository.useShoppingItemsStore()
}
