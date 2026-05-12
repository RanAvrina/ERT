import { ApiError } from '../lib/api-error.js';
import { supabaseAdmin } from '../lib/supabase.js';
import { listActiveMembershipsByApartmentId } from './membership-service.js';
async function loadMembershipMaps(apartmentId) {
    const rows = await listActiveMembershipsByApartmentId(apartmentId);
    return {
        accountToMembership: new Map(rows.map((row) => [row.account_id, row.id])),
        membershipToAccount: new Map(rows.map((row) => [row.id, row.account_id])),
    };
}
function requireMembershipId(map, accountId, contextLabel) {
    const membershipId = map.get(accountId);
    if (!membershipId) {
        throw new ApiError(400, `No active apartment membership was found for ${contextLabel}.`);
    }
    return membershipId;
}
function mapShoppingItem(row, membershipToAccount) {
    return {
        id: row.id,
        apartmentId: row.apartment_id,
        shoppingListId: row.shopping_list_id,
        itemName: row.item_name,
        quantity: row.quantity,
        category: row.category,
        status: row.status,
        addedByAccountId: membershipToAccount.get(row.added_by_membership_id) ?? 0,
        purchasedByAccountId: row.purchased_by_membership_id == null
            ? null
            : (membershipToAccount.get(row.purchased_by_membership_id) ?? null),
        createdAt: row.created_at,
        purchasedAt: row.purchased_at,
        updatedAt: row.updated_at,
    };
}
async function ensureDefaultShoppingList(apartmentId, actorAccountId) {
    const { accountToMembership } = await loadMembershipMaps(apartmentId);
    const createdByMembershipId = requireMembershipId(accountToMembership, actorAccountId, 'the shopping list creator');
    const { data, error } = await supabaseAdmin
        .from('shopping_lists')
        .select('*')
        .eq('apartment_id', apartmentId)
        .eq('status', 'active')
        .order('id', { ascending: true })
        .limit(1);
    if (error)
        throw new Error(`Failed to load shopping lists: ${error.message}`);
    const existingList = (data ?? [])[0];
    if (existingList)
        return existingList.id;
    const { data: createdList, error: createError } = await supabaseAdmin
        .from('shopping_lists')
        .insert({
        apartment_id: apartmentId,
        title: 'רשימת קניות',
        status: 'active',
        created_by_membership_id: createdByMembershipId,
    })
        .select('id')
        .single();
    if (createError)
        throw new Error(`Failed to create shopping list: ${createError.message}`);
    return createdList.id;
}
export async function listShoppingItemsByApartmentId(apartmentId) {
    const { membershipToAccount } = await loadMembershipMaps(apartmentId);
    const { data, error } = await supabaseAdmin
        .from('shopping_items')
        .select('*')
        .eq('apartment_id', apartmentId)
        .neq('status', 'cancelled')
        .order('created_at', { ascending: false })
        .order('id', { ascending: false });
    if (error)
        throw new Error(`Failed to load shopping items: ${error.message}`);
    return (data ?? []).map((row) => mapShoppingItem(row, membershipToAccount));
}
export async function createShoppingItem(input) {
    const { accountToMembership } = await loadMembershipMaps(input.apartmentId);
    const addedByMembershipId = requireMembershipId(accountToMembership, input.actorAccountId, 'the shopping item creator');
    const shoppingListId = await ensureDefaultShoppingList(input.apartmentId, input.actorAccountId);
    const isPurchased = input.status === 'purchased';
    const { data, error } = await supabaseAdmin
        .from('shopping_items')
        .insert({
        apartment_id: input.apartmentId,
        shopping_list_id: shoppingListId,
        item_name: input.itemName,
        quantity: input.quantity,
        category: input.category,
        status: input.status,
        added_by_membership_id: addedByMembershipId,
        purchased_by_membership_id: isPurchased ? addedByMembershipId : null,
        purchased_at: isPurchased ? new Date().toISOString() : null,
    })
        .select('*')
        .single();
    if (error)
        throw new Error(`Failed to create shopping item: ${error.message}`);
    const row = data;
    const items = await listShoppingItemsByApartmentId(input.apartmentId);
    return items.find((item) => item.id === row.id) ?? null;
}
export async function updateShoppingItem(input) {
    const { accountToMembership } = await loadMembershipMaps(input.apartmentId);
    const purchasedByMembershipId = input.status === 'purchased'
        ? requireMembershipId(accountToMembership, input.purchasedByAccountId ?? input.actorAccountId, 'the purchasing account')
        : null;
    const { error } = await supabaseAdmin
        .from('shopping_items')
        .update({
        item_name: input.itemName,
        quantity: input.quantity,
        category: input.category,
        status: input.status,
        purchased_by_membership_id: purchasedByMembershipId,
        purchased_at: input.status === 'purchased' ? (input.purchasedAt ?? new Date().toISOString()) : null,
        updated_at: new Date().toISOString(),
    })
        .eq('id', input.itemId);
    if (error)
        throw new Error(`Failed to update shopping item: ${error.message}`);
    const items = await listShoppingItemsByApartmentId(input.apartmentId);
    return items.find((item) => item.id === input.itemId) ?? null;
}
export async function deleteShoppingItem(itemId) {
    const { error } = await supabaseAdmin.from('shopping_items').delete().eq('id', itemId);
    if (error)
        throw new Error(`Failed to delete shopping item: ${error.message}`);
}
