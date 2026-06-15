import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'

import { AuthShell } from '../../components/auth/AuthShell'
import { clearPendingInviteMetadata } from '../../data/supabase/authRepository'
import { useApartment } from '../../context/ApartmentContext'
import { useAuth } from '../../context/AuthContext'
import { readUsableInviteViaApi } from '../../data/server/invitesApi'
import { navigateToAppRoute } from '../../lib/app/url'
import { isSupabaseConfigured } from '../../lib/supabase/env'
import { appRoutes } from '../../routes/paths'
import { toHebrewAuthMessage } from '../../utils/authMessages'
import {
  clearPendingInvite,
  isTerminalPendingInviteError,
  savePendingInvite,
  type InviteRole,
} from '../../utils/invite'
import { clearPendingApartment } from '../../utils/pendingApartment'

export function JoinApartmentPage() {
  const location = useLocation()
  const navigate = useNavigate()
  const { apartmentId } = useParams()
  const { current, getApartmentById, completeInviteJoin } = useApartment()
  const { user, logout, refreshSessionUser } = useAuth()

  const [remoteApartmentName, setRemoteApartmentName] = useState<string | null>(null)
  const [isRemoteInviteValid, setIsRemoteInviteValid] = useState<boolean | null>(null)
  const [isCheckingInvite, setIsCheckingInvite] = useState(false)
  const [autoJoinError, setAutoJoinError] = useState('')
  const [isAutoJoining, setIsAutoJoining] = useState(false)

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
        setIsCheckingInvite(false)
        return
      }

      setIsCheckingInvite(true)

      try {
        const invite = await readUsableInviteViaApi(inviteToken)
        if (cancelled) return

        if (!invite || invite.apartmentId !== inviteApartmentId) {
          setIsRemoteInviteValid(false)
          setRemoteApartmentName(null)
          return
        }

        setIsRemoteInviteValid(true)
        setRemoteApartmentName(invite.apartmentName ?? null)
      } catch {
        if (!cancelled) {
          setIsRemoteInviteValid(false)
          setRemoteApartmentName(null)
        }
      } finally {
        if (!cancelled) {
          setIsCheckingInvite(false)
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

  const isInvitePendingCheck = isSupabaseConfigured
    ? Boolean(inviteToken && (isCheckingInvite || isRemoteInviteValid === null))
    : false

  const isInviteValid = isSupabaseConfigured
    ? Boolean(inviteToken && isRemoteInviteValid)
    : Boolean(localInviteApartment && inviteToken)

  const apartmentName =
    remoteApartmentName ?? localInviteApartment?.apartment.name ?? 'הזמנה לדירה'
  const roleLabel = inviteRole === 'landlord' ? 'בעל דירה' : 'שותף'

  const rememberInvite = useCallback(() => {
    if (!isInviteValid || !inviteToken) return

    clearPendingApartment()
    savePendingInvite({
      apartmentId: inviteApartmentId,
      apartmentName,
      role: inviteRole,
      token: inviteToken,
    })
  }, [apartmentName, inviteApartmentId, inviteRole, inviteToken, isInviteValid])

  function switchAccount(target: typeof appRoutes.login | typeof appRoutes.register) {
    rememberInvite()
    logout()
    navigate(target, { state: { inviteFlow: true } })
  }

  useEffect(() => {
    if (!user || !isInviteValid || !inviteToken || isAutoJoining) return

    rememberInvite()
    const activeUser = user
    let cancelled = false

    async function completeJoinFromInvitePage() {
      setIsAutoJoining(true)
      setAutoJoinError('')

      const joinResult = await completeInviteJoin({
        apartmentId: inviteApartmentId,
        role: inviteRole,
        user: activeUser,
        token: inviteToken,
      })

      if (cancelled) return

      if (!joinResult.ok || !joinResult.user) {
        if (isTerminalPendingInviteError(joinResult.error)) {
          clearPendingInvite()
        }
        setAutoJoinError(toHebrewAuthMessage(joinResult.error))
        setIsAutoJoining(false)
        return
      }

      clearPendingInvite()
      await clearPendingInviteMetadata().catch(() => undefined)

      const refreshedUser = await refreshSessionUser()
      if (cancelled) return

      if (!refreshedUser || refreshedUser.apartment_id !== inviteApartmentId) {
        logout()
        navigate(appRoutes.login, {
          replace: true,
          state: {
            notice: 'החשבון כבר שויך לדירה. התחברו כדי להמשיך.',
            email: activeUser.email,
          },
        })
        return
      }

      navigateToAppRoute(
        navigate,
        inviteRole === 'landlord' ? appRoutes.tickets : appRoutes.dashboard,
        { replace: true },
      )
    }

    void completeJoinFromInvitePage()

    return () => {
      cancelled = true
    }
  }, [
    completeInviteJoin,
    inviteApartmentId,
    inviteRole,
    inviteToken,
    isAutoJoining,
    isInviteValid,
    logout,
    navigate,
    rememberInvite,
    refreshSessionUser,
    user,
  ])

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

        {isInvitePendingCheck ? (
          <p className="form-message">בודקים את קישור ההזמנה...</p>
        ) : isInviteValid ? (
          <>
            <p className="form-message">
              הוזמנתם להצטרף ל{apartmentName}. ההצטרפות תושלם אחרי התחברות או יצירת חשבון.
            </p>

            {user ? (
              <>
                <p className="form-message">
                  מחוברים כעת כ{user.name} ({user.email}).
                </p>
                {isAutoJoining ? (
                  <p className="form-message">משלימים את ההצטרפות לדירה...</p>
                ) : null}
                {autoJoinError ? (
                  <p className="form-message form-message--error">{autoJoinError}</p>
                ) : null}
                <div className="invite-actions">
                  <button
                    type="button"
                    className="btn btn--primary btn--block"
                    onClick={() => switchAccount(appRoutes.login)}
                  >
                    יש לי חשבון אחר
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
                  state={{ inviteFlow: true }}
                >
                  יש לי חשבון
                </Link>
                <Link
                  to={appRoutes.register}
                  className="btn btn--secondary btn--block"
                  onClick={rememberInvite}
                  state={{ inviteFlow: true }}
                >
                  צור חשבון חדש
                </Link>
              </div>
            )}
          </>
        ) : (
          <p className="form-message form-message--error">
            קישור ההזמנה לא תקין או לא שייך לדירה זמינה. בקשו ממנהל הדירה לשלוח קישור חדש.
          </p>
        )}
      </div>
    </AuthShell>
  )
}
