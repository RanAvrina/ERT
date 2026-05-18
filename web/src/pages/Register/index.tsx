import { useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { AuthShell } from '../../components/auth/AuthShell'
import { useApartment } from '../../context/ApartmentContext'
import { useAuth } from '../../context/AuthContext'
import { appRoutes } from '../../routes/paths'
import { toHebrewAuthMessage } from '../../utils/authMessages'
import {
  clearPendingInvite,
  isTerminalPendingInviteError,
  readPendingInvite,
} from '../../utils/invite'
import { clearPendingApartment } from '../../utils/pendingApartment'
import { isValidEmail, isValidPhone } from '../../utils/validation'
import type { User } from '../../types/models'

function buildTransientInviteUser(input: {
  id: number
  name: string
  email: string
  role: User['role']
}): User {
  return {
    id: input.id,
    apartment_id: 0,
    name: input.name,
    email: input.email,
    role: input.role,
    status: 'active',
    joined_at: new Date().toISOString().slice(0, 10),
  }
}

export function RegisterPage() {
  const { completeInviteJoin } = useApartment()
  const { user, createAccountIdentity, logout, refreshSessionUser } = useAuth()
  const navigate = useNavigate()
  const [form, setForm] = useState({
    name: '',
    phone: '',
    email: '',
    password: '',
  })
  const [error, setError] = useState('')
  const [errors, setErrors] = useState({
    name: '',
    phone: '',
    email: '',
    password: '',
  })
  const [verificationEmail, setVerificationEmail] = useState('')
  const pendingInviteForSession = readPendingInvite()

  function buildInviteVerificationRedirect() {
    const pendingInvite = readPendingInvite()
    if (!pendingInvite || typeof window === 'undefined' || !window.location.origin) {
      return undefined
    }

    const params = new URLSearchParams({
      inviteApartmentId: String(pendingInvite.apartmentId),
      role: pendingInvite.role,
    })

    if (pendingInvite.token) {
      params.set('token', pendingInvite.token)
    }

    return `${window.location.origin}${appRoutes.login}?${params.toString()}`
  }

  function logoutForInviteRegister() {
    logout()
    setError('')
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    const nextErrors = { name: '', phone: '', email: '', password: '' }

    if (!form.name.trim()) {
      nextErrors.name = 'חובה למלא שם מלא.'
    }

    if (!form.phone.trim()) {
      nextErrors.phone = 'נדרש מספר טלפון.'
    } else if (!isValidPhone(form.phone)) {
      nextErrors.phone = 'מספר הטלפון לא תקין.'
    }

    if (!form.email.trim()) {
      nextErrors.email = 'נדרשת כתובת אימייל.'
    } else if (!isValidEmail(form.email)) {
      nextErrors.email = 'כתובת האימייל לא תקינה.'
    }

    if (!form.password.trim()) {
      nextErrors.password = 'צריך לבחור סיסמה.'
    } else if (form.password.trim().length < 6) {
      nextErrors.password = 'הסיסמה צריכה לכלול לפחות 6 תווים.'
    }

    setErrors(nextErrors)
    if (nextErrors.name || nextErrors.phone || nextErrors.email || nextErrors.password) {
      return
    }

    const pendingInvite = readPendingInvite()
    if (!pendingInvite) {
      setError('פתיחת חשבון חדש זמינה רק דרך פתיחת דירה חדשה או דרך קישור הזמנה.')
      return
    }

    clearPendingApartment()

    const accountResult = await createAccountIdentity({
      ...form,
      role: pendingInvite.role,
      emailRedirectTo: buildInviteVerificationRedirect(),
    })

    if (accountResult.requiresEmailVerification) {
      setVerificationEmail(accountResult.email ?? form.email.trim().toLowerCase())
      setForm({
        name: '',
        phone: '',
        email: '',
        password: '',
      })
      return
    }

    if (!accountResult.ok || !accountResult.account) {
      setError(toHebrewAuthMessage(accountResult.error))
      return
    }

    const joinResult = await completeInviteJoin({
      apartmentId: pendingInvite.apartmentId,
      role: pendingInvite.role,
      token: pendingInvite.token,
      user: buildTransientInviteUser({
        id: accountResult.account.id,
        name: accountResult.account.name,
        email: accountResult.account.email,
        role: pendingInvite.role,
      }),
    })

    if (!joinResult.ok || !joinResult.user) {
      if (isTerminalPendingInviteError(joinResult.error)) {
        clearPendingInvite()
      }
      logout()
      setError(toHebrewAuthMessage(joinResult.error))
      return
    }

    const refreshedUser = await refreshSessionUser()
    if (!refreshedUser || refreshedUser.apartment_id !== pendingInvite.apartmentId) {
      clearPendingInvite()
      logout()
      setError('לא הצלחנו לשייך את החשבון לדירה שאליה הוזמנתם. נסו שוב מקישור ההזמנה.')
      return
    }

    clearPendingInvite()
    navigate(pendingInvite.role === 'landlord' ? appRoutes.tickets : appRoutes.dashboard, {
      replace: true,
    })
  }

  if (user && pendingInviteForSession) {
    return (
      <AuthShell
        title="בחירת חשבון להצטרפות"
        subtitle="צריך לאשר עם איזה חשבון ממשיכים"
        hideIntro
        footer={null}
      >
        <div className="form-stack">
          <p className="form-message">
            כרגע מחוברים כ{user.name} ({user.email}). כדי ליצור חשבון חדש דרך ההזמנה צריך
            להתנתק מהחשבון הנוכחי.
          </p>
          {error ? <p className="form-message form-message--error">{error}</p> : null}
          <button
            type="button"
            className="btn btn--primary btn--block"
            onClick={logoutForInviteRegister}
          >
            התנתק וצור חשבון חדש
          </button>
        </div>
      </AuthShell>
    )
  }

  if (user && user.apartment_id > 0) {
    return (
      <Navigate
        to={user.role === 'landlord' ? appRoutes.tickets : appRoutes.dashboard}
        replace
      />
    )
  }

  if (user) {
    return (
      <AuthShell
        title="החלפת חשבון"
        subtitle="כבר יש session פעיל. כדי לפתוח חשבון חדש צריך להתנתק קודם."
        hideIntro
        footer={null}
      >
        <div className="form-stack">
          <p className="form-message">
            מחוברים כעת כ{user.name} ({user.email}).
          </p>
          {error ? <p className="form-message form-message--error">{error}</p> : null}
          <button
            type="button"
            className="btn btn--primary btn--block"
            onClick={logoutForInviteRegister}
          >
            התנתק ופתח חשבון אחר
          </button>
        </div>
      </AuthShell>
    )
  }

  if (!pendingInviteForSession) {
    return <Navigate to={appRoutes.login} replace />
  }

  if (verificationEmail) {
    return (
      <AuthShell
        title="נשלח מייל אימות"
        subtitle="צריך לאשר את כתובת המייל לפני שאפשר להשלים את ההצטרפות"
        hideIntro
        footer={
          <p className="auth-card__footer-text">
            אחרי אישור המייל עברו ל{' '}
            <Link to={appRoutes.login} className="link">
              התחברות
            </Link>
          </p>
        }
      >
        <div className="form-stack">
          <p className="form-message form-message--success">
            שלחנו מייל אימות לכתובת {verificationEmail}.
          </p>
          <p className="form-message">
            פתחו את המייל, לחצו על קישור האימות, ואז התחברו עם החשבון החדש. ההזמנה תושלם
            אוטומטית אחרי ההתחברות.
          </p>
          <button
            type="button"
            className="btn btn--primary btn--block"
            onClick={() => navigate(appRoutes.login)}
          >
            מעבר להתחברות
          </button>
        </div>
      </AuthShell>
    )
  }

  return (
    <AuthShell
      title="פותחים חשבון"
      subtitle="החשבון החדש ישויך לדירה שאליה הוזמנתם"
      hideIntro
      footer={
        <p className="auth-card__footer-text">
          כבר רשומים?{' '}
          <Link to={appRoutes.login} className="link">
            עברו להתחברות
          </Link>
        </p>
      }
    >
      <form className="form-stack" onSubmit={onSubmit} noValidate>
        <label className="field">
          <span className="field__label">שם מלא</span>
          <input
            className="field__input"
            type="text"
            value={form.name}
            onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
            placeholder="איך השותפים יראו אתכם?"
          />
          {errors.name ? <span className="field__error">{errors.name}</span> : null}
        </label>
        <label className="field">
          <span className="field__label">מספר טלפון</span>
          <input
            className="field__input"
            type="tel"
            dir="ltr"
            value={form.phone}
            onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))}
            placeholder="050-123-4567"
          />
          {errors.phone ? <span className="field__error">{errors.phone}</span> : null}
        </label>
        <label className="field">
          <span className="field__label">כתובת אימייל</span>
          <input
            className="field__input"
            type="email"
            dir="ltr"
            autoComplete="username"
            value={form.email}
            onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))}
            placeholder="name@example.com"
          />
          {errors.email ? <span className="field__error">{errors.email}</span> : null}
        </label>
        <label className="field">
          <span className="field__label">סיסמה</span>
          <input
            className="field__input"
            type="password"
            dir="ltr"
            autoComplete="new-password"
            value={form.password}
            onChange={(event) =>
              setForm((current) => ({ ...current, password: event.target.value }))
            }
            placeholder="לפחות 6 תווים"
          />
          {errors.password ? <span className="field__error">{errors.password}</span> : null}
        </label>
        {error ? <p className="form-message form-message--error">{error}</p> : null}
        <button type="submit" className="btn btn--primary btn--block">
          יצירת חשבון והמשך
        </button>
      </form>
    </AuthShell>
  )
}
