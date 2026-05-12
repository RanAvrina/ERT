import { apiRequest } from '../../lib/api/client'
import type {
  MaintenanceTicket,
  TicketAttachment,
  TicketCategory,
  TicketComment,
  TicketStatus,
} from '../../types/models'

export interface TicketWithAttachments extends MaintenanceTicket {
  attachments: TicketAttachment[]
}

interface TicketAttachmentApiResponse {
  id: string
  name: string
  type: string
  size: number
  url: string
}

interface TicketApiResponse {
  id: number
  apartmentId: number
  title: string
  description: string
  category: 'issue' | 'request' | 'finance' | 'other'
  status: TicketStatus
  createdByAccountId: number
  createdAt: string
  attachments: TicketAttachmentApiResponse[]
}

interface TicketCommentApiResponse {
  id: number
  ticketId: number
  accountId: number
  text: string
  createdAt: string
}

function mapTicketCategoryFromApi(category: TicketApiResponse['category']): TicketCategory {
  switch (category) {
    case 'issue':
      return '×ª×§×œ×”' as TicketCategory
    case 'request':
      return '×‘×§×©×”' as TicketCategory
    case 'finance':
      return '×›×¡×¤×™×' as TicketCategory
    default:
      return '××—×¨' as TicketCategory
  }
}

function mapTicketCategoryToApi(category: TicketCategory): TicketApiResponse['category'] {
  switch (category) {
    case '×ª×§×œ×”' as TicketCategory:
      return 'issue'
    case '×‘×§×©×”' as TicketCategory:
      return 'request'
    case '×›×¡×¤×™×' as TicketCategory:
      return 'finance'
    default:
      return 'other'
  }
}

function mapTicket(ticket: TicketApiResponse): TicketWithAttachments {
  return {
    id: ticket.id,
    apartment_id: ticket.apartmentId,
    title: ticket.title,
    description: ticket.description,
    category: mapTicketCategoryFromApi(ticket.category),
    status: ticket.status,
    created_by: ticket.createdByAccountId,
    created_at: ticket.createdAt,
    attachments: ticket.attachments,
  }
}

function mapComment(comment: TicketCommentApiResponse): TicketComment {
  return {
    id: comment.id,
    ticket_id: comment.ticketId,
    user_id: comment.accountId,
    comment_text: comment.text,
    created_at: comment.createdAt,
  }
}

export async function listTicketsViaApi(apartmentId: number) {
  return apiRequest<{ tickets: TicketApiResponse[]; comments: TicketCommentApiResponse[] }>(
    `/apartments/${apartmentId}/tickets`,
    {
      method: 'GET',
    },
  ).then((response) => ({
    tickets: response.tickets.map(mapTicket),
    comments: response.comments.map(mapComment),
  }))
}

export async function createTicketViaApi(input: {
  apartmentId: number
  title: string
  description: string
  category: TicketCategory
  attachments: TicketAttachment[]
}) {
  return apiRequest<{ ticket: TicketApiResponse | null }>(`/apartments/${input.apartmentId}/tickets`, {
    method: 'POST',
    body: JSON.stringify({
      title: input.title,
      description: input.description,
      category: mapTicketCategoryToApi(input.category),
      attachments: input.attachments,
    }),
  }).then((response) => (response.ticket ? mapTicket(response.ticket) : null))
}

export async function updateTicketViaApi(input: {
  apartmentId: number
  ticketId: number
  title: string
  description: string
  category: TicketCategory
  attachments?: TicketAttachment[]
}) {
  return apiRequest<{ ticket: TicketApiResponse | null }>(
    `/apartments/${input.apartmentId}/tickets/${input.ticketId}`,
    {
      method: 'PUT',
      body: JSON.stringify({
        title: input.title,
        description: input.description,
        category: mapTicketCategoryToApi(input.category),
        attachments: input.attachments,
      }),
    },
  ).then((response) => (response.ticket ? mapTicket(response.ticket) : null))
}

export async function updateTicketStatusViaApi(input: {
  apartmentId: number
  ticketId: number
  status: TicketStatus
}) {
  return apiRequest<{ ticket: TicketApiResponse | null }>(
    `/apartments/${input.apartmentId}/tickets/${input.ticketId}/status`,
    {
      method: 'PATCH',
      body: JSON.stringify({ status: input.status }),
    },
  ).then((response) => (response.ticket ? mapTicket(response.ticket) : null))
}

export async function createTicketCommentViaApi(input: {
  apartmentId: number
  ticketId: number
  text: string
}) {
  return apiRequest<{ comment: TicketCommentApiResponse }>(
    `/apartments/${input.apartmentId}/tickets/${input.ticketId}/comments`,
    {
      method: 'POST',
      body: JSON.stringify({ text: input.text }),
    },
  ).then((response) => mapComment(response.comment))
}

export async function deleteTicketViaApi(apartmentId: number, ticketId: number) {
  return apiRequest<null>(`/apartments/${apartmentId}/tickets/${ticketId}`, {
    method: 'DELETE',
  })
}
