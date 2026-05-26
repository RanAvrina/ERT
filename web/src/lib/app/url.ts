import type { NavigateFunction } from 'react-router-dom'

function normalizeOrigin(rawOrigin: string) {
  return rawOrigin.trim().replace(/\/+$/, '')
}

function readConfiguredAppOrigin() {
  const rawOrigin = import.meta.env.VITE_APP_ORIGIN
  return typeof rawOrigin === 'string' && rawOrigin.trim()
    ? normalizeOrigin(rawOrigin)
    : ''
}

export function getAppOrigin() {
  const configuredOrigin = readConfiguredAppOrigin()
  if (configuredOrigin) return configuredOrigin

  if (typeof window !== 'undefined' && window.location.origin) {
    return normalizeOrigin(window.location.origin)
  }

  return ''
}

export function buildAppUrl(path: string) {
  const origin = getAppOrigin()
  if (!origin) return path
  return `${origin}${path.startsWith('/') ? path : `/${path}`}`
}

export function navigateToAppRoute(
  navigate: NavigateFunction,
  path: string,
  options?: { replace?: boolean },
) {
  const targetUrl = buildAppUrl(path)

  if (typeof window !== 'undefined' && window.location.origin) {
    const currentOrigin = normalizeOrigin(window.location.origin)
    const targetOrigin = getAppOrigin()

    if (targetOrigin && currentOrigin !== targetOrigin) {
      if (options?.replace) {
        window.location.replace(targetUrl)
      } else {
        window.location.assign(targetUrl)
      }
      return
    }
  }

  navigate(path, { replace: options?.replace })
}
