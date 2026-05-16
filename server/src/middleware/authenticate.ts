import type { NextFunction, Request, Response } from 'express'
import { supabaseAdmin } from '../lib/supabase.js'
import { findAccountByEmail } from '../services/account-service.js'
import { findActiveMembershipByAccountId } from '../services/membership-service.js'
import type { AuthAccount, AuthMembership } from '../types/auth.js'

const AUTH_CACHE_TTL_MS = 15_000

interface CachedAuthSession {
  authUserId: string
  authEmail: string
  authFullName: string | null
  authPhone: string | null
}

interface CachedAuthContext {
  authSession: CachedAuthSession
  account: AuthAccount
  membership: AuthMembership | null
  expiresAt: number
}

const sessionCache = new Map<string, { value: CachedAuthSession; expiresAt: number }>()
const authContextCache = new Map<string, CachedAuthContext>()

function extractBearerToken(request: Request) {
  const header = request.headers.authorization
  if (!header) return null
  const [scheme, token] = header.split(' ')
  if (scheme !== 'Bearer' || !token) return null
  return token
}

async function resolveAuthSession(request: Request, response: Response) {
  const token = extractBearerToken(request)
  if (!token) {
    response.status(401).json({ error: 'Missing bearer token.' })
    return null
  }

  const cachedSession = sessionCache.get(token)
  if (cachedSession && cachedSession.expiresAt > Date.now()) {
    return cachedSession.value
  }

  const { data, error } = await supabaseAdmin.auth.getUser(token)
  if (error || !data.user?.email || !data.user.id) {
    response.status(401).json({ error: 'Invalid or expired session token.' })
    return null
  }

  const nextSession = {
    authUserId: data.user.id,
    authEmail: data.user.email,
    authFullName:
      typeof data.user.user_metadata?.full_name === 'string'
        ? data.user.user_metadata.full_name
        : null,
    authPhone:
      typeof data.user.user_metadata?.phone === 'string'
        ? data.user.user_metadata.phone
        : null,
  }
  sessionCache.set(token, {
    value: nextSession,
    expiresAt: Date.now() + AUTH_CACHE_TTL_MS,
  })

  return nextSession
}

export async function authenticateSession(request: Request, response: Response, next: NextFunction) {
  try {
    const session = await resolveAuthSession(request, response)
    if (!session) return

    request.authSession = session
    next()
  } catch (error) {
    next(error)
  }
}

export async function authenticate(request: Request, response: Response, next: NextFunction) {
  try {
    const token = extractBearerToken(request)
    const session = await resolveAuthSession(request, response)
    if (!session) return

    request.authSession = session

    if (token) {
      const cachedContext = authContextCache.get(token)
      if (
        cachedContext &&
        cachedContext.expiresAt > Date.now() &&
        cachedContext.authSession.authEmail === session.authEmail
      ) {
        request.auth = {
          authUserId: cachedContext.authSession.authUserId,
          authEmail: cachedContext.authSession.authEmail,
          account: cachedContext.account,
          membership: cachedContext.membership,
        }
        next()
        return
      }
    }

    const account = await findAccountByEmail(session.authEmail)
    if (!account) {
      response.status(401).json({ error: 'Account was not found for this session.' })
      return
    }

    const membership = await findActiveMembershipByAccountId(account.id)

    request.auth = {
      authUserId: session.authUserId,
      authEmail: session.authEmail,
      account,
      membership,
    }

    if (token) {
      authContextCache.set(token, {
        authSession: session,
        account,
        membership,
        expiresAt: Date.now() + AUTH_CACHE_TTL_MS,
      })
    }

    next()
  } catch (error) {
    next(error)
  }
}
