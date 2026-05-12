import type { NextFunction, Request, Response } from 'express'
import { supabaseAuthClient } from '../lib/supabase.js'
import { findAccountByEmail } from '../services/account-service.js'
import { findActiveMembershipByAccountId } from '../services/membership-service.js'

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

  const { data, error } = await supabaseAuthClient.auth.getUser(token)
  if (error || !data.user?.email || !data.user.id) {
    response.status(401).json({ error: 'Invalid or expired session token.' })
    return null
  }

  return {
    authUserId: data.user.id,
    authEmail: data.user.email,
  }
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
    const session = await resolveAuthSession(request, response)
    if (!session) return

    request.authSession = session

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

    next()
  } catch (error) {
    next(error)
  }
}
