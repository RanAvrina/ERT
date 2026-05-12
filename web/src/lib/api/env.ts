const rawApiBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim() ?? ''

export const apiBaseUrl = rawApiBaseUrl || 'http://localhost:4000/api'
export const isApiConfigured = Boolean(apiBaseUrl)
