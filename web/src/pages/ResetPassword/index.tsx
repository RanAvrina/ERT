import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AuthShell } from '../../components/auth/AuthShell'
import { hasAuthSession, updateAuthPassword } from '../../data/supabase/authRepository'
import { isSupabaseConfigured } from '../../lib/supabase/env'
import { appRoutes } from '../../routes/paths'

export function ResetPasswordPage() {
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [isReady, setIsReady] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function checkRecoverySession() {
      if (!isSupabaseConfigured) {
        setError('איפוס סיסמה דרך המייל זמין רק כש־Supabase Auth מחובר.')
        return
      }

      try {
        const sessionExists = await hasAuthSession()
        if (!cancelled) {
          setIsReady(sessionExists)
          if (!sessionExists) {
            setError('קישור איפוס הסיסמה לא תקין או שפג תוקפו.')
          }
        }
      } catch {
        if (!cancelled) {
          setError('לא הצלחנו לאמת את קישור איפוס הסיסמה.')
        }
      }
    }

    void checkRecoverySession()
    return () => {
      cancelled = true
    }
  }, [])

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setSuccess('')

    if (!password.trim()) {
      setError('צריך להזין סיסמה חדשה.')
      return
    }

    if (password.trim().length < 6) {
      setError('הסיסמה צריכה לכלול לפחות 6 תווים.')
      return
    }

    if (confirmPassword !== password) {
      setError('הסיסמאות לא תואמות.')
      return
    }

    try {
      await updateAuthPassword(password)
      setSuccess('הסיסמה עודכנה בהצלחה. אפשר להתחבר עם הסיסמה החדשה.')
      window.setTimeout(() => navigate(appRoutes.login), 1200)
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'לא הצלחנו לעדכן את הסיסמה.')
    }
  }

  return (
    <AuthShell
      title="איפוס סיסמה"
      subtitle="בחרו סיסמה חדשה לחשבון"
      hideIntro
      footer={
        <p className="auth-card__footer-text">
          רוצים לחזור?{' '}
          <Link to={appRoutes.login} className="link">
            מעבר להתחברות
          </Link>
        </p>
      }
    >
      <form className="form-stack" onSubmit={onSubmit} noValidate>
        {error && !isReady ? <p className="form-message form-message--error">{error}</p> : null}
        {isReady ? (
          <>
            <label className="field">
              <span className="field__label">סיסמה חדשה</span>
              <input
                className="field__input"
                type="password"
                dir="ltr"
                autoComplete="new-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="לפחות 6 תווים"
              />
            </label>
            <label className="field">
              <span className="field__label">אימות סיסמה</span>
              <input
                className="field__input"
                type="password"
                dir="ltr"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                placeholder="הקלידו שוב את הסיסמה"
              />
            </label>
            {error ? <p className="form-message form-message--error">{error}</p> : null}
            {success ? <p className="form-message form-message--success">{success}</p> : null}
            <button type="submit" className="btn btn--primary btn--block">
              שמירת סיסמה חדשה
            </button>
          </>
        ) : null}
      </form>
    </AuthShell>
  )
}
