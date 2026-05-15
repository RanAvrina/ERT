/* eslint-disable react-refresh/only-export-components */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from 'react'
import { useShoppingItemsStore } from '../data/repositories/shoppingRepository'
import {
  createShoppingItemViaApi,
  deleteShoppingItemViaApi,
  listShoppingItemsViaApi,
  updateShoppingItemViaApi,
} from '../data/server/shoppingApi'
import { isSupabaseConfigured } from '../lib/supabase/env'
import { useApartment } from './ApartmentContext'
import { ASSISTANT_DATA_CHANGED_EVENT } from './AssistantContext'
import type { ShoppingItem, ShoppingItemStatus } from '../types/models'

interface NewShoppingItemInput {
  apartment_id: number
  item_name: string
  quantity: string | null
  category: string | null
  status: ShoppingItemStatus
  actor_id: number
}

interface UpdateShoppingItemInput {
  item_name: string
  quantity: string | null
  category: string | null
  status: ShoppingItemStatus
  actor_id: number
  purchased_by: number | null
  purchased_at: string | null
}

interface ShoppingState {
  items: ShoppingItem[]
  addItem: (item: NewShoppingItemInput) => Promise<ShoppingItem | null>
  updateItem: (itemId: number, item: UpdateShoppingItemInput) => Promise<ShoppingItem | null>
  updateItemStatus: (
    itemId: number,
    status: ShoppingItemStatus,
    actorId: number,
  ) => Promise<ShoppingItem | null>
  deleteItem: (itemId: number) => Promise<void>
}

const ShoppingContext = createContext<ShoppingState | null>(null)

export function ShoppingProvider({ children }: { children: ReactNode }) {
  const { current } = useApartment()
  const [items, setItems] = useShoppingItemsStore()
  const nextItemId = useRef(Math.max(...items.map((item) => item.id), 0) + 1)
  const nextTempItemId = useRef(-1)
  const loadedApartmentIdRef = useRef<number | null>(null)

  useEffect(() => {
    let cancelled = false

    async function loadApartmentShopping() {
      if (!isSupabaseConfigured || !current?.apartment.id) return
      if (loadedApartmentIdRef.current === current.apartment.id) return

      try {
        const nextItems = await listShoppingItemsViaApi(current.apartment.id)
        if (!cancelled) {
          setItems(nextItems)
          nextItemId.current = Math.max(...nextItems.map((item) => item.id), 0) + 1
          loadedApartmentIdRef.current = current.apartment.id
        }
      } catch {
        if (!cancelled) {
          setItems([])
          loadedApartmentIdRef.current = null
        }
      }
    }

    void loadApartmentShopping()

    return () => {
      cancelled = true
    }
  }, [current?.apartment.id, setItems])

  useEffect(() => {
    const apartmentId: number | null = current?.apartment.id ?? null
    if (!isSupabaseConfigured || !apartmentId) return
    const resolvedApartmentId = apartmentId

    async function refreshShopping() {
      try {
        const nextItems = await listShoppingItemsViaApi(resolvedApartmentId)
        setItems(nextItems)
        nextItemId.current = Math.max(...nextItems.map((item) => item.id), 0) + 1
        loadedApartmentIdRef.current = resolvedApartmentId
      } catch (error) {
        console.error('Failed to refresh shopping after assistant action.', error)
      }
    }

    function handleAssistantDataChanged(event: Event) {
      const customEvent = event as CustomEvent<{ apartmentId?: number }>
      if (customEvent.detail?.apartmentId !== resolvedApartmentId) return
      void refreshShopping()
    }

    window.addEventListener(ASSISTANT_DATA_CHANGED_EVENT, handleAssistantDataChanged)
    return () => {
      window.removeEventListener(ASSISTANT_DATA_CHANGED_EVENT, handleAssistantDataChanged)
    }
  }, [current?.apartment.id, setItems])

  const addItem = useCallback(
    (item: NewShoppingItemInput) => {
      if (isSupabaseConfigured) {
        const isPurchased = item.status === 'purchased'
        const optimisticItem: ShoppingItem = {
          id: nextTempItemId.current,
          apartment_id: item.apartment_id,
          shopping_list_id: item.apartment_id || nextTempItemId.current,
          item_name: item.item_name,
          quantity: item.quantity,
          category: item.category,
          status: item.status,
          added_by: item.actor_id,
          purchased_by: isPurchased ? item.actor_id : null,
          created_at: new Date().toISOString(),
          purchased_at: isPurchased ? new Date().toISOString() : null,
        }
        nextTempItemId.current -= 1

        setItems((currentItems) => [optimisticItem, ...currentItems])

        void createShoppingItemViaApi({
          apartmentId: item.apartment_id,
          itemName: item.item_name,
          quantity: item.quantity,
          category: item.category,
          status: item.status,
        })
          .then((nextItem) => {
            if (!nextItem) {
              setItems((currentItems) =>
                currentItems.filter((entry) => entry.id !== optimisticItem.id),
              )
              return
            }

            setItems((currentItems) =>
              currentItems.map((entry) => (entry.id === optimisticItem.id ? nextItem : entry)),
            )
          })
          .catch((error) => {
            console.error('Failed to create shopping item.', error)
            setItems((currentItems) =>
              currentItems.filter((entry) => entry.id !== optimisticItem.id),
            )
          })

        return Promise.resolve(optimisticItem)
      }

      const isPurchased = item.status === 'purchased'
      const nextItem: ShoppingItem = {
        id: nextItemId.current,
        apartment_id: item.apartment_id,
        shopping_list_id: item.apartment_id || nextItemId.current,
        item_name: item.item_name,
        quantity: item.quantity,
        category: item.category,
        status: item.status,
        added_by: item.actor_id,
        purchased_by: isPurchased ? item.actor_id : null,
        created_at: new Date().toISOString(),
        purchased_at: isPurchased ? new Date().toISOString() : null,
      }
      nextItemId.current += 1
      setItems((currentItems) => [nextItem, ...currentItems])
      return Promise.resolve(nextItem)
    },
    [setItems],
  )

  const updateItem = useCallback(
    (itemId: number, item: UpdateShoppingItemInput) => {
      if (isSupabaseConfigured) {
        const previousItem = items.find((entry) => entry.id === itemId)
        if (!previousItem) return Promise.resolve(null)

        const optimisticItem: ShoppingItem = {
          ...previousItem,
          item_name: item.item_name,
          quantity: item.quantity,
          category: item.category,
          status: item.status,
          purchased_by: item.purchased_by,
          purchased_at: item.purchased_at,
        }

        setItems((currentItems) =>
          currentItems.map((entry) => (entry.id === itemId ? optimisticItem : entry)),
        )

        const apartmentId = current?.apartment.id ?? 0
        void updateShoppingItemViaApi({
          apartmentId,
          itemId,
          itemName: item.item_name,
          quantity: item.quantity,
          category: item.category,
          status: item.status,
          purchasedByAccountId: item.purchased_by,
          purchasedAt: item.purchased_at,
        })
          .then((updatedItem) => {
            if (!updatedItem) {
              setItems((currentItems) =>
                currentItems.map((entry) => (entry.id === itemId ? previousItem : entry)),
              )
              return
            }

            setItems((currentItems) =>
              currentItems.map((entry) => (entry.id === itemId ? updatedItem : entry)),
            )
          })
          .catch((error) => {
            console.error('Failed to update shopping item.', error)
            setItems((currentItems) =>
              currentItems.map((entry) => (entry.id === itemId ? previousItem : entry)),
            )
          })

        return Promise.resolve(optimisticItem)
      }

      let updatedItem: ShoppingItem | null = null
      setItems((currentItems) =>
        currentItems.map((entry) => {
          if (entry.id !== itemId) return entry
          updatedItem = {
            ...entry,
            item_name: item.item_name,
            quantity: item.quantity,
            category: item.category,
            status: item.status,
            purchased_by: item.purchased_by,
            purchased_at: item.purchased_at,
          }
          return updatedItem
        }),
      )
      return Promise.resolve(updatedItem)
    },
    [current?.apartment.id, items, setItems],
  )

  const updateItemStatus = useCallback(
    async (itemId: number, status: ShoppingItemStatus, actorId: number) => {
      const currentItem = items.find((item) => item.id === itemId)
      if (!currentItem) return null

      return updateItem(itemId, {
        item_name: currentItem.item_name,
        quantity: currentItem.quantity,
        category: currentItem.category,
        status,
        actor_id: actorId,
        purchased_by: status === 'purchased' ? (currentItem.purchased_by ?? actorId) : null,
        purchased_at:
          status === 'purchased' ? (currentItem.purchased_at ?? new Date().toISOString()) : null,
      })
    },
    [items, updateItem],
  )

  const deleteItem = useCallback(
    async (itemId: number) => {
      const previousItem = items.find((item) => item.id === itemId)
      if (isSupabaseConfigured) {
        const apartmentId = current?.apartment.id ?? 0
        setItems((currentItems) => currentItems.filter((item) => item.id !== itemId))

        try {
          await deleteShoppingItemViaApi(apartmentId, itemId)
          return
        } catch (error) {
          console.error('Failed to delete shopping item.', error)
          if (previousItem) {
            setItems((currentItems) => [previousItem, ...currentItems])
          }
          throw error
        }
      }
      setItems((currentItems) => currentItems.filter((item) => item.id !== itemId))
    },
    [current?.apartment.id, items, setItems],
  )

  const value = useMemo(
    () => ({ items, addItem, updateItem, updateItemStatus, deleteItem }),
    [items, addItem, updateItem, updateItemStatus, deleteItem],
  )

  return <ShoppingContext.Provider value={value}>{children}</ShoppingContext.Provider>
}

export function useShopping() {
  const context = useContext(ShoppingContext)
  if (!context) throw new Error('useShopping must be used within ShoppingProvider')
  return context
}
