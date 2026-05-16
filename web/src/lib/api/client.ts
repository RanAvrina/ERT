import { apiBaseUrl } from './env'
import { supabase } from '../supabase/client'

const GET_CACHE_TTL_MS = 5_000
const TOKEN_REFRESH_BUFFER_MS = 10_000
const REQUEST_TIMEOUT_MS = import.meta.env.DEV ? 15_000 : 45_000

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

let cachedAccessToken: string | null = null
let cachedAccessTokenExpiresAt = 0
let inflightAccessTokenPromise: Promise<string | null> | null = null

const getCache = new Map<string, { value: unknown; expiresAt: number }>()
const inflightGetRequests = new Map<string, Promise<unknown>>()

async function readAccessTokenFromSession() {
  if (!supabase) return null

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const { data, error } = await supabase.auth.getSession()
    if (error) throw new Error(error.message)

    const accessToken = data.session?.access_token ?? null
    const expiresAt = data.session?.expires_at ? data.session.expires_at * 1000 : 0
    if (accessToken) {
      cachedAccessToken = accessToken
      cachedAccessTokenExpiresAt = expiresAt
      return accessToken
    }

    if (attempt < 3) {
      await sleep(120)
    }
  }

  return null
}

async function getAccessToken() {
  const now = Date.now()
  if (
    cachedAccessToken &&
    cachedAccessTokenExpiresAt > now + TOKEN_REFRESH_BUFFER_MS
  ) {
    return cachedAccessToken
  }

  if (!inflightAccessTokenPromise) {
    inflightAccessTokenPromise = readAccessTokenFromSession().finally(() => {
      inflightAccessTokenPromise = null
    })
  }

  return inflightAccessTokenPromise
}

interface ApiRequestOptions extends Omit<RequestInit, 'headers'> {
  headers?: Record<string, string>
  authenticated?: boolean
}

function clearGetCache() {
  getCache.clear()
  inflightGetRequests.clear()
}

export function invalidateApiAuthState() {
  cachedAccessToken = null
  cachedAccessTokenExpiresAt = 0
  inflightAccessTokenPromise = null
  clearGetCache()
}

export function primeApiAccessToken(token: string | null, expiresAt?: number | null) {
  if (!token) {
    invalidateApiAuthState()
    return
  }

  cachedAccessToken = token
  cachedAccessTokenExpiresAt = expiresAt ? expiresAt * 1000 : Date.now() + 60_000
  inflightAccessTokenPromise = null
}

export async function apiRequest<T>(path: string, options: ApiRequestOptions = {}) {
  if (!apiBaseUrl) {
    throw new Error('API is not configured.')
  }

  const method = (options.method ?? 'GET').toUpperCase()
  const isGet = method === 'GET'
  const cacheKey = `${options.authenticated !== false ? 'auth' : 'anon'}:${path}`

  if (isGet) {
    const cached = getCache.get(cacheKey)
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value as T
    }

    const inflightRequest = inflightGetRequests.get(cacheKey)
    if (inflightRequest) {
      return (await inflightRequest) as T
    }
  } else {
    clearGetCache()
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers ?? {}),
  }

  if (options.authenticated !== false) {
    const token = await getAccessToken()
    if (token) {
      headers.authorization = `Bearer ${token}`
    } else {
      throw new Error('Missing auth session.')
    }
  }

  const controller = new AbortController()
  const timeoutId = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  const executeRequest = async () => {
    let response: Response
    try {
      response = await fetch(`${apiBaseUrl}${path}`, {
        ...options,
        method,
        headers,
        signal: controller.signal,
      })
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new Error('Request timed out.')
      }

      throw error
    } finally {
      window.clearTimeout(timeoutId)
    }

    if (response.status === 204) {
      return null as T
    }

    const payload = (await response.json().catch(() => null)) as { error?: string } | null
    if (!response.ok) {
      throw new Error(payload?.error || 'Request failed.')
    }

    return payload as T
  }

  if (isGet) {
    const requestPromise = executeRequest()
    inflightGetRequests.set(cacheKey, requestPromise)

    try {
      const result = await requestPromise
      getCache.set(cacheKey, {
        value: result,
        expiresAt: Date.now() + GET_CACHE_TTL_MS,
      })
      return result
    } finally {
      inflightGetRequests.delete(cacheKey)
    }
  }

  return executeRequest()
}
