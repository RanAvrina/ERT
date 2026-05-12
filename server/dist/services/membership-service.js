import { supabaseAdmin } from '../lib/supabase.js';
import { ApiError } from '../lib/api-error.js';
function mapMembershipRow(row) {
    return {
        id: row.id,
        apartmentId: row.apartment_id,
        accountId: row.account_id,
        role: row.role,
        status: row.status,
    };
}
export async function findActiveMembershipByAccountId(accountId) {
    const { data, error } = await supabaseAdmin
        .from('apartment_memberships')
        .select('*')
        .eq('account_id', accountId)
        .eq('status', 'active')
        .limit(1)
        .maybeSingle();
    if (error)
        throw new Error(`Failed to load active membership: ${error.message}`);
    return data ? mapMembershipRow(data) : null;
}
export async function findActiveMembershipByApartmentAndAccount(apartmentId, accountId) {
    const { data, error } = await supabaseAdmin
        .from('apartment_memberships')
        .select('*')
        .eq('apartment_id', apartmentId)
        .eq('account_id', accountId)
        .eq('status', 'active')
        .limit(1)
        .maybeSingle();
    if (error)
        throw new Error(`Failed to load apartment membership: ${error.message}`);
    return data ? mapMembershipRow(data) : null;
}
export async function listActiveMembershipsByApartmentId(apartmentId) {
    const { data, error } = await supabaseAdmin
        .from('apartment_memberships')
        .select('*')
        .eq('apartment_id', apartmentId)
        .eq('status', 'active')
        .order('joined_at', { ascending: true })
        .order('id', { ascending: true });
    if (error)
        throw new Error(`Failed to load apartment memberships: ${error.message}`);
    return (data ?? []);
}
export async function findMembershipById(membershipId) {
    const { data, error } = await supabaseAdmin
        .from('apartment_memberships')
        .select('*')
        .eq('id', membershipId)
        .limit(1)
        .maybeSingle();
    if (error)
        throw new Error(`Failed to load membership by id: ${error.message}`);
    return data ? mapMembershipRow(data) : null;
}
export async function createMembership(input) {
    const { data, error } = await supabaseAdmin
        .from('apartment_memberships')
        .insert({
        apartment_id: input.apartmentId,
        account_id: input.accountId,
        role: input.role,
        status: 'active',
    })
        .select('*')
        .single();
    if (error)
        throw new Error(`Failed to create membership: ${error.message}`);
    return mapMembershipRow(data);
}
export async function ensureMembership(input) {
    if (input.role === 'landlord') {
        const activeApartmentMemberships = await listActiveMembershipsByApartmentId(input.apartmentId);
        const existingLandlord = activeApartmentMemberships.find((membership) => membership.role === 'landlord' &&
            membership.status === 'active' &&
            membership.account_id !== input.accountId);
        if (existingLandlord) {
            throw new ApiError(409, 'This apartment already has an active landlord.');
        }
    }
    const existingMembership = await findActiveMembershipByAccountId(input.accountId);
    if (!existingMembership) {
        return createMembership(input);
    }
    if (existingMembership.apartmentId !== input.apartmentId) {
        throw new ApiError(409, 'This account is already linked to another active apartment.');
    }
    if (existingMembership.role !== input.role) {
        throw new ApiError(409, 'This account is already linked to this apartment with a different role.');
    }
    return existingMembership;
}
export async function deactivateMembership(membershipId) {
    const { error } = await supabaseAdmin
        .from('apartment_memberships')
        .update({
        status: 'inactive',
        ended_at: new Date().toISOString(),
    })
        .eq('id', membershipId);
    if (error)
        throw new Error(`Failed to deactivate membership: ${error.message}`);
}
export async function assertAccountCanReceiveInviteJoin(accountId, role) {
    const existingMembership = await findActiveMembershipByAccountId(accountId);
    if (!existingMembership)
        return;
    if (existingMembership.role !== role) {
        throw new ApiError(409, 'This account is already linked to another active apartment role.');
    }
    throw new ApiError(409, 'This account is already linked to an active apartment.');
}
