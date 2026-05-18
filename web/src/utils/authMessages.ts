export function toHebrewAuthMessage(rawMessage: string) {
  const message = rawMessage.trim().toLowerCase()

  if (!message) return 'לא הצלחנו להשלים את הפעולה.'

  if (message.includes('email not confirmed')) {
    return 'כתובת המייל עדיין לא אומתה. פתחו את המייל ולחצו על קישור האימות לפני התחברות.'
  }

  if (
    message.includes('invalid login credentials') ||
    message.includes('invalid email or password') ||
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

  if (
    message.includes('invite is no longer active') ||
    message.includes('invite has expired') ||
    message.includes('invite was not found')
  ) {
    return 'קישור ההזמנה לא פעיל יותר. צריך לבקש קישור הזמנה חדש.'
  }

  if (
    message.includes('already linked to an active apartment') ||
    message.includes('already linked to another active apartment') ||
    message.includes('already linked to this apartment with a different role') ||
    message.includes('החשבון כבר משויך לדירה אחרת')
  ) {
    return 'החשבון כבר משויך לדירה אחרת. אי אפשר לצרף אותו לדירה נוספת.'
  }

  if (
    message.includes('apartment already has an active landlord') ||
    message.includes('already has an active landlord')
  ) {
    return 'כבר משויך בעל דירה אחר לדירה הזו. צריך להסיר או לעדכן אותו לפני קבלת ההזמנה.'
  }

  if (message.includes('request timed out')) {
    return 'השרת לא הגיב בזמן. נסו שוב בעוד כמה רגעים.'
  }

  if (message.includes('failed to fetch') || message.includes('network error')) {
    return 'לא הצלחנו להתחבר לשרת. נסו שוב.'
  }

  return rawMessage
}
