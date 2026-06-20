import type { ReactNode } from 'react'

export function AuthShell({
  title,
  subtitle,
  children,
  footer,
  hideIntro = false,
}: {
  title: string
  subtitle: string
  children: ReactNode
  footer: ReactNode
  hideIntro?: boolean
}) {
  return (
    <div className="auth-page">
      <div className={`auth-shell${hideIntro ? ' auth-shell--compact' : ''}`}>
        {hideIntro ? null : (
          <section className="auth-shell__panel auth-shell__panel--intro">
            <span className="auth-shell__eyebrow">ERT</span>
            <h1 className="auth-shell__title">הבית המשותף, מסודר יותר</h1>
            <p className="auth-shell__text">
              כל מה שהשותפים צריכים כדי להתנהל יחד: הוצאות, מטלות, קניות ופניות
              לבעל הדירה, במקום אחד ברור ונוח לשימוש.
            </p>
            <ul className="auth-shell__points">
              <li>מותאם לשימוש יומיומי מהטלפון</li>
              <li>מידע קצר וברור בכרטיסים נקיים</li>
              <li>סביבת הדגמה מקומית, בלי חיבור למסד נתונים</li>
            </ul>
          </section>
        )}

        <section className="auth-card card">
          <header className="auth-card__header">
            <img className="auth-card__logo" src="/logo.png" alt="ERT" />
            <h2 className="auth-card__title">{title}</h2>
            <p className="auth-card__sub">{subtitle}</p>
          </header>
          {children}
          <div className="auth-card__footer">{footer}</div>
        </section>
      </div>
    </div>
  )
}
