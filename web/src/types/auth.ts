import type { User } from './models'

export interface AuthResult {
  ok: boolean
  error: string
  user?: User
}

export interface AccountIdentity {
  id: number
  name: string
  email: string
  phone: string
  password: string
}
