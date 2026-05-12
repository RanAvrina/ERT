import { randomUUID } from 'node:crypto'
import { supabaseAdmin } from '../lib/supabase.js'

interface ApartmentInfoItemRow {
  id: number
  apartment_id: number
  title: string
  category_label: string | null
  provider: string | null
  meter_number: string | null
  account_number: string | null
  phone: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

interface ApartmentInfoAttachmentRow {
  id: string
  apartment_info_item_id: number
  file_name: string
  file_type: string
  file_size: number
  file_url: string
}

function mapAttachment(row: ApartmentInfoAttachmentRow) {
  return {
    id: row.id,
    name: row.file_name,
    type: row.file_type,
    size: row.file_size,
    url: row.file_url,
  }
}

function mapApartmentInfoItem(row: ApartmentInfoItemRow, attachments: ApartmentInfoAttachmentRow[]) {
  return {
    id: row.id,
    apartmentId: row.apartment_id,
    title: row.title,
    categoryLabel: row.category_label,
    provider: row.provider,
    meterNumber: row.meter_number,
    accountNumber: row.account_number,
    phone: row.phone,
    notes: row.notes,
    attachments: attachments.map(mapAttachment),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export async function listApartmentInfoItemsByApartmentId(apartmentId: number) {
  const { data, error } = await supabaseAdmin
    .from('apartment_info_items')
    .select('*')
    .eq('apartment_id', apartmentId)
    .order('updated_at', { ascending: false })
    .order('id', { ascending: false })

  if (error) throw new Error(`Failed to load apartment info: ${error.message}`)

  const rows = (data ?? []) as ApartmentInfoItemRow[]
  if (!rows.length) return []

  const itemIds = rows.map((row) => row.id)
  const { data: attachmentsData, error: attachmentsError } = await supabaseAdmin
    .from('apartment_info_attachments')
    .select('*')
    .in('apartment_info_item_id', itemIds)

  if (attachmentsError) throw new Error(`Failed to load apartment info attachments: ${attachmentsError.message}`)
  const attachments = (attachmentsData ?? []) as ApartmentInfoAttachmentRow[]

  return rows.map((row) =>
    mapApartmentInfoItem(
      row,
      attachments.filter((attachment) => attachment.apartment_info_item_id === row.id),
    ),
  )
}

export async function createApartmentInfoItem(input: {
  apartmentId: number
  title: string
  categoryLabel: string | null
  provider: string | null
  meterNumber: string | null
  accountNumber: string | null
  phone: string | null
  notes: string | null
  attachments?: Array<{ id?: string; name: string; type: string; size: number; url: string }>
}) {
  const { data, error } = await supabaseAdmin
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

  if (error) throw new Error(`Failed to create apartment info item: ${error.message}`)
  const itemRow = data as ApartmentInfoItemRow

  if (input.attachments?.length) {
    const { error: attachmentsError } = await supabaseAdmin.from('apartment_info_attachments').insert(
      input.attachments.map((attachment) => ({
        id: attachment.id ?? randomUUID(),
        apartment_info_item_id: itemRow.id,
        file_name: attachment.name,
        file_type: attachment.type,
        file_size: attachment.size,
        file_url: attachment.url,
      })),
    )

    if (attachmentsError) throw new Error(`Failed to create apartment info attachments: ${attachmentsError.message}`)
  }

  const items = await listApartmentInfoItemsByApartmentId(input.apartmentId)
  return items.find((item) => item.id === itemRow.id) ?? null
}

export async function updateApartmentInfoItem(input: {
  apartmentId: number
  itemId: number
  title: string
  categoryLabel: string | null
  provider: string | null
  meterNumber: string | null
  accountNumber: string | null
  phone: string | null
  notes: string | null
  attachments?: Array<{ id?: string; name: string; type: string; size: number; url: string }>
}) {
  const { error } = await supabaseAdmin
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

  if (error) throw new Error(`Failed to update apartment info item: ${error.message}`)

  if (input.attachments) {
    const { error: deleteAttachmentsError } = await supabaseAdmin
      .from('apartment_info_attachments')
      .delete()
      .eq('apartment_info_item_id', input.itemId)

    if (deleteAttachmentsError) throw new Error(`Failed to reset apartment info attachments: ${deleteAttachmentsError.message}`)

    if (input.attachments.length) {
      const { error: attachmentsError } = await supabaseAdmin.from('apartment_info_attachments').insert(
        input.attachments.map((attachment) => ({
          id: attachment.id ?? randomUUID(),
          apartment_info_item_id: input.itemId,
          file_name: attachment.name,
          file_type: attachment.type,
          file_size: attachment.size,
          file_url: attachment.url,
        })),
      )

      if (attachmentsError) throw new Error(`Failed to save apartment info attachments: ${attachmentsError.message}`)
    }
  }

  const items = await listApartmentInfoItemsByApartmentId(input.apartmentId)
  return items.find((item) => item.id === input.itemId) ?? null
}

export async function deleteApartmentInfoItem(itemId: number) {
  const { error } = await supabaseAdmin.from('apartment_info_items').delete().eq('id', itemId)
  if (error) throw new Error(`Failed to delete apartment info item: ${error.message}`)
}
