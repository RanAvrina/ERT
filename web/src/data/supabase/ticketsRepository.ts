import type {
  MaintenanceTicket,
  TicketAttachment,
  TicketCategory,
  TicketComment,
  TicketStatus,
} from '../../types/models'
import type {
  MaintenanceTicketRow,
  TicketAttachmentRow,
  TicketCommentRow,
} from '../../types/database'
import { supabase } from '../../lib/supabase/client'
import { ensureSupabaseResult, ensureValue } from './errors'
import { listMembershipRowsByApartmentId } from './membershipsRepository'

export interface TicketWithAttachments extends MaintenanceTicket {
  attachments: TicketAttachment[]
}

function normalizeTicketStatus(
  status: MaintenanceTicketRow['status'] | 'sent_to_landlord' | 'cancelled',
): TicketStatus {
  if (status === 'sent_to_landlord') return 'in_progress'
  if (status === 'cancelled') return 'closed'
  return status
}

function mapTicketCategoryToDb(category: TicketCategory) {
  switch (category) {
    case 'תקלה':
      return 'issue'
    case 'בקשה':
      return 'request'
    case 'כספים':
      return 'finance'
    default:
      return 'other'
  }
}

function mapDbCategoryToTicket(category: MaintenanceTicketRow['category']): TicketCategory {
  switch (category) {
    case 'issue':
      return 'תקלה'
    case 'request':
      return 'בקשה'
    case 'finance':
      return 'כספים'
    default:
      return 'אחר'
  }
}

async function loadMembershipMaps(apartmentId: number) {
  const rows = await listMembershipRowsByApartmentId(apartmentId)
  return {
    accountToMembership: new Map(rows.map((row) => [row.account_id, row.id])),
    membershipToAccount: new Map(rows.map((row) => [row.id, row.account_id])),
  }
}

function mapAttachmentRow(row: TicketAttachmentRow): TicketAttachment {
  return {
    id: row.id,
    name: row.file_name,
    type: row.file_type,
    size: row.file_size,
    url: row.file_url,
  }
}

function mapTicketRowToModel(
  row: MaintenanceTicketRow,
  attachments: TicketAttachmentRow[],
  membershipToAccount: Map<number, number>,
): TicketWithAttachments {
  return {
    id: row.id,
    apartment_id: row.apartment_id,
    title: row.title,
    description: row.description,
    category: mapDbCategoryToTicket(row.category),
    status: normalizeTicketStatus(row.status),
    created_by: membershipToAccount.get(row.created_by_membership_id) ?? 0,
    created_at: row.created_at,
    attachments: attachments.map(mapAttachmentRow),
  }
}

function mapCommentRowToModel(
  row: TicketCommentRow,
  membershipToAccount: Map<number, number>,
): TicketComment {
  return {
    id: row.id,
    ticket_id: row.ticket_id,
    user_id: membershipToAccount.get(row.membership_id) ?? 0,
    comment_text: row.comment_text,
    created_at: row.created_at,
  }
}

export async function listTicketsByApartmentId(apartmentId: number) {
  const client = ensureValue(supabase, 'Supabase client is not configured.')
  const { membershipToAccount } = await loadMembershipMaps(apartmentId)

  const { data, error } = await client
    .from('maintenance_tickets')
    .select('*')
    .eq('apartment_id', apartmentId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
  ensureSupabaseResult(error, 'Failed to load tickets')

  const rows = (data ?? []) as MaintenanceTicketRow[]
  if (!rows.length) return []

  const ticketIds = rows.map((row) => row.id)
  const { data: attachmentData, error: attachmentError } = await client
    .from('ticket_attachments')
    .select('*')
    .in('ticket_id', ticketIds)
  ensureSupabaseResult(attachmentError, 'Failed to load ticket attachments')

  const attachments = (attachmentData ?? []) as TicketAttachmentRow[]
  return rows.map((row) =>
    mapTicketRowToModel(
      row,
      attachments.filter((attachment) => attachment.ticket_id === row.id),
      membershipToAccount,
    ),
  )
}

export async function listTicketCommentsByApartmentId(apartmentId: number) {
  const client = ensureValue(supabase, 'Supabase client is not configured.')
  const { membershipToAccount } = await loadMembershipMaps(apartmentId)

  const { data: ticketsData, error: ticketsError } = await client
    .from('maintenance_tickets')
    .select('id')
    .eq('apartment_id', apartmentId)
  ensureSupabaseResult(ticketsError, 'Failed to load ticket ids')

  const ticketIds = ((ticketsData ?? []) as Array<{ id: number }>).map((row) => row.id)
  if (!ticketIds.length) return []

  const { data, error } = await client
    .from('ticket_comments')
    .select('*')
    .in('ticket_id', ticketIds)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
  ensureSupabaseResult(error, 'Failed to load ticket comments')

  return ((data ?? []) as TicketCommentRow[]).map((row) =>
    mapCommentRowToModel(row, membershipToAccount),
  )
}

export async function createTicketRecord(input: {
  apartmentId: number
  title: string
  description: string
  category: TicketCategory
  createdByAccountId: number
  attachments: TicketAttachment[]
}) {
  const client = ensureValue(supabase, 'Supabase client is not configured.')
  const { accountToMembership } = await loadMembershipMaps(input.apartmentId)
  const createdByMembershipId = accountToMembership.get(input.createdByAccountId)
  if (!createdByMembershipId) {
    throw new Error('לא נמצא שיוך דייר תקף לפנייה.')
  }

  const { data, error } = await client
    .from('maintenance_tickets')
    .insert({
      apartment_id: input.apartmentId,
      title: input.title,
      description: input.description,
      category: mapTicketCategoryToDb(input.category),
      status: 'open',
      created_by_membership_id: createdByMembershipId,
    })
    .select('*')
    .single()
  ensureSupabaseResult(error, 'Failed to create ticket')

  const ticketRow = data as MaintenanceTicketRow

  if (input.attachments.length) {
    const { error: attachmentsError } = await client.from('ticket_attachments').insert(
      input.attachments.map((attachment) => ({
        id: attachment.id || crypto.randomUUID(),
        ticket_id: ticketRow.id,
        file_name: attachment.name,
        file_type: attachment.type,
        file_size: attachment.size,
        file_url: attachment.url,
      })),
    )
    ensureSupabaseResult(attachmentsError, 'Failed to save ticket attachments')
  }

  const tickets = await listTicketsByApartmentId(input.apartmentId)
  return tickets.find((ticket) => ticket.id === ticketRow.id) ?? null
}

export async function updateTicketRecord(input: {
  apartmentId: number
  ticketId: number
  title: string
  description: string
  category: TicketCategory
}) {
  const client = ensureValue(supabase, 'Supabase client is not configured.')

  const { error } = await client
    .from('maintenance_tickets')
    .update({
      title: input.title,
      description: input.description,
      category: mapTicketCategoryToDb(input.category),
      updated_at: new Date().toISOString(),
    })
    .eq('id', input.ticketId)
  ensureSupabaseResult(error, 'Failed to update ticket')

  const tickets = await listTicketsByApartmentId(input.apartmentId)
  return tickets.find((ticket) => ticket.id === input.ticketId) ?? null
}

export async function updateTicketStatusRecord(input: {
  apartmentId: number
  ticketId: number
  status: TicketStatus
}) {
  const client = ensureValue(supabase, 'Supabase client is not configured.')
  const { error } = await client
    .from('maintenance_tickets')
    .update({
      status: input.status,
      updated_at: new Date().toISOString(),
    })
    .eq('id', input.ticketId)
  ensureSupabaseResult(error, 'Failed to update ticket status')

  const tickets = await listTicketsByApartmentId(input.apartmentId)
  return tickets.find((ticket) => ticket.id === input.ticketId) ?? null
}

export async function deleteTicketRecord(ticketId: number) {
  const client = ensureValue(supabase, 'Supabase client is not configured.')
  const { error } = await client.from('maintenance_tickets').delete().eq('id', ticketId)
  ensureSupabaseResult(error, 'Failed to delete ticket')
}

export async function createTicketCommentRecord(input: {
  apartmentId: number
  ticketId: number
  userId: number
  text: string
}) {
  const client = ensureValue(supabase, 'Supabase client is not configured.')
  const { accountToMembership, membershipToAccount } = await loadMembershipMaps(input.apartmentId)
  const membershipId = accountToMembership.get(input.userId)
  if (!membershipId) {
    throw new Error('לא נמצא שיוך דייר תקף לתגובה.')
  }

  const { data, error } = await client
    .from('ticket_comments')
    .insert({
      ticket_id: input.ticketId,
      membership_id: membershipId,
      comment_text: input.text,
    })
    .select('*')
    .single()
  ensureSupabaseResult(error, 'Failed to create ticket comment')

  return mapCommentRowToModel(data as TicketCommentRow, membershipToAccount)
}
