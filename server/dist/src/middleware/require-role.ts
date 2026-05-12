import type { NextFunction, Request, Response } from 'express'
import type { AuthMembership } from '../types/auth.js'

export function requireRole(allowedRoles: AuthMembership['role'][]) {
  return function roleGuard(request: Request, response: Response, next: NextFunction) {
    const role = request.auth?.membership?.role

    if (!role) {
      response.status(403).json({ error: 'No active apartment role was found.' })
      return
    }

    if (!allowedRoles.includes(role)) {
      response.status(403).json({ error: 'You do not have permission for this action.' })
      return
    }

    next()
  }
}
