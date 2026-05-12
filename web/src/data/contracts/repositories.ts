import type { Dispatch, SetStateAction } from 'react'
import type { AccountIdentity } from '../../types/auth'
import type { ApartmentState } from '../../types/apartmentState'
import type {
  ApartmentInfoItem,
  Expense,
  Payment,
  ShoppingItem,
  Task,
  TicketComment,
  User,
} from '../../types/models'
import type { TicketWithAttachments } from '../../data/supabase/ticketsRepository'
import type { PendingInvite } from '../../utils/invite'

export type StoreSetter<T> = Dispatch<SetStateAction<T>>
export type StoreHookResult<T> = readonly [T, StoreSetter<T>]

export interface AccountsRepository {
  useAccountsStore(): StoreHookResult<AccountIdentity[]>
}

export interface AuthSessionRepository {
  useAuthSessionStore(): StoreHookResult<User | null>
}

export interface ApartmentRepository {
  useApartmentStateStore(): StoreHookResult<ApartmentState | null>
  useApartmentsRegistryStore(): StoreHookResult<Record<number, ApartmentState>>
}

export interface FinanceRepository {
  useExpensesStore(): StoreHookResult<Expense[]>
  usePaymentsStore(): StoreHookResult<Payment[]>
}

export interface TasksRepository {
  useTasksStore(): StoreHookResult<Task[]>
}

export interface TicketsRepository {
  useTicketsStore(): StoreHookResult<TicketWithAttachments[]>
  useTicketCommentsStore(): StoreHookResult<TicketComment[]>
}

export interface ShoppingRepository {
  useShoppingItemsStore(): StoreHookResult<ShoppingItem[]>
}

export interface ApartmentInfoRepository {
  useApartmentInfoStore(): StoreHookResult<ApartmentInfoItem[]>
}

export interface PendingInviteRepository {
  savePendingInviteRecord(invite: PendingInvite): void
  readPendingInviteRecord(): PendingInvite | null
  clearPendingInviteRecord(): void
}
