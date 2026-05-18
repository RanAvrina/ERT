import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { AuthShell } from '../../components/auth/AuthShell'
import { useApartment } from '../../context/ApartmentContext'
import { useAuth } from '../../context/AuthContext'
import { appRoutes } from '../../routes/paths'
import { toHebrewAuthMessage } from '../../utils/authMessages'
import {
  clearPendingInvite,
  isTerminalPendingInviteError,
  readPendingInvite,
  savePendingInvite,
  type InviteRole,
} from '../../utils/invite'
import {
  clearPendingApartment,
  readPendingApartment,
} from '../../utils/pendingApartment'
import { isValidEmail } from '../../utils/validation'

function parseInviteQuery(search: string) {
  const params = new URLSearchParams(search)
  const apartmentId = Number(params.get('inviteApartmentId') ?? '')
  const role = params.get('role')
  const token = params.get('token')

  if (!Number.isFinite(apartmentId) || apartmentId <= 0) return null
  if (role !== 'tenant' && role !== 'landlord') return null

  return {
    apartmentId,
    role: role as InviteRole,
    token: token?.trim() ? token.trim() : null,
  }
}

export function LoginPage() {
  const { completeInviteJoin, createApartment } = useApartment()
  const { user, login, logout, refreshSessionUser, sendPasswordResetEmail } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [errors, setErrors] = useState({ email: '', password: '' })
  const [isResetOpen, setIsResetOpen] = useState(false)
  const [resetEmail, setResetEmail] = useState('')
  const [resetError, setResetError] = useState('')
  const [resetSuccess, setResetSuccess] = useState('')
  const [isCompletingInvite, setIsCompletingInvite] = useState(false)
  const inviteFromQuery = useMemo(() => parseInviteQuery(location.search), [location.search])
  const pendingInviteForSession = readPendingInvite()
  const pendingApartmentForSession = readPendingApartment()

  useEffect(() => {
    if (!inviteFromQuery) return

    clearPendingApartment()
    savePendingInvite(inviteFromQuery)
  }, [inviteFromQuery])

  useEffect(() => {
    if (!inviteFromQuery) return

    if (user) {
      logout()
    }

    if (location.search) {
      navigate(appRoutes.login, { replace: true })
    }
  }, [inviteFromQuery, location.search, logout, navigate, user])

  useEffect(() => {
    if (!user || !pendingInviteForSession || isCompletingInvite || inviteFromQuery) return

    const activeUser = user
    const pendingInvite = pendingInviteForSession
    let cancelled = false

    async function completePendingInviteSession() {
      setIsCompletingInvite(true)
      setError('')

      const joinResult = await completeInviteJoin({
        apartmentId: pendingInvite.apartmentId,
        role: pendingInvite.role,
        user: activeUser,
        token: pendingInvite.token,
      })

      if (cancelled) return

      if (!joinResult.ok || !joinResult.user) {
        if (isTerminalPendingInviteError(joinResult.error)) {
          clearPendingInvite()
        }
        setError(toHebrewAuthMessage(joinResult.error))
        setIsCompletingInvite(false)
        return
      }

      const refreshedUser = await refreshSessionUser()
      if (cancelled) return

      if (!refreshedUser || refreshedUser.apartment_id !== pendingInvite.apartmentId) {
        clearPendingInvite()
        setError('לא הצלחנו לשייך את החשבון לדירה שאליה הוזמנתם. נסו שוב מקישור ההזמנה.')
        setIsCompletingInvite(false)
        return
      }

      clearPendingInvite()
      navigate(
        pendingInvite.role === 'landlord' ? appRoutes.tickets : appRoutes.dashboard,
        { replace: true },
      )
    }

    void completePendingInviteSession()

    return () => {
      cancelled = true
    }
  }, [
    completeInviteJoin,
    inviteFromQuery,
    isCompletingInvite,
    navigate,
    pendingInviteForSession,
    refreshSessionUser,
    user,
  ])

  function logoutForLogin() {
    logout()
    setEmail('')
    setPassword('')
    setError('')
  }

  function toggleResetPassword() {
    setIsResetOpen((currentState) => !currentState)
    setResetError('')
    setResetSuccess('')
  }

  async function handleForgotPasswordSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setResetError('')
    setResetSuccess('')

    if (!resetEmail.trim()) {
      setResetError('צריך להזין כתובת אימייל כדי להמשיך.')
      return
    }

    if (!isValidEmail(resetEmail)) {
      setResetError('כתובת האימייל לא תקינה.')
      return
    }

    const result = await sendPasswordResetEmail(resetEmail)
    if (!result.ok && result.error) {
      setResetError(toHebrewAuthMessage(result.error))
      return
    }

    setResetSuccess('אם קיים חשבון עם כתובת המייל הזו, יישלח אליו קישור לאיפוס סיסמה.')
  }

  async function completePendingInviteFlow() {
    const pendingInvite = readPendingInvite()
    if (!pendingInvite) return false

    const result = await login({
      email,
      password,
      allowDetachedAccount: true,
    })

    if (!result.ok) {
      setError(toHebrewAuthMessage(result.error))
      return true
    }

    if (!result.user) {
      logout()
      setError('לא הצלחנו להשלים את ההצטרפות. נסו להתחבר שוב.')
      return true
    }

    const joinResult = await completeInviteJoin({
      apartmentId: pendingInvite.apartmentId,
      role: pendingInvite.role,
      user: result.user,
      token: pendingInvite.token,
    })

    if (!joinResult.ok || !joinResult.user) {
      if (isTerminalPendingInviteError(joinResult.error)) {
        clearPendingInvite()
      }
      logout()
      setError(toHebrewAuthMessage(joinResult.error))
      return true
    }

    const refreshedUser = await refreshSessionUser()
    if (!refreshedUser || refreshedUser.apartment_id !== pendingInvite.apartmentId) {
      clearPendingInvite()
      logout()
      setError('לא הצלחנו לשייך את החשבון לדירה שאליה הוזמנתם. נסו שוב מקישור ההזמנה.')
      return true
    }

    clearPendingInvite()
    clearPendingApartment()
    navigate(
      pendingInvite.role === 'landlord' ? appRoutes.tickets : appRoutes.dashboard,
      { replace: true },
    )
    return true
  }

  async function completePendingApartmentFlow() {
    const pendingApartment = readPendingApartment()
    if (!pendingApartment) return false

    if (pendingApartment.adminEmail !== email.trim().toLowerCase()) {
      clearPendingApartment()
      return false
    }

    const result = await login({
      email,
      password,
      allowDetachedAccount: true,
    })

    if (!result.ok) {
      setError(toHebrewAuthMessage(result.error))
      return true
    }

    if (!result.user) {
      logout()
      setError('לא הצלחנו להשלים את פתיחת הדירה. נסו להתחבר שוב.')
      return true
    }

    try {
      await createApartment({
        apartmentName: pendingApartment.apartmentName,
        adminName: pendingApartment.adminName,
        adminPhone: pendingApartment.adminPhone,
        adminEmail: pendingApartment.adminEmail,
        adminUserId: result.user.id,
      })

      const refreshedUser = await refreshSessionUser()
      if (!refreshedUser || refreshedUser.apartment_id <= 0) {
        throw new Error('לא הצלחנו להשלים את פתיחת הדירה. נסו להתחבר מחדש.')
      }

      clearPendingApartment()
      navigate(appRoutes.dashboard, { replace: true })
    } catch (pendingApartmentError) {
      logout()
      setError(
        pendingApartmentError instanceof Error && pendingApartmentError.message
          ? pendingApartmentError.message
          : 'לא הצלחנו ליצור את הדירה.',
      )
    }

    return true
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    const nextErrors = { email: '', password: '' }

    if (!email.trim()) {
      nextErrors.email = 'צריך להזין כתובת אימייל.'
    } else if (!isValidEmail(email)) {
      nextErrors.email = 'כתובת האימייל לא תקינה.'
    }

    if (!password.trim()) {
      nextErrors.password = 'צריך להזין סיסמה כדי להמשיך.'
    }

    setErrors(nextErrors)
    if (nextErrors.email || nextErrors.password) return

    if (await completePendingInviteFlow()) return
    if (await completePendingApartmentFlow()) return

    const result = await login({ email, password })
    if (!result.ok) {
      setError(toHebrewAuthMessage(result.error))
      return
    }

    navigate(result.user?.role === 'landlord' ? appRoutes.tickets : appRoutes.dashboard, {
      replace: true,
    })
  }

  if (user && (pendingInviteForSession || pendingApartmentForSession)) {
    return (
      <AuthShell
        title="השלמת כניסה"
        subtitle="יש תהליך פתוח שצריך להשלים עם החשבון הנכון"
        hideIntro
        footer={null}
      >
        <div className="form-stack">
          <p className="form-message">
            כרגע מחוברים כ{user.name} ({user.email}).
          </p>
          {isCompletingInvite ? (
            <p className="form-message">משלימים את ההצטרפות לדירה...</p>
          ) : null}
          {error ? <p className="form-message form-message--error">{error}</p> : null}
          <button type="button" className="btn btn--primary btn--block" onClick={logoutForLogin}>
            התנתק והתחבר עם חשבון אחר
          </button>
        </div>
      </AuthShell>
    )
  }

  if (user && user.apartment_id > 0 && !inviteFromQuery) {
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
        subtitle="כבר יש session פעיל. כדי להתחבר עם חשבון אחר צריך להתנתק קודם."
        hideIntro
        footer={null}
      >
        <div className="form-stack">
          <p className="form-message">
            מחוברים כעת כ{user.name} ({user.email}).
          </p>
          {error ? <p className="form-message form-message--error">{error}</p> : null}
          <button type="button" className="btn btn--primary btn--block" onClick={logoutForLogin}>
            התנתק והתחבר עם חשבון אחר
          </button>
        </div>
      </AuthShell>
    )
  }

  return (
    <AuthShell
      title="ברוכים הבאים"
      subtitle="התחברו כדי לחזור לדירה שלכם"
      hideIntro
      footer={
        <p className="auth-card__footer-text">
          אין לך חשבון?{' '}
          <Link to={appRoutes.createApartment} className="link">
            פתיחת דירה חדשה
          </Link>
          <span className="auth-card__footer-divider">·</span>
          <span>או הצטרפו דרך קישור הזמנה</span>
        </p>
      }
    >
      <form className="form-stack" onSubmit={onSubmit} noValidate>
        <label className="field">
          <span className="field__label">כתובת אימייל</span>
          <input
            className="field__input"
            type="email"
            autoComplete="username"
            dir="ltr"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@example.com"
          />
          {errors.email ? <span className="field__error">{errors.email}</span> : null}
        </label>

        <label className="field">
          <span className="field__label">סיסמה</span>
          <input
            className="field__input"
            type="password"
            autoComplete="current-password"
            dir="ltr"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="הסיסמה שלכם"
          />
          {errors.password ? <span className="field__error">{errors.password}</span> : null}
        </label>

        {inviteFromQuery ? (
          <p className="form-message form-message--success">
            האישור נקלט. התחברו כדי להשלים את ההצטרפות לדירה.
          </p>
        ) : null}

        {error ? <p className="form-message form-message--error">{error}</p> : null}

        <button type="submit" className="btn btn--primary btn--block">
          כניסה לחשבון
        </button>
      </form>

      <div className="auth-card__secondary-flow">
        <button
          type="button"
          className="btn-text auth-card__secondary-action"
          onClick={toggleResetPassword}
          aria-expanded={isResetOpen}
        >
          שכחתי סיסמה
        </button>

        {isResetOpen ? (
          <form className="auth-inline-panel" onSubmit={handleForgotPasswordSubmit} noValidate>
            <div className="auth-inline-panel__head">
              <h3>איפוס סיסמה</h3>
            </div>

            <label className="field">
              <span className="field__label">כתובת אימייל</span>
              <input
                className="field__input"
                type="email"
                dir="ltr"
                autoComplete="email"
                value={resetEmail}
                onChange={(event) => setResetEmail(event.target.value)}
                placeholder="you@example.com"
              />
            </label>

            {resetError ? <p className="form-message form-message--error">{resetError}</p> : null}
            {resetSuccess ? (
              <p className="form-message form-message--success">{resetSuccess}</p>
            ) : null}

            <button type="submit" className="btn btn--secondary btn--block">
              שלח קישור לאיפוס
            </button>
          </form>
        ) : null}
      </div>
    </AuthShell>
  )
}
