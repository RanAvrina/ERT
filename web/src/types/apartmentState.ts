import type { Apartment, User } from './models'

export interface AdminContact {
  phone: string
}

export interface RoommateContact {
  phone: string
}

export interface LandlordContact {
  phone: string
}

export type CredentialsByEmail = Record<string, string>

export interface ApartmentState {
  apartment: Apartment
  adminUser: User
  adminContact: AdminContact
  roommates: User[]
  roommateContacts: Record<number, RoommateContact>
  landlordUser: User | null
  landlordContact: LandlordContact | null
  credentialsByEmail: CredentialsByEmail
}

export interface CreateApartmentInput {
  apartmentName: string
  adminName: string
  adminPhone: string
  adminEmail: string
  adminPassword?: string
  adminUserId?: number
}

export interface AddRoommateInput {
  name: string
  email: string
  phone: string
}

export interface AddUserAccountInput {
  userId?: number
  name: string
  email: string
  phone: string
  password?: string
  role?: User['role']
}

export interface AddLandlordInput {
  userId?: number
  name: string
  email: string
  phone: string
  password?: string
}
