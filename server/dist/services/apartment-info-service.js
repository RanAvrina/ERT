import { randomUUID } from 'node:crypto';
import { supabaseAdmin } from '../lib/supabase.js';
function toUuid(id) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id ?? '')
        ? id
        : randomUUID();
}
function mapAttachment(row) {
    return {
        id: row.id,
        name: row.file_name,
        type: row.file_type,
        size: row.file_size,
        url: row.file_url,
    };
}
function mapApartmentInfoItem(row, attachments) {
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
    };
}
export async function listApartmentInfoItemsByApartmentId(apartmentId) {
    const { data, error } = await supabaseAdmin
        .from('apartment_info_items')
        .select('*')
        .eq('apartment_id', apartmentId)
        .order('updated_at', { ascending: false })
        .order('id', { ascending: false });
    if (error)
        throw new Error(`Failed to load apartment info: ${error.message}`);
    const rows = (data ?? []);
    if (!rows.length)
        return [];
    const itemIds = rows.map((row) => row.id);
    const { data: attachmentsData, error: attachmentsError } = await supabaseAdmin
        .from('apartment_info_attachments')
        .select('*')
        .in('apartment_info_item_id', itemIds);
    if (attachmentsError)
        throw new Error(`Failed to load apartment info attachments: ${attachmentsError.message}`);
    const attachments = (attachmentsData ?? []);
    return rows.map((row) => mapApartmentInfoItem(row, attachments.filter((attachment) => attachment.apartment_info_item_id === row.id)));
}
export async function createApartmentInfoItem(input) {
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
        .single();
    if (error)
        throw new Error(`Failed to create apartment info item: ${error.message}`);
    const itemRow = data;
    if (input.attachments?.length) {
        const { error: attachmentsError } = await supabaseAdmin.from('apartment_info_attachments').insert(input.attachments.map((attachment) => ({
            id: toUuid(attachment.id),
            apartment_info_item_id: itemRow.id,
            file_name: attachment.name,
            file_type: attachment.type,
            file_size: attachment.size,
            file_url: attachment.url,
        })));
        if (attachmentsError)
            throw new Error(`Failed to create apartment info attachments: ${attachmentsError.message}`);
    }
    const items = await listApartmentInfoItemsByApartmentId(input.apartmentId);
    return items.find((item) => item.id === itemRow.id) ?? null;
}
export async function updateApartmentInfoItem(input) {
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
        .eq('id', input.itemId);
    if (error)
        throw new Error(`Failed to update apartment info item: ${error.message}`);
    if (input.attachments) {
        const { error: deleteAttachmentsError } = await supabaseAdmin
            .from('apartment_info_attachments')
            .delete()
            .eq('apartment_info_item_id', input.itemId);
        if (deleteAttachmentsError)
            throw new Error(`Failed to reset apartment info attachments: ${deleteAttachmentsError.message}`);
        if (input.attachments.length) {
            const { error: attachmentsError } = await supabaseAdmin.from('apartment_info_attachments').insert(input.attachments.map((attachment) => ({
                id: toUuid(attachment.id),
                apartment_info_item_id: input.itemId,
                file_name: attachment.name,
                file_type: attachment.type,
                file_size: attachment.size,
                file_url: attachment.url,
            })));
            if (attachmentsError)
                throw new Error(`Failed to save apartment info attachments: ${attachmentsError.message}`);
        }
    }
    const items = await listApartmentInfoItemsByApartmentId(input.apartmentId);
    return items.find((item) => item.id === input.itemId) ?? null;
}
export async function deleteApartmentInfoItem(itemId) {
    const { error } = await supabaseAdmin.from('apartment_info_items').delete().eq('id', itemId);
    if (error)
        throw new Error(`Failed to delete apartment info item: ${error.message}`);
}
