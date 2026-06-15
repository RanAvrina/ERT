/* eslint-disable react-refresh/only-export-components */
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  type ReactNode,
} from 'react'
import {
  useTicketCommentsStore,
  useTicketsStore,
} from '../data/repositories/ticketsRepository'
import {
  createTicketCommentViaApi,
  createTicketViaApi,
  deleteTicketViaApi,
  listTicketsViaApi,
  updateTicketStatusViaApi,
  updateTicketViaApi,
  type TicketWithAttachments as TicketWithAttachmentsApi,
} from '../data/server/ticketsApi'
import type { TicketWithAttachments } from '../data/supabase/ticketsRepository'
import { isSupabaseConfigured } from '../lib/supabase/env'
import { useApartment } from './ApartmentContext'
import type {
  TicketAttachment as TicketAttachmentModel,
  TicketCategory,
  TicketComment,
  TicketStatus,
} from '../types/models'

const ASSISTANT_DATA_CHANGED_EVENT = 'assistant:data-changed'

export type TicketAttachment = TicketAttachmentModel

interface NewTicketInput {
  title: string
  description: string
  category: TicketCategory
  createdBy: number
  apartmentId: number
  attachments: TicketAttachment[]
}

interface UpdateTicketInput {
  title: string
  description: string
  category: TicketCategory
}

interface TicketsContextValue {
  tickets: TicketWithAttachmentsApi[]
  comments: TicketComment[]
  addTicket: (ticket: NewTicketInput) => Promise<TicketWithAttachmentsApi | null>
  updateTicket: (
    ticketId: number,
    ticket: UpdateTicketInput,
  ) => Promise<TicketWithAttachmentsApi | null>
  deleteTicket: (ticketId: number) => Promise<void>
  addComment: (ticketId: number, userId: number, text: string) => Promise<TicketComment>
  updateTicketStatus: (
    ticketId: number,
    status: TicketStatus,
  ) => Promise<TicketWithAttachmentsApi | null>
  getTicketById: (id: string | number | undefined) => TicketWithAttachmentsApi | undefined
  getCommentsByTicketId: (ticketId: number) => TicketComment[]
}

const TicketsContext = createContext<TicketsContextValue | null>(null)

export function TicketsProvider({ children }: { children: ReactNode }) {
  const { current } = useApartment()
  const [tickets, setTickets] = useTicketsStore()
  const [comments, setComments] = useTicketCommentsStore()
  const nextTicketId = useRef(Math.max(...tickets.map((ticket) => ticket.id), 0) + 1)
  const nextCommentId = useRef(Math.max(...comments.map((comment) => comment.id), 0) + 1)
  const nextTempTicketId = useRef(-1)
  const nextTempCommentId = useRef(-1)
  const loadedApartmentIdRef = useRef<number | null>(null)

  useEffect(() => {
    let cancelled = false

    async function loadApartmentTickets() {
      if (!isSupabaseConfigured || !current?.apartment.id) return
      if (loadedApartmentIdRef.current === current.apartment.id) return

      try {
        const { tickets: nextTickets, comments: nextComments } = await listTicketsViaApi(
          current.apartment.id,
        )

        if (!cancelled) {
          setTickets(nextTickets)
          setComments(nextComments)
          nextTicketId.current = Math.max(...nextTickets.map((ticket) => ticket.id), 0) + 1
          nextCommentId.current = Math.max(...nextComments.map((comment) => comment.id), 0) + 1
          loadedApartmentIdRef.current = current.apartment.id
        }
      } catch {
        if (!cancelled) {
          setTickets([])
          setComments([])
          loadedApartmentIdRef.current = null
        }
      }
    }

    void loadApartmentTickets()

    return () => {
      cancelled = true
    }
  }, [current?.apartment.id, setComments, setTickets])

  useEffect(() => {
    const apartmentId: number | null = current?.apartment.id ?? null
    if (!isSupabaseConfigured || !apartmentId) return
    const resolvedApartmentId = apartmentId

    async function refreshTickets() {
      try {
        const { tickets: nextTickets, comments: nextComments } = await listTicketsViaApi(
          resolvedApartmentId,
        )
        setTickets(nextTickets)
        setComments(nextComments)
        nextTicketId.current = Math.max(...nextTickets.map((ticket) => ticket.id), 0) + 1
        nextCommentId.current = Math.max(...nextComments.map((comment) => comment.id), 0) + 1
        loadedApartmentIdRef.current = resolvedApartmentId
      } catch (error) {
        console.error('Failed to refresh tickets after assistant action.', error)
      }
    }

    function handleAssistantDataChanged(event: Event) {
      const customEvent = event as CustomEvent<{ apartmentId?: number }>
      if (customEvent.detail?.apartmentId !== resolvedApartmentId) return
      void refreshTickets()
    }

    window.addEventListener(ASSISTANT_DATA_CHANGED_EVENT, handleAssistantDataChanged)
    return () => {
      window.removeEventListener(ASSISTANT_DATA_CHANGED_EVENT, handleAssistantDataChanged)
    }
  }, [current?.apartment.id, setComments, setTickets])

  async function addTicket(input: NewTicketInput) {
    if (isSupabaseConfigured) {
      const optimisticTicket: TicketWithAttachmentsApi = {
        id: nextTempTicketId.current,
        apartment_id: input.apartmentId,
        title: input.title,
        description: input.description,
        category: input.category,
        status: 'open',
        created_by: input.createdBy,
        created_at: new Date().toISOString(),
        attachments: input.attachments,
      }
      nextTempTicketId.current -= 1

      setTickets((currentTickets) => [optimisticTicket, ...currentTickets])

      void createTicketViaApi({
        apartmentId: input.apartmentId,
        title: input.title,
        description: input.description,
        category: input.category,
        attachments: input.attachments,
      })
        .then((ticket) => {
          if (!ticket) {
            setTickets((currentTickets) =>
              currentTickets.filter((item) => item.id !== optimisticTicket.id),
            )
            return
          }

          setTickets((currentTickets) =>
            currentTickets.map((item) => (item.id === optimisticTicket.id ? ticket : item)),
          )
        })
        .catch((error) => {
          console.error('Failed to create ticket.', error)
          setTickets((currentTickets) =>
            currentTickets.filter((item) => item.id !== optimisticTicket.id),
          )
        })

      return optimisticTicket
    }

    const ticket: TicketWithAttachments = {
      id: nextTicketId.current,
      apartment_id: input.apartmentId,
      title: input.title,
      description: input.description,
      category: input.category,
      status: 'open',
      created_by: input.createdBy,
      created_at: new Date().toISOString(),
      attachments: input.attachments,
    }

    nextTicketId.current += 1
    setTickets((currentTickets) => [ticket, ...currentTickets])
    return ticket
  }

  async function addComment(ticketId: number, userId: number, text: string) {
    if (isSupabaseConfigured) {
      const optimisticComment: TicketComment = {
        id: nextTempCommentId.current,
        ticket_id: ticketId,
        user_id: userId,
        comment_text: text.trim(),
        created_at: new Date().toISOString(),
      }
      nextTempCommentId.current -= 1

      setComments((currentComments) => [optimisticComment, ...currentComments])

      const apartmentId = current?.apartment.id ?? 0
      void createTicketCommentViaApi({
        apartmentId,
        ticketId,
        text: text.trim(),
      })
        .then((created) => {
          setComments((currentComments) =>
            currentComments.map((item) => (item.id === optimisticComment.id ? created : item)),
          )
        })
        .catch((error) => {
          console.error('Failed to create ticket comment.', error)
          setComments((currentComments) =>
            currentComments.filter((item) => item.id !== optimisticComment.id),
          )
        })
      return optimisticComment
    }

    const created: TicketComment = {
      id: nextCommentId.current,
      ticket_id: ticketId,
      user_id: userId,
      comment_text: text.trim(),
      created_at: new Date().toISOString(),
    }
    nextCommentId.current += 1
    setComments((currentComments) => [created, ...currentComments])
    return created
  }

  async function updateTicket(ticketId: number, input: UpdateTicketInput) {
    if (isSupabaseConfigured) {
      const apartmentId = current?.apartment.id ?? 0
      const currentTicket = tickets.find((ticket) => ticket.id === ticketId)
      if (!currentTicket) return null

      const optimisticTicket: TicketWithAttachmentsApi = {
        ...currentTicket,
        title: input.title,
        description: input.description,
        category: input.category,
      }

      setTickets((currentTickets) =>
        currentTickets.map((ticket) => (ticket.id === ticketId ? optimisticTicket : ticket)),
      )

      void updateTicketViaApi({
        apartmentId,
        ticketId,
        title: input.title,
        description: input.description,
        category: input.category,
        attachments: currentTicket?.attachments,
      })
        .then((updatedTicket) => {
          if (!updatedTicket) {
            setTickets((currentTickets) =>
              currentTickets.map((ticket) => (ticket.id === ticketId ? currentTicket : ticket)),
            )
            return
          }

          setTickets((currentTickets) =>
            currentTickets.map((ticket) => (ticket.id === ticketId ? updatedTicket : ticket)),
          )
        })
        .catch((error) => {
          console.error('Failed to update ticket.', error)
          setTickets((currentTickets) =>
            currentTickets.map((ticket) => (ticket.id === ticketId ? currentTicket : ticket)),
          )
        })
      return optimisticTicket
    }

    let updatedTicket: TicketWithAttachments | null = null

    setTickets((currentTickets) =>
      currentTickets.map((ticket) => {
        if (ticket.id !== ticketId) return ticket
        updatedTicket = {
          ...ticket,
          title: input.title,
          description: input.description,
          category: input.category,
        }
        return updatedTicket
      }),
    )

    return updatedTicket
  }

  async function deleteTicket(ticketId: number) {
    const previousTicket = tickets.find((ticket) => ticket.id === ticketId)
    const previousComments = comments.filter((comment) => comment.ticket_id === ticketId)
    if (isSupabaseConfigured) {
      const apartmentId = current?.apartment.id ?? 0
      setTickets((currentTickets) => currentTickets.filter((ticket) => ticket.id !== ticketId))
      setComments((currentComments) =>
        currentComments.filter((comment) => comment.ticket_id !== ticketId),
      )

      try {
        await deleteTicketViaApi(apartmentId, ticketId)
        return
      } catch (error) {
        console.error('Failed to delete ticket.', error)
        if (previousTicket) {
          setTickets((currentTickets) => [previousTicket, ...currentTickets])
        }
        if (previousComments.length > 0) {
          setComments((currentComments) => [...previousComments, ...currentComments])
        }
        throw error
      }
    }

    setTickets((currentTickets) => currentTickets.filter((ticket) => ticket.id !== ticketId))
    setComments((currentComments) =>
      currentComments.filter((comment) => comment.ticket_id !== ticketId),
    )
  }

  async function updateTicketStatus(ticketId: number, status: TicketStatus) {
    if (isSupabaseConfigured) {
      const currentTicket = tickets.find((ticket) => ticket.id === ticketId)
      if (!currentTicket) return null

      const optimisticTicket: TicketWithAttachmentsApi = { ...currentTicket, status }
      setTickets((currentTickets) =>
        currentTickets.map((ticket) => (ticket.id === ticketId ? optimisticTicket : ticket)),
      )

      const apartmentId = current?.apartment.id ?? 0
      void updateTicketStatusViaApi({
        apartmentId,
        ticketId,
        status,
      })
        .then((updatedTicket) => {
          if (!updatedTicket) {
            setTickets((currentTickets) =>
              currentTickets.map((ticket) => (ticket.id === ticketId ? currentTicket : ticket)),
            )
            return
          }

          setTickets((currentTickets) =>
            currentTickets.map((ticket) => (ticket.id === ticketId ? updatedTicket : ticket)),
          )
        })
        .catch((error) => {
          console.error('Failed to update ticket status.', error)
          setTickets((currentTickets) =>
            currentTickets.map((ticket) => (ticket.id === ticketId ? currentTicket : ticket)),
          )
        })
      return optimisticTicket
    }

    let updatedTicket: TicketWithAttachments | null = null
    setTickets((currentTickets) =>
      currentTickets.map((ticket) => {
        if (ticket.id !== ticketId) return ticket
        updatedTicket = { ...ticket, status }
        return updatedTicket
      }),
    )
    return updatedTicket
  }

  function getTicketById(id: string | number | undefined) {
    return tickets.find((ticket) => String(ticket.id) === String(id))
  }

  function getCommentsByTicketId(ticketId: number) {
    return comments.filter((comment) => comment.ticket_id === ticketId)
  }

  const value: TicketsContextValue = {
    tickets,
    comments,
    addTicket,
    updateTicket,
    deleteTicket,
    addComment,
    updateTicketStatus,
    getTicketById,
    getCommentsByTicketId,
  }

  return <TicketsContext.Provider value={value}>{children}</TicketsContext.Provider>
}

export function useTickets() {
  const context = useContext(TicketsContext)
  if (!context) {
    throw new Error('useTickets must be used within TicketsProvider')
  }
  return context
}
