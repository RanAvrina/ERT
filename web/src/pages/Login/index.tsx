import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AuthShell } from '../../components/auth/AuthShell'
import { useApartment } from '../../context/ApartmentContext'
import { useAuth } from '../../context/AuthContext'
import { appRoutes } from '../../routes/paths'
import { toHebrewAuthMessage } from '../../utils/authMessages'
import { clearPendingInvite, readPendingInvite } from '../../utils/invite'
import { isValidEmail } from '../../utils/validation'

export function LoginPage() {
  const { completeInviteJoin } = useApartment()
  const { user, login, logout, refreshSessionUser, sendPasswordResetEmail } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [errors, setErrors] = useState({ email: '', password: '' })
  const [isResetOpen, setIsResetOpen] = useState(false)
  const [resetEmail, setResetEmail] = useState('')
  const [resetError, setResetError] = useState('')
  const [resetSuccess, setResetSuccess] = useState('')
  const pendingInviteForSession = readPendingInvite()

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

    const pendingInvite = readPendingInvite()
    const result = await login({
      email,
      password,
      allowDetachedAccount: Boolean(pendingInvite),
    })

    if (!result.ok) {
      setError(toHebrewAuthMessage(result.error))
      return
    }

    if (pendingInvite) {
      if (!result.user) {
        logout()
        setError('לא הצלחנו להשלים את ההצטרפות. נסו להתחבר שוב.')
        return
      }

      const joinResult = await completeInviteJoin({
        apartmentId: pendingInvite.apartmentId,
        role: pendingInvite.role,
        user: result.user,
        token: pendingInvite.token,
      })

      if (!joinResult.ok || !joinResult.user) {
        logout()
        setError(toHebrewAuthMessage(joinResult.error))
        return
      }

      const refreshedUser = await refreshSessionUser()
      if (!refreshedUser || refreshedUser.apartment_id !== pendingInvite.apartmentId) {
        logout()
        setError('לא הצלחנו לשייך את החשבון לדירה שאליה הוזמנתם. נסו שוב מקישור ההזמנה.')
        return
      }

      clearPendingInvite()
      navigate(pendingInvite.role === 'landlord' ? appRoutes.tickets : appRoutes.dashboard)
      return
    }

    navigate(result.user?.role === 'landlord' ? appRoutes.tickets : appRoutes.dashboard)
  }

  if (user && pendingInviteForSession) {
    return (
      <AuthShell
        title="בחירת חשבון להצטרפות"
        subtitle="צריך להתחבר עם החשבון שאמור להצטרף לדירה"
        hideIntro
        footer={
          <p className="auth-card__footer-text">
            רוצים לחזור להזמנה?{' '}
            <Link
              to={`/invite/${pendingInviteForSession.apartmentId}?role=${pendingInviteForSession.role}&token=${pendingInviteForSession.token ?? ''}`}
              className="link"
            >
              חזרה להזמנה
            </Link>
          </p>
        }
      >
        <div className="form-stack">
          <p className="form-message">
            כרגע מחוברים כ{user.name} ({user.email}). כדי להצטרף דרך ההזמנה צריך
            להתנתק ולהתחבר עם החשבון המתאים.
          </p>
          {error ? <p className="form-message form-message--error">{error}</p> : null}
          <button type="button" className="btn btn--primary btn--block" onClick={logoutForLogin}>
            התנתק והתחבר עם חשבון אחר
          </button>
        </div>
      </AuthShell>
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
