import { Link, Navigate } from 'react-router-dom'
import { AuthShell } from '../../components/auth/AuthShell'
import { appRoutes } from '../../routes/paths'
import { useAuth } from '../../context/AuthContext'

export function OnboardingPage() {
  const { user, isAuthReady } = useAuth()

  if (!isAuthReady) return <div className="page page--loading"><div className="card auth-loading-card"><p>טוען...</p></div></div>
  if (!user) return <Navigate to={appRoutes.login} replace />
  if (user.apartment_id > 0) return <Navigate to={appRoutes.dashboard} replace />

  return (
    <AuthShell
      title="ברוך הבא ל־ERT"
      subtitle="כדי להתחיל, צור דירה חדשה או הצטרף לדירה קיימת."
      hideIntro
      footer={null}
    >
      <div className="onboarding-grid">
        <Link to={appRoutes.createApartment} className="onboarding-card btn btn--primary btn--block">
          <span className="onboarding-emoji">🏠</span>
          <span className="onboarding-text">צור דירה חדשה</span>
        </Link>

        <Link to={appRoutes.join} className="onboarding-card btn btn--secondary btn--block">
          <span className="onboarding-emoji">🔗</span>
          <span className="onboarding-text">הצטרף לדירה קיימת</span>
        </Link>
      </div>
    </AuthShell>
  )
}

export default OnboardingPage
