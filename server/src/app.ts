import cors from 'cors'
import express from 'express'
import { env } from './config/env.js'
import { errorHandler, notFoundHandler } from './middleware/error-handler.js'
import { createRateLimit } from './middleware/rate-limit.js'
import { securityHeaders } from './middleware/security-headers.js'
import { apiRouter } from './routes/index.js'

export function createApp() {
  const app = express()
  app.disable('x-powered-by')
  app.set('trust proxy', 1)
  const normalizeOrigin = (origin: string) => origin.trim().replace(/\/+$/, '')
  const allowedOrigins = env.CLIENT_ORIGIN.split(',')
    .map((origin) => normalizeOrigin(origin))
    .filter(Boolean)

  function isAllowedOrigin(origin?: string) {
    if (!origin) return true
    const normalizedOrigin = normalizeOrigin(origin)
    if (allowedOrigins.includes(normalizedOrigin)) return true
    if (/^https?:\/\/(localhost|127\.0\.0\.1):\d+$/.test(normalizedOrigin)) return true

    try {
      const { hostname, protocol } = new URL(normalizedOrigin)
      if ((protocol === 'https:' || protocol === 'http:') && hostname.endsWith('.vercel.app')) {
        return true
      }
    } catch {
      return false
    }

    return false
  }

  app.use(
    cors({
      origin(origin, callback) {
        if (isAllowedOrigin(origin)) {
          callback(null, true)
          return
        }

        callback(new Error(`Origin ${origin ?? 'unknown'} is not allowed by CORS.`))
      },
      credentials: true,
    }),
  )
  app.use(securityHeaders)
  app.use(express.json({ limit: '10mb' }))
  app.use(
    '/api',
    createRateLimit({
      windowMs: env.RATE_LIMIT_WINDOW_MS,
      max: env.RATE_LIMIT_MAX,
    }),
  )

  app.get('/', (_request, response) => {
    response.json({
      ok: true,
      service: 'ert-server',
    })
  })

  app.use('/api', apiRouter)
  app.use(notFoundHandler)
  app.use(errorHandler)

  return app
}
