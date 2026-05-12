export interface AuthAccount {
  id: number
  email: string
  fullName: string
  phone: string | null
  status: 'active' | 'inactive'
}

export interface AuthMembership {
  id: number
  apartmentId: number
  accountId: number
  role: 'admin' | 'tenant' | 'landlord'
  status: 'active' | 'inactive'
}

export interface AuthenticatedRequestContext {
  authUserId: string
  authEmail: string
  account: AuthAccount
  membership: AuthMembership | null
}
