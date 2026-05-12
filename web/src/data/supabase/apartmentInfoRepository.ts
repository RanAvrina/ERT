import type {
  ApartmentInfoAttachment,
  ApartmentInfoItem,
} from '../../types/models'
import type {
  ApartmentInfoAttachmentRow,
  ApartmentInfoItemRow,
} from '../../types/database'
import { supabase } from '../../lib/supabase/client'
import { ensureSupabaseResult, ensureValue } from './errors'

function mapAttachmentRow(row: ApartmentInfoAttachmentRow): ApartmentInfoAttachment {
  return {
    id: row.id,
    name: row.file_name,
    type: row.file_type,
    size: row.file_size,
    url: row.file_url,
  }
}

function mapItemRowToModel(
  row: ApartmentInfoItemRow,
  attachments: ApartmentInfoAttachmentRow[],
): ApartmentInfoItem {
  return {
    id: row.id,
    apartment_id: row.apartment_id,
    title: row.title,
    category_label: row.category_label,
    provider: row.provider,
    meter_number: row.meter_number,
    account_number: row.account_number,
    phone: row.phone,
    notes: row.notes,
    attachments: attachments.map(mapAttachmentRow),
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

export async function listApartmentInfoItemsByApartmentId(apartmentId: number) {
  const client = ensureValue(supabase, 'Supabase client is not configured.')

  const { data, error } = await client
    .from('apartment_info_items')
    .select('*')
    .eq('apartment_id', apartmentId)
    .order('updated_at', { ascending: false })
    .order('id', { ascending: false })
  ensureSupabaseResult(error, 'Failed to load apartment info')

  const rows = (data ?? []) as ApartmentInfoItemRow[]
  if (!rows.length) return []

  const itemIds = rows.map((row) => row.id)
  const { data: attachmentData, error: attachmentError } = await client
    .from('apartment_info_attachments')
    .select('*')
    .in('apartment_info_item_id', itemIds)
  ensureSupabaseResult(attachmentError, 'Failed to load apartment info attachments')

  const attachments = (attachmentData ?? []) as ApartmentInfoAttachmentRow[]

  return rows.map((row) =>
    mapItemRowToModel(
      row,
      attachments.filter((attachment) => attachment.apartment_info_item_id === row.id),
    ),
  )
}

export async function createApartmentInfoItemRecord(input: {
  apartmentId: number
  title: string
  categoryLabel: string | null
  provider: string | null
  meterNumber: string | null
  accountNumber: string | null
  phone: string | null
  notes: string | null
  attachments: ApartmentInfoAttachment[]
}) {
  const client = ensureValue(supabase, 'Supabase client is not configured.')
  const { data, error } = await client
    .from('apartment_info_items')
    .insert({
      apartment_id: input.apartmentId,
      title: input.title,
      category_label: input.categoryLabel,
      provider: input.provider,
      meter_number: input.meterNumber,
      account_number: input.accountNumber,
      phone: input.phone,
      notes: input.notes,
    })
    .select('*')
    .single()
  ensureSupabaseResult(error, 'Failed to create apartment info item')

  const itemRow = data as ApartmentInfoItemRow

  if (input.attachments.length) {
    const { error: attachmentsError } = await client.from('apartment_info_attachments').insert(
      input.attachments.map((attachment) => ({
        id: attachment.id || crypto.randomUUID(),
        apartment_info_item_id: itemRow.id,
        file_name: attachment.name,
        file_type: attachment.type,
        file_size: attachment.size,
        file_url: attachment.url,
      })),
    )
    ensureSupabaseResult(attachmentsError, 'Failed to save apartment info attachments')
  }

  const items = await listApartmentInfoItemsByApartmentId(input.apartmentId)
  return items.find((item) => item.id === itemRow.id) ?? null
}

export async function updateApartmentInfoItemRecord(input: {
  apartmentId: number
  itemId: number
  title: string
  categoryLabel: string | null
  provider: string | null
  meterNumber: string | null
  accountNumber: string | null
  phone: string | null
  notes: string | null
  attachments: ApartmentInfoAttachment[]
}) {
  const client = ensureValue(supabase, 'Supabase client is not configured.')
  const { error } = await client
    .from('apartment_info_items')
    .update({
      title: input.title,
      category_label: input.categoryLabel,
      provider: input.provider,
      meter_number: input.meterNumber,
      account_number: input.accountNumber,
      phone: input.phone,
      notes: input.notes,
      updated_at: new Date().toISOString(),
    })
    .eq('id', input.itemId)
  ensureSupabaseResult(error, 'Failed to update apartment info item')

  const { error: deleteAttachmentsError } = await client
    .from('apartment_info_attachments')
    .delete()
    .eq('apartment_info_item_id', input.itemId)
  ensureSupabaseResult(deleteAttachmentsError, 'Failed to reset apartment info attachments')

  if (input.attachments.length) {
    const { error: attachmentsError } = await client.from('apartment_info_attachments').insert(
      input.attachments.map((attachment) => ({
        id: attachment.id || crypto.randomUUID(),
        apartment_info_item_id: input.itemId,
        file_name: attachment.name,
        file_type: attachment.type,
        file_size: attachment.size,
        file_url: attachment.url,
      })),
    )
    ensureSupabaseResult(attachmentsError, 'Failed to save apartment info attachments')
  }

  const items = await listApartmentInfoItemsByApartmentId(input.apartmentId)
  return items.find((item) => item.id === input.itemId) ?? null
}

export async function deleteApartmentInfoItemRecord(itemId: number) {
  const client = ensureValue(supabase, 'Supabase client is not configured.')
  const { error } = await client.from('apartment_info_items').delete().eq('id', itemId)
  ensureSupabaseResult(error, 'Failed to delete apartment info item')
}
