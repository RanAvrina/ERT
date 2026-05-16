export function toHebrewAuthMessage(rawMessage: string) {
  const message = rawMessage.trim().toLowerCase()

  if (!message) return 'לא הצלחנו להשלים את הפעולה.'

  if (
    message.includes('invalid login credentials') ||
    message.includes('invalid email or password') ||
    message.includes('email not confirmed') ||
    message.includes('invalid grant')
  ) {
    return 'כתובת האימייל או הסיסמה אינם נכונים.'
  }

  if (
    message.includes('user already registered') ||
    message.includes('already registered') ||
    message.includes('already exists') ||
    message.includes('duplicate') ||
    message.includes('unique')
  ) {
    return 'כתובת האימייל כבר נמצאת בשימוש.'
  }

  if (message.includes('password should be at least') || message.includes('password is too weak')) {
    return 'הסיסמה צריכה לכלול לפחות 6 תווים.'
  }

  if (message.includes('email address') && message.includes('invalid')) {
    return 'כתובת האימייל אינה תקינה.'
  }

  if (
    message.includes('missing auth session') ||
    message.includes('invalid or expired session token')
  ) {
    return 'פג תוקף ההתחברות. נסו להתחבר מחדש.'
  }

  if (message.includes('request timed out')) {
    return 'השרת לא הגיב בזמן. נסו שוב בעוד כמה רגעים.'
  }

  if (message.includes('failed to fetch') || message.includes('network error')) {
    return 'לא הצלחנו להתחבר לשרת. נסו שוב.'
  }

  return rawMessage
}
