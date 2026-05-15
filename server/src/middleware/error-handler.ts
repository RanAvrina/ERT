import type { NextFunction, Request, Response } from 'express'
import { ApiError } from '../lib/api-error.js'
import { env } from '../config/env.js'

export function notFoundHandler(_request: Request, response: Response) {
  response.status(404).json({ error: 'Route not found.' })
}

export function errorHandler(
  error: unknown,
  request: Request,
  response: Response,
  _next: NextFunction,
) {
  if (error instanceof ApiError) {
    response.status(error.statusCode).json({ error: error.message })
    return
  }

  const message =
    error instanceof Error
      ? error.message
      : 'Unexpected server error.'

  console.error('[server-error]', {
    method: request.method,
    path: request.originalUrl,
    message,
  })

  response.status(500).json({
    error: env.NODE_ENV === 'production' ? 'Unexpected server error.' : message,
  })
}
