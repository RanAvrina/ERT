export function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
}

export function isValidPhone(value: string) {
  const digits = value.replace(/\D/g, '')
  return digits.length >= 9 && digits.length <= 10
}

export function isValidDate(value: string) {
  if (!value) return false
  const date = new Date(value)
  return !Number.isNaN(date.getTime())
}

export function parsePositiveAmount(value: string) {
  const amount = Number(value)
  if (!Number.isFinite(amount) || amount <= 0) return null
  return amount
}
