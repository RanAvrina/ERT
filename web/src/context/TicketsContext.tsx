/* eslint-disable react-refresh/only-export-components */
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
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

  async function addTicket(input: NewTicketInput) {
    if (isSupabaseConfigured) {
      const ticket = await createTicketViaApi({
        apartmentId: input.apartmentId,
        title: input.title,
        description: input.description,
        category: input.category,
        attachments: input.attachments,
      })

      if (!ticket) return null
      setTickets((currentTickets) => [
        ticket,
        ...currentTickets.filter((item) => item.id !== ticket.id),
      ])
      return ticket
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
      const apartmentId = current?.apartment.id ?? 0
      const created = await createTicketCommentViaApi({
        apartmentId,
        ticketId,
        text: text.trim(),
      })
      setComments((currentComments) => [
        created,
        ...currentComments.filter((item) => item.id !== created.id),
      ])
      return created
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
      const updatedTicket = await updateTicketViaApi({
        apartmentId,
        ticketId,
        title: input.title,
        description: input.description,
        category: input.category,
        attachments: currentTicket?.attachments,
      })

      if (!updatedTicket) return null
      setTickets((currentTickets) =>
        currentTickets.map((ticket) => (ticket.id === ticketId ? updatedTicket : ticket)),
      )
      return updatedTicket
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
    if (isSupabaseConfigured) {
      const apartmentId = current?.apartment.id ?? 0
      await deleteTicketViaApi(apartmentId, ticketId)
    }

    setTickets((currentTickets) => currentTickets.filter((ticket) => ticket.id !== ticketId))
    setComments((currentComments) =>
      currentComments.filter((comment) => comment.ticket_id !== ticketId),
    )
  }

  async function updateTicketStatus(ticketId: number, status: TicketStatus) {
    if (isSupabaseConfigured) {
      const apartmentId = current?.apartment.id ?? 0
      const updatedTicket = await updateTicketStatusViaApi({
        apartmentId,
        ticketId,
        status,
      })

      if (!updatedTicket) return null
      setTickets((currentTickets) =>
        currentTickets.map((ticket) => (ticket.id === ticketId ? updatedTicket : ticket)),
      )
      return updatedTicket
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

  const value = useMemo(
    () => ({
      tickets,
      comments,
      addTicket,
      updateTicket,
      deleteTicket,
      addComment,
      updateTicketStatus,
      getTicketById,
      getCommentsByTicketId,
    }),
    [tickets, comments],
  )

  return <TicketsContext.Provider value={value}>{children}</TicketsContext.Provider>
}

export function useTickets() {
  const context = useContext(TicketsContext)
  if (!context) {
    throw new Error('useTickets must be used within TicketsProvider')
  }
  return context
}
