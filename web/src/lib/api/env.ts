const rawApiBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim() ?? ''

const fallbackApiBaseUrl = import.meta.env.DEV ? 'http://localhost:4000/api' : ''

export const apiBaseUrl = rawApiBaseUrl || fallbackApiBaseUrl
export const isApiConfigured = Boolean(apiBaseUrl)
