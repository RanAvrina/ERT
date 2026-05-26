import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AuthShell } from '../../components/auth/AuthShell'
import { useApartment } from '../../context/ApartmentContext'
import { useAuth } from '../../context/AuthContext'
import { appRoutes } from '../../routes/paths'
import { clearPendingInvite } from '../../utils/invite'
import {
  clearPendingApartment,
  savePendingApartment,
} from '../../utils/pendingApartment'
import { isValidEmail, isValidPhone } from '../../utils/validation'

export function CreateApartmentPage() {
  const navigate = useNavigate()
  const { createApartment } = useApartment()
  const { createAccountIdentity, refreshSessionUser } = useAuth()
  const [form, setForm] = useState({
    apartmentName: '',
    adminName: '',
    phone: '',
    email: '',
    password: '',
    confirmPassword: '',
  })
  const [error, setError] = useState('')
  const [errors, setErrors] = useState({
    apartmentName: '',
    adminName: '',
    phone: '',
    email: '',
    password: '',
    confirmPassword: '',
  })
  const [verificationEmail, setVerificationEmail] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  function navigateToLoginAfterApartmentCreation() {
    navigate(appRoutes.login, {
      replace: true,
      state: {
        notice: 'הדירה נפתחה בהצלחה. התחברו עם החשבון שיצרתם כדי להמשיך.',
        email: form.email.trim().toLowerCase(),
      },
    })
  }

  async function finalizeApartmentCreation(adminUserId?: number) {
    let apartmentCreated = false

    try {
      await createApartment({
        apartmentName: form.apartmentName,
        adminName: form.adminName,
        adminPhone: form.phone,
        adminEmail: form.email,
        adminUserId,
      })
      apartmentCreated = true
      clearPendingApartment()

      const refreshedUser = await refreshSessionUser()
      if (!refreshedUser || refreshedUser.apartment_id <= 0) {
        navigateToLoginAfterApartmentCreation()
        return
      }

      navigate(appRoutes.dashboard)
    } catch (createError) {
      if (apartmentCreated) {
        navigateToLoginAfterApartmentCreation()
        return
      }

      setError(
        createError instanceof Error && createError.message
          ? createError.message
          : 'לא הצלחנו ליצור את הדירה.',
      )
    }
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (isSubmitting) return

    setError('')
    const nextErrors = {
      apartmentName: '',
      adminName: '',
      phone: '',
      email: '',
      password: '',
      confirmPassword: '',
    }

    if (!form.apartmentName.trim()) {
      nextErrors.apartmentName = 'צריך לבחור שם לדירה.'
    }

    if (!form.adminName.trim()) {
      nextErrors.adminName = 'צריך לציין את שם הדייר הראשון.'
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
      nextErrors.password = 'צריך לבחור סיסמה לחשבון המנהל.'
    } else if (form.password.trim().length < 6) {
      nextErrors.password = 'הסיסמה צריכה לכלול לפחות 6 תווים.'
    }

    if (!form.confirmPassword.trim()) {
      nextErrors.confirmPassword = 'צריך לאשר את הסיסמה.'
    } else if (form.confirmPassword !== form.password) {
      nextErrors.confirmPassword = 'הסיסמאות לא תואמות.'
    }

    setErrors(nextErrors)
    if (
      nextErrors.apartmentName ||
      nextErrors.adminName ||
      nextErrors.phone ||
      nextErrors.email ||
      nextErrors.password ||
      nextErrors.confirmPassword
    ) {
      return
    }

    clearPendingInvite()
    savePendingApartment({
      apartmentName: form.apartmentName.trim(),
      adminName: form.adminName.trim(),
      adminPhone: form.phone.trim(),
      adminEmail: form.email.trim().toLowerCase(),
    })

    setIsSubmitting(true)
    try {
      const accountResult = await createAccountIdentity({
        name: form.adminName,
        phone: form.phone,
        email: form.email,
        password: form.password,
        role: 'admin',
      })

      if (accountResult.requiresEmailVerification) {
        setVerificationEmail(accountResult.email ?? form.email.trim().toLowerCase())
        return
      }

      if (!accountResult.ok || !accountResult.account) {
        clearPendingApartment()
        setError(accountResult.error)
        return
      }

      await finalizeApartmentCreation(accountResult.account.id)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <AuthShell
      title="פתיחת דירה חדשה"
      subtitle="פרטים ראשוניים להגדרת הדירה"
      hideIntro
      footer={
        <p className="auth-card__footer-text">
          כבר יש לכם דירה?{' '}
          <Link to={appRoutes.login} className="link">
            התחברות
          </Link>
        </p>
      }
    >
      {verificationEmail ? (
        <div className="form-stack">
          <p className="form-message form-message--success">
            שלחנו מייל אימות לכתובת {verificationEmail}.
          </p>
          <p className="form-message">
            אחרי אישור המייל אפשר להתחבר עם אותו חשבון, והדירה תיפתח אוטומטית.
          </p>
          <button
            type="button"
            className="btn btn--primary btn--block"
            onClick={() => navigate(appRoutes.login)}
          >
            מעבר להתחברות
          </button>
        </div>
      ) : (
        <form className="form-stack" onSubmit={onSubmit} noValidate aria-busy={isSubmitting}>
          <label className="field">
            <span className="field__label">שם הדירה</span>
            <input
              className="field__input"
              type="text"
              disabled={isSubmitting}
              value={form.apartmentName}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  apartmentName: event.target.value,
                }))
              }
              placeholder="לדוגמה: דירת השותפים - הרצל"
            />
            {errors.apartmentName ? (
              <span className="field__error">{errors.apartmentName}</span>
            ) : null}
          </label>

          <label className="field">
            <span className="field__label">שם מלא של הדייר הראשון</span>
            <input
              className="field__input"
              type="text"
              disabled={isSubmitting}
              value={form.adminName}
              onChange={(event) =>
                setForm((current) => ({ ...current, adminName: event.target.value }))
              }
              placeholder="שם פרטי ושם משפחה"
            />
            {errors.adminName ? (
              <span className="field__error">{errors.adminName}</span>
            ) : null}
          </label>

          <label className="field">
            <span className="field__label">מספר טלפון</span>
            <input
              className="field__input"
              type="tel"
              dir="ltr"
              disabled={isSubmitting}
              value={form.phone}
              onChange={(event) =>
                setForm((current) => ({ ...current, phone: event.target.value }))
              }
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
              disabled={isSubmitting}
              value={form.email}
              onChange={(event) =>
                setForm((current) => ({ ...current, email: event.target.value }))
              }
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
              disabled={isSubmitting}
              value={form.password}
              onChange={(event) =>
                setForm((current) => ({ ...current, password: event.target.value }))
              }
              placeholder="לפחות 6 תווים"
            />
            {errors.password ? (
              <span className="field__error">{errors.password}</span>
            ) : null}
          </label>

          <label className="field">
            <span className="field__label">אימות סיסמה</span>
            <input
              className="field__input"
              type="password"
              dir="ltr"
              autoComplete="new-password"
              disabled={isSubmitting}
              value={form.confirmPassword}
              onChange={(event) =>
                setForm((current) => ({ ...current, confirmPassword: event.target.value }))
              }
              placeholder="הקלידו שוב את הסיסמה"
            />
            {errors.confirmPassword ? (
              <span className="field__error">{errors.confirmPassword}</span>
            ) : null}
          </label>

          {error ? <p className="form-message form-message--error">{error}</p> : null}

          {isSubmitting ? (
            <p className="auth-submit-status" role="status" aria-live="polite">
              <span className="auth-submit-status__spinner" aria-hidden="true" />
              <span>יוצר את הדירה, זה יכול לקחת כמה שניות...</span>
            </p>
          ) : null}

          <button type="submit" className="btn btn--primary btn--block" disabled={isSubmitting}>
            {isSubmitting ? (
              <>
                <span className="btn__spinner" aria-hidden="true" />
                <span>יוצר את הדירה...</span>
              </>
            ) : (
              'יצירת דירה'
            )}
          </button>
        </form>
      )}
    </AuthShell>
  )
}
