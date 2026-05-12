import type { TicketsRepository } from '../contracts/repositories'
import type { TicketComment } from '../../types/models'
import type { TicketWithAttachments } from '../../data/supabase/ticketsRepository'
import { useMemoryValue } from '../persistence/useMemoryValue'

const ticketsRepository: TicketsRepository = {
  useTicketsStore() {
    return useMemoryValue<TicketWithAttachments[]>([])
  },

  useTicketCommentsStore() {
    return useMemoryValue<TicketComment[]>([])
  },
}

export function useTicketsStore() {
  return ticketsRepository.useTicketsStore()
}

export function useTicketCommentsStore() {
  return ticketsRepository.useTicketCommentsStore()
}
