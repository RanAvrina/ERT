import type { AuthenticatedRequestContext } from './auth.js'

declare global {
  namespace Express {
    interface Request {
      auth: AuthenticatedRequestContext | null
      authSession:
        | {
            authUserId: string
            authEmail: string
            authFullName: string | null
            authPhone: string | null
          }
        | null
    }
  }
}

export {}
