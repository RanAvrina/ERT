import { apiBaseUrl } from './env'
import { supabase } from '../supabase/client'

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function getAccessToken() {
  if (!supabase) return null

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const { data, error } = await supabase.auth.getSession()
    if (error) throw new Error(error.message)

    const accessToken = data.session?.access_token ?? null
    if (accessToken) return accessToken

    if (attempt < 7) {
      await sleep(150)
    }
  }

  return null
}

interface ApiRequestOptions extends Omit<RequestInit, 'headers'> {
  headers?: Record<string, string>
  authenticated?: boolean
}

export async function apiRequest<T>(path: string, options: ApiRequestOptions = {}) {
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
  const timeoutId = window.setTimeout(() => controller.abort(), 15000)

  let response: Response
  try {
    response = await fetch(`${apiBaseUrl}${path}`, {
      ...options,
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
