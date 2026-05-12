import { supabaseAdmin } from '../lib/supabase.js';
import { ApiError } from '../lib/api-error.js';
import { createMembership, listActiveMembershipsByApartmentId } from './membership-service.js';
function mapApartmentRow(row) {
    return {
        id: row.id,
        name: row.name,
        isActive: row.is_active,
    };
}
export async function findApartmentById(apartmentId) {
    const { data, error } = await supabaseAdmin
        .from('apartments')
        .select('*')
        .eq('id', apartmentId)
        .limit(1)
        .maybeSingle();
    if (error)
        throw new Error(`Failed to load apartment: ${error.message}`);
    return data ? mapApartmentRow(data) : null;
}
export async function requireApartmentById(apartmentId) {
    const apartment = await findApartmentById(apartmentId);
    if (!apartment) {
        throw new ApiError(404, 'Apartment was not found.');
    }
    return apartment;
}
export async function listApartmentsByAccountId(accountId) {
    const { data: memberships, error: membershipsError } = await supabaseAdmin
        .from('apartment_memberships')
        .select('apartment_id')
        .eq('account_id', accountId)
        .eq('status', 'active');
    if (membershipsError)
        throw new Error(`Failed to load account apartments: ${membershipsError.message}`);
    const apartmentIds = (memberships ?? []).map((row) => row.apartment_id);
    if (!apartmentIds.length)
        return [];
    const { data, error } = await supabaseAdmin
        .from('apartments')
        .select('*')
        .in('id', apartmentIds)
        .order('created_at', { ascending: false });
    if (error)
        throw new Error(`Failed to load apartments: ${error.message}`);
    return (data ?? []).map(mapApartmentRow);
}
export async function createApartmentForAccount(input) {
    const { data, error } = await supabaseAdmin
        .from('apartments')
        .insert({
        name: input.name,
        is_active: true,
    })
        .select('*')
        .single();
    if (error)
        throw new Error(`Failed to create apartment: ${error.message}`);
    const apartment = mapApartmentRow(data);
    await createMembership({
        apartmentId: apartment.id,
        accountId: input.accountId,
        role: 'admin',
    });
    return apartment;
}
export async function getApartmentAccessSnapshot(apartmentId) {
    const apartment = await requireApartmentById(apartmentId);
    const memberships = await listActiveMembershipsByApartmentId(apartmentId);
    return {
        apartment,
        activeMembershipCount: memberships.length,
    };
}
export async function getApartmentStateSnapshot(apartmentId) {
    const apartment = await requireApartmentById(apartmentId);
    const memberships = await listActiveMembershipsByApartmentId(apartmentId);
    const accountIds = [...new Set(memberships.map((membership) => membership.account_id))];
    const { data: accountRows, error: accountsError } = await supabaseAdmin
        .from('accounts')
        .select('id,email,full_name,phone,status')
        .in('id', accountIds);
    if (accountsError) {
        throw new Error(`Failed to load apartment accounts: ${accountsError.message}`);
    }
    const accountsById = new Map((accountRows ?? []).map((account) => [account.id, account]));
    const users = memberships.map((membership) => {
        const account = accountsById.get(membership.account_id);
        if (!account) {
            throw new ApiError(500, `Account ${membership.account_id} is missing for apartment membership.`);
        }
        return {
            id: account.id,
            apartment_id: membership.apartment_id,
            name: account.full_name,
            email: account.email,
            role: membership.role,
            status: membership.status,
            joined_at: membership.joined_at.slice(0, 10),
        };
    });
    const adminUser = users.find((user) => user.role === 'admin') ?? null;
    if (!adminUser) {
        throw new ApiError(500, 'Apartment admin membership is missing.');
    }
    return {
        apartment: {
            id: apartment.id,
            name: apartment.name,
            is_active: apartment.isActive,
        },
        adminUser,
        landlordUser: users.find((user) => user.role === 'landlord') ?? null,
        users,
    };
}
