import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AuthShell } from '../../components/auth/AuthShell'
import { useApartment } from '../../context/ApartmentContext'
import { useAuth } from '../../context/AuthContext'
import { appRoutes } from '../../routes/paths'
import { toHebrewAuthMessage } from '../../utils/authMessages'
import { clearPendingInvite, readPendingInvite } from '../../utils/invite'
import { isValidEmail, isValidPhone } from '../../utils/validation'

export function RegisterPage() {
  const { completeInviteJoin } = useApartment()
  const { user, register, logout, refreshSessionUser } = useAuth()
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

    let result

    try {
      result = await register({
        ...form,
        role: pendingInvite.role,
        attachToApartment: false,
        signInAfterRegister: true,
      })
    } catch (submitError) {
      setError(
        submitError instanceof Error ? submitError.message : 'לא הצלחנו ליצור את החשבון.',
      )
      return
    }

    if (!result.ok) {
      setError(toHebrewAuthMessage(result.error))
      return
    }

    if (result.requiresEmailVerification) {
      setVerificationEmail(result.email ?? form.email.trim().toLowerCase())
      setForm({
        name: '',
        phone: '',
        email: '',
        password: '',
      })
      return
    }

    if (!result.user) {
      logout()
      setError('לא הצלחנו להשלים את ההצטרפות. נסו להירשם שוב.')
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
  }

  if (user && pendingInviteForSession) {
    return (
      <AuthShell
        title="בחירת חשבון להצטרפות"
        subtitle="צריך לאשר עם איזה חשבון ממשיכים"
        hideIntro
        footer={
          <p className="auth-card__footer-text">
            יש לכם חשבון אחר?{' '}
            <button type="button" className="link link-button" onClick={logoutForInviteRegister}>
              התנתקו והירשמו מחדש
            </button>
          </p>
        }
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
    return (
      <AuthShell
        title="פתיחת חשבון חדש"
        subtitle="חשבון חדש נפתח רק דרך פתיחת דירה חדשה או דרך קישור הזמנה"
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
        <div className="form-stack">
          <button
            type="button"
            className="btn btn--primary btn--block"
            onClick={() => navigate(appRoutes.createApartment)}
          >
            פתיחת דירה חדשה
          </button>
          <p className="form-message">
            אם הוזמנתם לדירה קיימת, פתחו את קישור ההזמנה שקיבלתם והמשיכו משם.
          </p>
        </div>
      </AuthShell>
    )
  }

  if (verificationEmail) {
    return (
      <AuthShell
        title="נשלח מייל אימות"
        subtitle="צריך לאשר את כתובת המייל לפני שאפשר להשלים את ההצטרפות"
        hideIntro
        footer={
          <p className="auth-card__footer-text">
            אחרי אישור המייל אפשר לעבור ל{' '}
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
            פתחו את המייל, לחצו על קישור האימות, ואז התחברו עם החשבון החדש דרך קישור
            ההזמנה.
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
