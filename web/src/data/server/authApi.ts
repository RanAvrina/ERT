import { apiRequest } from '../../lib/api/client'
import type { AccountIdentity } from '../../types/auth'
import type { ApartmentState } from '../../types/apartmentState'
import { mapApartmentState, type ApartmentStateApiResponse } from './apartmentsApi'

interface AuthAccountApiResponse {
  id: number
  email: string
  fullName: string
  phone: string | null
  status: 'active' | 'inactive'
}

interface AuthMembershipApiResponse {
  id: number
  apartmentId: number
  accountId: number
  role: 'admin' | 'tenant' | 'landlord'
  status: 'active' | 'inactive'
}

function mapAccount(account: AuthAccountApiResponse): AccountIdentity {
  return {
    id: account.id,
    name: account.fullName,
    email: account.email,
    phone: account.phone ?? '',
    password: '',
  }
}

export async function ensureAccountViaApi(input: { fullName: string; phone: string | null }) {
  return apiRequest<{ account: AuthAccountApiResponse }>('/auth/account', {
    method: 'POST',
    body: JSON.stringify(input),
  }).then((response) => mapAccount(response.account))
}

export async function readAuthSnapshotViaApi() {
  return apiRequest<{
    account: AuthAccountApiResponse | null
    membership: AuthMembershipApiResponse | null
  }>('/auth/me', {
    method: 'GET',
  }).then((response) => ({
    account: response.account ? mapAccount(response.account) : null,
    membership: response.membership,
  }))
}

export async function readBootstrapViaApi() {
  return apiRequest<{
    account: AuthAccountApiResponse | null
    membership: AuthMembershipApiResponse | null
    apartmentState: ApartmentStateApiResponse | null
  }>('/auth/bootstrap', {
    method: 'GET',
    timeoutMs: 8_000,
  }).then((response): {
    account: AccountIdentity | null
    membership: AuthMembershipApiResponse | null
    apartmentState: ApartmentState | null
  } => ({
    account: response.account ? mapAccount(response.account) : null,
    membership: response.membership,
    apartmentState: response.apartmentState ? mapApartmentState(response.apartmentState) : null,
  }))
}
