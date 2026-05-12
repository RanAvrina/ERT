import type { AuthenticatedRequestContext } from './auth.js'

declare global {
  namespace Express {
    interface Request {
      auth: AuthenticatedRequestContext | null
      authSession:
        | {
            authUserId: string
            authEmail: string
          }
        | null
    }
  }
}

export {}
