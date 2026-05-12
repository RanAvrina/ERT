import type { AccountIdentity } from '../../types/auth'
import type { ApartmentState } from '../../types/apartmentState'
import type {
  AccountRow,
  ApartmentMembershipRow,
  ApartmentRow,
  InviteRow,
} from '../../types/database'
import type { Apartment, User } from '../../types/models'
import type { InviteRole } from '../../utils/invite'

export function mapAccountRowToIdentity(row: AccountRow): AccountIdentity {
  return {
    id: row.id,
    name: row.full_name,
    email: row.email,
    phone: row.phone ?? '',
    password: '',
  }
}

export function mapApartmentRowToModel(row: ApartmentRow): Apartment {
  return {
    id: row.id,
    name: row.name,
    is_active: row.is_active,
  }
}

export function mapMembershipToUser(
  membership: ApartmentMembershipRow,
  account: AccountRow,
): User {
  return {
    id: account.id,
    apartment_id: membership.apartment_id,
    name: account.full_name,
    email: account.email,
    role: membership.role,
    status: membership.status,
    joined_at: membership.joined_at.slice(0, 10),
  }
}

export function mapInviteInsert(input: {
  apartmentId: number
  role: InviteRole
  token: string
  createdByAccountId: number
  expiresAt?: string | null
}) {
  return {
    apartment_id: input.apartmentId,
    invited_role: input.role,
    token: input.token,
    status: 'active' as const,
    created_by_account_id: input.createdByAccountId,
    expires_at: input.expiresAt ?? null,
  }
}

export function isInviteUsable(invite: InviteRow) {
  if (invite.status !== 'active') return false
  if (!invite.expires_at) return true
  return new Date(invite.expires_at).getTime() > Date.now()
}

export interface ApartmentAggregate {
  apartment: Apartment
  users: User[]
  adminUser: User
  landlordUser: User | null
}

export function mapAggregateToApartmentState(aggregate: ApartmentAggregate): ApartmentState {
  const adminUser = aggregate.adminUser
  return {
    apartment: aggregate.apartment,
    adminUser,
    adminContact: { phone: '' },
    roommates: aggregate.users.filter((user) => user.role !== 'landlord'),
    roommateContacts: Object.fromEntries(
      aggregate.users
        .filter((user) => user.role !== 'landlord')
        .map((user) => [user.id, { phone: '' }]),
    ),
    landlordUser: aggregate.landlordUser,
    landlordContact: aggregate.landlordUser ? { phone: '' } : null,
    credentialsByEmail: {},
  }
}
