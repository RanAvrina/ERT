import type { NextFunction, Request, Response } from 'express'

interface RateLimitOptions {
  windowMs: number
  max: number
}

interface Entry {
  count: number
  resetAt: number
}

export function createRateLimit({ windowMs, max }: RateLimitOptions) {
  const entries = new Map<string, Entry>()

  return function rateLimit(request: Request, response: Response, next: NextFunction) {
    const now = Date.now()
    const key = request.ip || 'unknown'
    const current = entries.get(key)

    if (!current || current.resetAt <= now) {
      entries.set(key, { count: 1, resetAt: now + windowMs })
      next()
      return
    }

    current.count += 1

    if (current.count > max) {
      const retryAfterSeconds = Math.max(1, Math.ceil((current.resetAt - now) / 1000))
      response.setHeader('Retry-After', retryAfterSeconds)
      response.status(429).json({
        error: 'Too many requests. Please try again in a moment.',
      })
      return
    }

    next()
  }
}
