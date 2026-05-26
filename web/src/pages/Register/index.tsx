import { useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'

import { AuthShell } from '../../components/auth/AuthShell'
import { clearPendingInviteMetadata } from '../../data/supabase/authRepository'
import { useApartment } from '../../context/ApartmentContext'
import { useAuth } from '../../context/AuthContext'
import { buildAppUrl, navigateToAppRoute } from '../../lib/app/url'
import { appRoutes } from '../../routes/paths'
import type { User } from '../../types/models'
import { toHebrewAuthMessage } from '../../utils/authMessages'
import {
  clearPendingInvite,
  isTerminalPendingInviteError,
  readPendingInvite,
} from '../../utils/invite'
import { clearPendingApartment } from '../../utils/pendingApartment'
import { isValidEmail, isValidPhone } from '../../utils/validation'

function buildTransientInviteUser(email: string): User {
  return {
    id: 0,
    apartment_id: 0,
    role: 'tenant',
    name: '',
    email,
    status: 'active',
    joined_at: new Date().toISOString().slice(0, 10),
  }
}

function buildInviteVerificationRedirect() {
  if (typeof window === 'undefined') {
    return undefined
  }

  const invite = readPendingInvite()
  if (!invite) {
    return buildAppUrl(appRoutes.login)
  }

  const params = new URLSearchParams({
    inviteApartmentId: String(invite.apartmentId),
    role: invite.role,
  })

  if (invite.token) {
    params.set('token', invite.token)
  }

  return buildAppUrl(`${appRoutes.login}?${params.toString()}`)
}

function sleep(milliseconds: number) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, milliseconds)
  })
}

export function RegisterPage() {
  const navigate = useNavigate()
  const { user, refreshSessionUser, logout, createAccountIdentity } = useAuth()
  const { completeInviteJoin } = useApartment()
  const pendingInvite = readPendingInvite()

  const [displayName, setDisplayName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [verificationEmail, setVerificationEmail] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  if (user && pendingInvite) {
    return (
      <AuthShell
        title="בחירת חשבון להצטרפות"
        subtitle="צריך לאשר עם איזה חשבון ממשיכים"
        hideIntro
        footer={
          <>
            כבר רשומים? <Link to={appRoutes.login}>עברו להתחברות</Link>
          </>
        }
      >
        <div className="form-stack">
          <p className="form-message">
            כרגע מחובר החשבון <strong>{user.email}</strong>. כדי ליצור חשבון חדש ולהשלים את
            ההצטרפות צריך להתנתק קודם.
          </p>
          <button className="btn btn--primary btn--block" type="button" onClick={() => logout()}>
            התנתק ויצור חשבון חדש
          </button>
        </div>
      </AuthShell>
    )
  }

  if (user?.apartment_id && user.apartment_id > 0) {
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
        footer={
          <>
            כבר רשומים? <Link to={appRoutes.login}>עברו להתחברות</Link>
          </>
        }
      >
        <div className="form-stack">
          <p className="form-message">
            אתם כבר מחוברים עם <strong>{user.email}</strong>.
          </p>
          <button className="btn btn--primary btn--block" type="button" onClick={() => logout()}>
            התנתק ופתח חשבון אחר
          </button>
        </div>
      </AuthShell>
    )
  }

  if (!pendingInvite) {
    return <Navigate to={appRoutes.login} replace />
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (isSubmitting) return

    const trimmedName = displayName.trim()
    const trimmedPhone = phone.trim()
    const normalizedEmail = email.trim().toLowerCase()

    if (!trimmedName) {
      setError('חובה למלא שם מלא.')
      return
    }

    if (!trimmedPhone) {
      setError('נדרש מספר טלפון.')
      return
    }

    if (!isValidPhone(trimmedPhone)) {
      setError('מספר הטלפון לא תקין.')
      return
    }

    if (!normalizedEmail) {
      setError('נדרשת כתובת אימייל.')
      return
    }

    if (!isValidEmail(normalizedEmail)) {
      setError('כתובת האימייל לא תקינה.')
      return
    }

    if (!password) {
      setError('צריך לבחור סיסמה.')
      return
    }

    if (password.length < 6) {
      setError('הסיסמה צריכה לכלול לפחות 6 תווים.')
      return
    }

    const latestInvite = readPendingInvite()
    if (!latestInvite) {
      setError('פתיחת חשבון חדש זמינה רק דרך קישור הזמנה פעיל.')
      return
    }

    setError(null)
    setIsSubmitting(true)
    clearPendingApartment()

    try {
      const identityResult = await createAccountIdentity({
        name: trimmedName,
        phone: trimmedPhone,
        email: normalizedEmail,
        password,
        emailRedirectTo: buildInviteVerificationRedirect(),
      })

      if (!identityResult.ok) {
        setError(toHebrewAuthMessage(identityResult.error))
        return
      }

      if (identityResult.requiresEmailVerification) {
        setVerificationEmail(normalizedEmail)
        setPassword('')
        return
      }

      const joinResult = await completeInviteJoin({
        apartmentId: latestInvite.apartmentId,
        role: latestInvite.role,
        user: buildTransientInviteUser(normalizedEmail),
        token: latestInvite.token,
      })

      if (!joinResult.ok) {
        if (isTerminalPendingInviteError(joinResult.error)) {
          clearPendingInvite()
        }
        logout()
        setError(toHebrewAuthMessage(joinResult.error))
        return
      }

      clearPendingInvite()
      await clearPendingInviteMetadata().catch(() => undefined)

      let refreshedUser = await refreshSessionUser(normalizedEmail)
      if (!refreshedUser || refreshedUser.apartment_id !== latestInvite.apartmentId) {
        await sleep(350)
        refreshedUser = await refreshSessionUser(normalizedEmail)
      }

      if (!refreshedUser || refreshedUser.apartment_id !== latestInvite.apartmentId) {
        logout()
        navigate(appRoutes.login, {
          replace: true,
          state: {
            notice: 'החשבון נוצר בהצלחה. התחברו עם החשבון החדש כדי להיכנס לדירה.',
            email: normalizedEmail,
          },
        })
        return
      }

      navigateToAppRoute(
        navigate,
        refreshedUser.role === 'landlord' ? appRoutes.tickets : appRoutes.dashboard,
        { replace: true },
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  if (verificationEmail) {
    return (
      <AuthShell
        title="נשלח מייל אימות"
        subtitle="צריך לאשר את כתובת המייל לפני שאפשר להשלים את ההצטרפות"
        hideIntro
        footer={
          <>
            כבר אישרתם? <Link to={appRoutes.login}>עברו להתחברות</Link>
          </>
        }
      >
        <div className="form-stack">
          <p className="form-message form-message--success">
            שלחנו מייל אימות לכתובת <strong>{verificationEmail}</strong>.
          </p>
          <p className="form-message">
            פתחו את המייל, לחצו על קישור האימות, ואז התחברו עם החשבון החדש. ההזמנה תושלם
            אוטומטית אחרי ההתחברות.
          </p>
          <Link className="btn btn--primary btn--block" to={appRoutes.login}>
            מעבר להתחברות
          </Link>
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
        <>
          כבר רשומים? <Link to={appRoutes.login}>עברו להתחברות</Link>
        </>
      }
    >
      <form className="form-stack" onSubmit={onSubmit} noValidate aria-busy={isSubmitting}>
        <label className="field">
          <span className="field__label">שם מלא</span>
          <input
            className="field__input"
            autoComplete="name"
            disabled={isSubmitting}
            onChange={(event) => setDisplayName(event.target.value)}
            required
            type="text"
            value={displayName}
          />
        </label>

        <label className="field">
          <span className="field__label">מספר טלפון</span>
          <input
            className="field__input"
            autoComplete="tel"
            disabled={isSubmitting}
            dir="ltr"
            inputMode="tel"
            onChange={(event) => setPhone(event.target.value)}
            required
            type="tel"
            value={phone}
          />
        </label>

        <label className="field">
          <span className="field__label">כתובת אימייל</span>
          <input
            className="field__input"
            autoComplete="email"
            disabled={isSubmitting}
            onChange={(event) => setEmail(event.target.value)}
            required
            type="email"
            value={email}
          />
        </label>

        <label className="field">
          <span className="field__label">סיסמה</span>
          <input
            className="field__input"
            autoComplete="new-password"
            disabled={isSubmitting}
            minLength={6}
            onChange={(event) => setPassword(event.target.value)}
            required
            type="password"
            value={password}
          />
        </label>

        {error ? <p className="form-message form-message--error">{error}</p> : null}

        {isSubmitting ? (
          <p className="auth-submit-status" role="status" aria-live="polite">
            <span className="auth-submit-status__spinner" aria-hidden="true" />
            <span>יוצר את החשבון, זה יכול לקחת כמה שניות...</span>
          </p>
        ) : null}

        <button type="submit" className="btn btn--primary btn--block" disabled={isSubmitting}>
          {isSubmitting ? (
            <>
              <span className="btn__spinner" aria-hidden="true" />
              <span>יוצר את החשבון...</span>
            </>
          ) : (
            'יצירת חשבון והמשך'
          )}
        </button>
      </form>
    </AuthShell>
  )
}
