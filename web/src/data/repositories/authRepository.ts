import type {
  AccountsRepository,
  AuthSessionRepository,
} from '../contracts/repositories'
import type { AccountIdentity } from '../../types/auth'
import type { User } from '../../types/models'
import { useMemoryValue } from '../persistence/useMemoryValue'

const authRepository: AccountsRepository & AuthSessionRepository = {
  useAccountsStore() {
    return useMemoryValue<AccountIdentity[]>([])
  },

  useAuthSessionStore() {
    return useMemoryValue<User | null>(null)
  },
}

export function useAccountsStore() {
  return authRepository.useAccountsStore()
}

export function useAuthSessionStore() {
  return authRepository.useAuthSessionStore()
}
