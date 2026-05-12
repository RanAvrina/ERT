import { randomUUID } from 'node:crypto'
import { ApiError } from '../lib/api-error.js'
import { supabaseAdmin } from '../lib/supabase.js'
import { listActiveMembershipsByApartmentId } from './membership-service.js'

type TicketCategory = 'issue' | 'request' | 'finance' | 'other'
type TicketStatus = 'open' | 'sent_to_landlord' | 'in_progress' | 'closed' | 'cancelled'

interface MaintenanceTicketRow {
  id: number
  apartment_id: number
  title: string
  description: string
  category: TicketCategory
  status: TicketStatus
  created_by_membership_id: number
  created_at: string
  updated_at: string
}

interface TicketCommentRow {
  id: number
  ticket_id: number
  membership_id: number
  comment_text: string
  created_at: string
}

interface TicketAttachmentRow {
  id: string
  ticket_id: number
  file_name: string
  file_type: string
  file_size: number
  file_url: string
}

async function loadMembershipMaps(apartmentId: number) {
  const rows = await listActiveMembershipsByApartmentId(apartmentId)
  return {
    accountToMembership: new Map(rows.map((row) => [row.account_id, row.id])),
    membershipToAccount: new Map(rows.map((row) => [row.id, row.account_id])),
  }
}

function requireMembershipId(map: Map<number, number>, accountId: number, contextLabel: string) {
  const membershipId = map.get(accountId)
  if (!membershipId) {
    throw new ApiError(400, `No active apartment membership was found for ${contextLabel}.`)
  }

  return membershipId
}

function mapAttachment(row: TicketAttachmentRow) {
  return {
    id: row.id,
    name: row.file_name,
    type: row.file_type,
    size: row.file_size,
    url: row.file_url,
  }
}

function mapTicket(
  row: MaintenanceTicketRow,
  attachments: TicketAttachmentRow[],
  membershipToAccount: Map<number, number>,
) {
  return {
    id: row.id,
    apartmentId: row.apartment_id,
    title: row.title,
    description: row.description,
    category: row.category,
    status: row.status,
    createdByAccountId: membershipToAccount.get(row.created_by_membership_id) ?? 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    attachments: attachments.map(mapAttachment),
  }
}

function mapComment(row: TicketCommentRow, membershipToAccount: Map<number, number>) {
  return {
    id: row.id,
    ticketId: row.ticket_id,
    accountId: membershipToAccount.get(row.membership_id) ?? 0,
    text: row.comment_text,
    createdAt: row.created_at,
  }
}

export async function listTicketsByApartmentId(apartmentId: number) {
  const { membershipToAccount } = await loadMembershipMaps(apartmentId)
  const { data, error } = await supabaseAdmin
    .from('maintenance_tickets')
    .select('*')
    .eq('apartment_id', apartmentId)
    .neq('status', 'cancelled')
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })

  if (error) throw new Error(`Failed to load tickets: ${error.message}`)
  const rows = (data ?? []) as MaintenanceTicketRow[]
  if (!rows.length) return []

  const ticketIds = rows.map((row) => row.id)
  const { data: attachmentData, error: attachmentError } = await supabaseAdmin
    .from('ticket_attachments')
    .select('*')
    .in('ticket_id', ticketIds)

  if (attachmentError) throw new Error(`Failed to load ticket attachments: ${attachmentError.message}`)
  const attachments = (attachmentData ?? []) as TicketAttachmentRow[]

  return rows.map((row) =>
    mapTicket(
      row,
      attachments.filter((attachment) => attachment.ticket_id === row.id),
      membershipToAccount,
    ),
  )
}

export async function listTicketCommentsByApartmentId(apartmentId: number) {
  const { membershipToAccount } = await loadMembershipMaps(apartmentId)
  const { data: ticketsData, error: ticketsError } = await supabaseAdmin
    .from('maintenance_tickets')
    .select('id')
    .eq('apartment_id', apartmentId)

  if (ticketsError) throw new Error(`Failed to load ticket ids: ${ticketsError.message}`)
  const ticketIds = ((ticketsData ?? []) as Array<{ id: number }>).map((row) => row.id)
  if (!ticketIds.length) return []

  const { data, error } = await supabaseAdmin
    .from('ticket_comments')
    .select('*')
    .in('ticket_id', ticketIds)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })

  if (error) throw new Error(`Failed to load ticket comments: ${error.message}`)
  return ((data ?? []) as TicketCommentRow[]).map((row) => mapComment(row, membershipToAccount))
}

export async function createTicket(input: {
  apartmentId: number
  title: string
  description: string
  category: TicketCategory
  createdByAccountId: number
  attachments?: Array<{ id?: string; name: string; type: string; size: number; url: string }>
}) {
  const { accountToMembership } = await loadMembershipMaps(input.apartmentId)
  const createdByMembershipId = requireMembershipId(accountToMembership, input.createdByAccountId, 'the ticket creator')

  const { data, error } = await supabaseAdmin
    .from('maintenance_tickets')
    .insert({
      apartment_id: input.apartmentId,
      title: input.title,
      description: input.description,
      category: input.category,
      status: 'open',
      created_by_membership_id: createdByMembershipId,
    })
    .select('*')
    .single()

  if (error) throw new Error(`Failed to create ticket: ${error.message}`)
  const ticketRow = data as MaintenanceTicketRow

  if (input.attachments?.length) {
    const { error: attachmentsError } = await supabaseAdmin.from('ticket_attachments').insert(
      input.attachments.map((attachment) => ({
        id: attachment.id ?? randomUUID(),
        ticket_id: ticketRow.id,
        file_name: attachment.name,
        file_type: attachment.type,
        file_size: attachment.size,
        file_url: attachment.url,
      })),
    )

    if (attachmentsError) throw new Error(`Failed to create ticket attachments: ${attachmentsError.message}`)
  }

  const tickets = await listTicketsByApartmentId(input.apartmentId)
  return tickets.find((ticket) => ticket.id === ticketRow.id) ?? null
}

export async function updateTicket(input: {
  apartmentId: number
  ticketId: number
  title: string
  description: string
  category: TicketCategory
  attachments?: Array<{ id?: string; name: string; type: string; size: number; url: string }>
}) {
  const { error } = await supabaseAdmin
    .from('maintenance_tickets')
    .update({
      title: input.title,
      description: input.description,
      category: input.category,
      updated_at: new Date().toISOString(),
    })
    .eq('id', input.ticketId)

  if (error) throw new Error(`Failed to update ticket: ${error.message}`)

  if (input.attachments) {
    const { error: deleteAttachmentsError } = await supabaseAdmin
      .from('ticket_attachments')
      .delete()
      .eq('ticket_id', input.ticketId)

    if (deleteAttachmentsError) throw new Error(`Failed to reset ticket attachments: ${deleteAttachmentsError.message}`)

    if (input.attachments.length) {
      const { error: attachmentsError } = await supabaseAdmin.from('ticket_attachments').insert(
        input.attachments.map((attachment) => ({
          id: attachment.id ?? randomUUID(),
          ticket_id: input.ticketId,
          file_name: attachment.name,
          file_type: attachment.type,
          file_size: attachment.size,
          file_url: attachment.url,
        })),
      )

      if (attachmentsError) throw new Error(`Failed to save ticket attachments: ${attachmentsError.message}`)
    }
  }

  const tickets = await listTicketsByApartmentId(input.apartmentId)
  return tickets.find((ticket) => ticket.id === input.ticketId) ?? null
}

export async function updateTicketStatus(input: {
  apartmentId: number
  ticketId: number
  status: TicketStatus
}) {
  const { error } = await supabaseAdmin
    .from('maintenance_tickets')
    .update({
      status: input.status,
      updated_at: new Date().toISOString(),
    })
    .eq('id', input.ticketId)

  if (error) throw new Error(`Failed to update ticket status: ${error.message}`)
  const tickets = await listTicketsByApartmentId(input.apartmentId)
  return tickets.find((ticket) => ticket.id === input.ticketId) ?? null
}

export async function deleteTicket(ticketId: number) {
  const { error } = await supabaseAdmin.from('maintenance_tickets').delete().eq('id', ticketId)
  if (error) throw new Error(`Failed to delete ticket: ${error.message}`)
}

export async function createTicketComment(input: {
  apartmentId: number
  ticketId: number
  accountId: number
  text: string
}) {
  const { accountToMembership, membershipToAccount } = await loadMembershipMaps(input.apartmentId)
  const membershipId = requireMembershipId(accountToMembership, input.accountId, 'the comment author')

  const { data, error } = await supabaseAdmin
    .from('ticket_comments')
    .insert({
      ticket_id: input.ticketId,
      membership_id: membershipId,
      comment_text: input.text,
    })
    .select('*')
    .single()

  if (error) throw new Error(`Failed to create ticket comment: ${error.message}`)
  return mapComment(data as TicketCommentRow, membershipToAccount)
}
