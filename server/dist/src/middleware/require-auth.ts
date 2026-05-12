import type { NextFunction, Request, Response } from 'express'

export function requireAuth(request: Request, response: Response, next: NextFunction) {
  if (!request.auth) {
    response.status(401).json({ error: 'Authentication is required.' })
    return
  }

  next()
}
