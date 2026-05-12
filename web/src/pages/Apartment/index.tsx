import { Link } from 'react-router-dom'
import { Card } from '../../components/Card'
import { useApartment } from '../../context/ApartmentContext'
import { appRoutes } from '../../routes/paths'

function formatPhone(value: string | null | undefined) {
  const trimmed = (value ?? '').trim()
  return trimmed ? trimmed : 'לא הוזן'
}

export function ApartmentPage() {
  const { current } = useApartment()

  if (!current) {
    return (
      <div className="page">
        <h1 className="page__title">פרטי דירה</h1>
        <p className="page__lead">לא נמצאה דירה פעילה.</p>
        <Link to={appRoutes.createApartment} className="btn btn--primary">
          פתיחת דירה חדשה
        </Link>
      </div>
    )
  }

  const roommateCount = current.roommates.filter((r) => r.status === 'active').length
  const landlordName = current.landlordUser?.name ?? 'לא שויך בעל דירה'

  return (
    <div className="page">
      <div className="page__head">
        <h1 className="page__title">פרטי דירה</h1>
        <Link to={appRoutes.roommates} className="link-quiet">
          ניהול דיירים
        </Link>
      </div>

      <Card title="מידע כללי">
        <div className="apartment-facts">
          <div>
            <span className="apartment-facts__label">שם הדירה</span>
            <span className="apartment-facts__value">{current.apartment.name}</span>
          </div>
          <div>
            <span className="apartment-facts__label">סטטוס</span>
            <span className="apartment-facts__value">
              {current.apartment.is_active ? 'פעילה' : 'לא פעילה'}
            </span>
          </div>
          <div>
            <span className="apartment-facts__label">דיירים פעילים</span>
            <span className="apartment-facts__value">{roommateCount}</span>
          </div>
        </div>
      </Card>

      <Card title="מנהל הדירה">
        <div className="apartment-facts">
          <div>
            <span className="apartment-facts__label">שם</span>
            <span className="apartment-facts__value">{current.adminUser.name}</span>
          </div>
          <div>
            <span className="apartment-facts__label">אימייל</span>
            <span className="apartment-facts__value">{current.adminUser.email}</span>
          </div>
          <div>
            <span className="apartment-facts__label">טלפון</span>
            <span className="apartment-facts__value">
              {formatPhone(current.adminContact.phone)}
            </span>
          </div>
        </div>
      </Card>

      <Card title="בעל הדירה">
        <div className="apartment-facts">
          <div>
            <span className="apartment-facts__label">שם</span>
            <span className="apartment-facts__value">{landlordName}</span>
          </div>
          <div>
            <span className="apartment-facts__label">אימייל</span>
            <span className="apartment-facts__value">
              {current.landlordUser?.email ?? 'לא הוזן'}
            </span>
          </div>
          <div>
            <span className="apartment-facts__label">טלפון</span>
            <span className="apartment-facts__value">
              {formatPhone(current.landlordContact?.phone)}
            </span>
          </div>
        </div>
      </Card>
    </div>
  )
}

