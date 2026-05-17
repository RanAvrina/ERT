import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { AuthShell } from '../../components/auth/AuthShell'
import { useApartment } from '../../context/ApartmentContext'
import { useAuth } from '../../context/AuthContext'
import { readUsableInviteViaApi } from '../../data/server/invitesApi'
import { isSupabaseConfigured } from '../../lib/supabase/env'
import { appRoutes } from '../../routes/paths'
import { savePendingInvite, type InviteRole } from '../../utils/invite'
import { clearPendingApartment } from '../../utils/pendingApartment'

export function JoinApartmentPage() {
  const location = useLocation()
  const navigate = useNavigate()
  const { apartmentId } = useParams()
  const { current, getApartmentById } = useApartment()
  const { user, logout } = useAuth()
  const [remoteApartmentName, setRemoteApartmentName] = useState<string | null>(null)
  const [isRemoteInviteValid, setIsRemoteInviteValid] = useState<boolean | null>(null)

  const inviteToken = useMemo(() => {
    const params = new URLSearchParams(location.search)
    return params.get('token')
  }, [location.search])

  const inviteRole = useMemo<InviteRole>(() => {
    const params = new URLSearchParams(location.search)
    return params.get('role') === 'landlord' ? 'landlord' : 'tenant'
  }, [location.search])

  const inviteApartmentId = Number(apartmentId)

  useEffect(() => {
    let cancelled = false

    async function loadRemoteInvite() {
      if (!isSupabaseConfigured || !inviteToken || !Number.isFinite(inviteApartmentId)) {
        setIsRemoteInviteValid(null)
        setRemoteApartmentName(null)
        return
      }

      try {
        const invite = await readUsableInviteViaApi(inviteToken)
        if (!invite || invite.apartmentId !== inviteApartmentId) {
          if (!cancelled) {
            setIsRemoteInviteValid(false)
            setRemoteApartmentName(null)
          }
          return
        }

        if (!cancelled) {
          setIsRemoteInviteValid(true)
          setRemoteApartmentName(invite.apartmentName ?? null)
        }
      } catch {
        if (!cancelled) {
          setIsRemoteInviteValid(false)
          setRemoteApartmentName(null)
        }
      }
    }

    void loadRemoteInvite()

    return () => {
      cancelled = true
    }
  }, [inviteApartmentId, inviteToken])

  const localInviteApartment = Number.isFinite(inviteApartmentId)
    ? getApartmentById(inviteApartmentId) ??
      (current?.apartment.id === inviteApartmentId ? current : null)
    : null

  const isInviteValid = isSupabaseConfigured
    ? Boolean(inviteToken && isRemoteInviteValid)
    : Boolean(localInviteApartment && inviteToken)

  const apartmentName =
    remoteApartmentName ?? localInviteApartment?.apartment.name ?? 'הזמנה לדירה'
  const roleLabel = inviteRole === 'landlord' ? 'בעל דירה' : 'שותף'

  function rememberInvite() {
    if (!isInviteValid || !inviteToken) return

    clearPendingApartment()
    savePendingInvite({
      apartmentId: inviteApartmentId,
      apartmentName,
      role: inviteRole,
      token: inviteToken,
    })
  }

  function switchAccount(target: typeof appRoutes.login | typeof appRoutes.register) {
    rememberInvite()
    logout()
    navigate(target)
  }

  return (
    <AuthShell
      title="הוזמנתם להצטרף"
      subtitle="בחרו איך להמשיך"
      hideIntro
      footer={
        <p className="auth-card__footer-text">
          רוצים לפתוח דירה אחרת?{' '}
          <Link to={appRoutes.createApartment} className="link">
            פתיחת דירה חדשה
          </Link>
        </p>
      }
    >
      <div className="form-stack">
        <div className="invite-summary">
          <p className="invite-summary__label">הזמנה לדירה</p>
          <p className="invite-summary__name">{apartmentName}</p>
          <p className="invite-summary__meta">תפקיד בהזמנה: {roleLabel}</p>
        </div>

        {isInviteValid ? (
          <>
            <p className="form-message">
              הוזמנתם להצטרף ל{apartmentName}. ההצטרפות תושלם רק אחרי התחברות או יצירת
              חשבון.
            </p>

            {user ? (
              <>
                <p className="form-message">
                  כרגע מחוברים כ{user.name} ({user.email}). כדי להצטרף דרך ההזמנה צריך
                  לעבור להתחברות או לפתוח חשבון חדש עם המשתמש המתאים.
                </p>
                <div className="invite-actions">
                  <button
                    type="button"
                    className="btn btn--primary btn--block"
                    onClick={() => switchAccount(appRoutes.login)}
                  >
                    יש לי חשבון
                  </button>
                  <button
                    type="button"
                    className="btn btn--secondary btn--block"
                    onClick={() => switchAccount(appRoutes.register)}
                  >
                    צור חשבון חדש
                  </button>
                </div>
              </>
            ) : (
              <div className="invite-actions">
                <Link
                  to={appRoutes.login}
                  className="btn btn--primary btn--block"
                  onClick={rememberInvite}
                >
                  יש לי חשבון
                </Link>
                <Link
                  to={appRoutes.register}
                  className="btn btn--secondary btn--block"
                  onClick={rememberInvite}
                >
                  צור חשבון חדש
                </Link>
              </div>
            )}
          </>
        ) : (
          <p className="form-message form-message--error">
            קישור ההזמנה לא תקין או לא שייך לדירה זמינה. בקשו ממנהל הדירה לשלוח קישור
            חדש.
          </p>
        )}
      </div>
    </AuthShell>
  )
}
