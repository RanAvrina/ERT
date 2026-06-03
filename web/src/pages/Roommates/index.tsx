import { useState, type FormEvent } from 'react'
import { Card } from '../../components/Card'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { useApartment } from '../../context/ApartmentContext'
import { useAuth } from '../../context/AuthContext'
import { createInviteViaApi } from '../../data/server/invitesApi'
import { buildAppUrl } from '../../lib/app/url'
import { isSupabaseConfigured } from '../../lib/supabase/env'
import { toHebrewAuthMessage } from '../../utils/authMessages'

function toHebrewRoommateRemovalMessage(rawMessage: string) {
  const message = rawMessage.trim().toLowerCase()

  if (!message) {
    return 'לא הצלחנו להסיר את הדייר מהדירה.'
  }

  if (
    message.includes('account membership was not found in this apartment') ||
    message.includes('not found')
  ) {
    return 'לא מצאנו את הדייר ברשימת הדיירים הפעילים של הדירה.'
  }

  if (
    message.includes('apartment_memberships_unique_active_account') ||
    (message.includes('duplicate key value') && message.includes('apartment_memberships'))
  ) {
    return 'לא הצלחנו להסיר את הדייר בגלל התנגשות ישנה בנתוני החברות. צריך לעדכן את ה-DB ואז לנסות שוב.'
  }

  if (message.includes('forbidden') || message.includes('permission')) {
    return 'אין הרשאה להסיר את הדייר הזה.'
  }

  return toHebrewAuthMessage(rawMessage)
}

export function RoommatesPage() {
  const { user } = useAuth()
  const { current, removeRoommate, addLandlord } = useApartment()
  const [isLandlordModalOpen, setIsLandlordModalOpen] = useState(false)
  const [isInviteOpen, setIsInviteOpen] = useState(false)
  const [landlordForm, setLandlordForm] = useState({
    name: '',
    phone: '',
    email: '',
  })
  const [landlordError, setLandlordError] = useState('')
  const [landlordInviteLink, setLandlordInviteLink] = useState('')
  const [landlordInviteStatus, setLandlordInviteStatus] = useState('')
  const [inviteLink, setInviteLink] = useState('')
  const [inviteStatus, setInviteStatus] = useState('')
  const [roommateToRemove, setRoommateToRemove] = useState<number | null>(null)
  const [removeRoommateError, setRemoveRoommateError] = useState('')
  const [isRemovingRoommate, setIsRemovingRoommate] = useState(false)
  const roommates = (current?.roommates ?? []).filter((roommate) => roommate.status === 'active')
  const roommatePendingRemoval =
    roommateToRemove == null
      ? null
      : roommates.find((roommate) => roommate.id === roommateToRemove) ?? null
  const isAdmin = user?.role === 'admin'
  const usesInviteOnlyFlow = isSupabaseConfigured

  function closeLandlordModal() {
    setIsLandlordModalOpen(false)
    setLandlordForm({ name: '', phone: '', email: '' })
    setLandlordError('')
    setLandlordInviteLink('')
    setLandlordInviteStatus('')
  }

  function closeInviteModal() {
    setIsInviteOpen(false)
    setInviteStatus('')
  }

  function buildInviteLink(role: 'tenant' | 'landlord' = 'tenant') {
    const apartmentId = current?.apartment.id ?? 0
    const token =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `invite-${Date.now()}`
    return buildAppUrl(`/invite/${apartmentId}?role=${role}&token=${token}`)
  }

  function buildInviteLinkFromToken(role: 'tenant' | 'landlord', token: string) {
    const apartmentId = current?.apartment.id ?? 0
    return buildAppUrl(`/invite/${apartmentId}?role=${role}&token=${token}`)
  }

  async function openInviteModal() {
    const nextInviteLink =
      isSupabaseConfigured && current && user
        ? await createInviteViaApi({
            apartmentId: current.apartment.id,
            invitedRole: 'tenant',
          }).then(({ invite }) => buildInviteLinkFromToken('tenant', invite.token))
        : buildInviteLink('tenant')

    setIsInviteOpen(true)
    setInviteStatus('')
    setInviteLink(nextInviteLink)
  }

  async function onCopyInvite() {
    try {
      await navigator.clipboard.writeText(inviteLink)
      setInviteStatus('הקישור הועתק ללוח.')
    } catch {
      setInviteStatus('לא הצלחנו להעתיק. אפשר לבחור ולהעתיק ידנית.')
    }
  }

  async function onCopyLandlordInvite() {
    try {
      await navigator.clipboard.writeText(landlordInviteLink)
      setLandlordInviteStatus('הקישור הועתק ללוח.')
    } catch {
      setLandlordInviteStatus('לא הצלחנו להעתיק. אפשר לבחור ולהעתיק ידנית.')
    }
  }

  async function onLandlordSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setLandlordError('')
    setLandlordInviteStatus('')

    if (!usesInviteOnlyFlow) {
      if (!landlordForm.name.trim()) {
        setLandlordError('צריך לציין שם מלא.')
        return
      }

      if (!landlordForm.phone.trim()) {
        setLandlordError('נדרש מספר טלפון.')
        return
      }

      if (!landlordForm.email.trim()) {
        setLandlordError('נדרשת כתובת אימייל.')
        return
      }
    }

    const nextInviteLink =
      usesInviteOnlyFlow && current && user
        ? await createInviteViaApi({
            apartmentId: current.apartment.id,
            invitedRole: 'landlord',
          }).then(({ invite }) => buildInviteLinkFromToken('landlord', invite.token))
        : buildInviteLink('landlord')

    if (!usesInviteOnlyFlow) {
      await addLandlord({
        name: landlordForm.name,
        phone: landlordForm.phone,
        email: landlordForm.email,
      })
    }

    setLandlordInviteLink(nextInviteLink)
    setLandlordInviteStatus('הזמנת בעל הדירה מוכנה לשיתוף.')
  }

  async function confirmRemoveRoommate() {
    if (roommateToRemove == null || isRemovingRoommate) return

    setIsRemovingRoommate(true)
    setRemoveRoommateError('')

    try {
      await removeRoommate(roommateToRemove)
      setRoommateToRemove(null)
    } catch (error) {
      setRemoveRoommateError(
        toHebrewRoommateRemovalMessage(
          error instanceof Error ? error.message : 'לא הצלחנו להסיר את הדייר מהדירה.',
        ),
      )
    } finally {
      setIsRemovingRoommate(false)
    }
  }

  return (
    <div className="page">
      <h1 className="page__title">דיירים פעילים</h1>

      <Card
        title="רשימה"
        action={
          isAdmin ? (
            <div className="roommate-actions">
              <button
                type="button"
                className="btn btn--secondary btn--small"
                onClick={() => void openInviteModal()}
              >
                הזמנת דייר
              </button>
              <button
                type="button"
                className="btn btn--secondary btn--small"
                onClick={() => setIsLandlordModalOpen(true)}
              >
                הזמנת בעל דירה
              </button>
            </div>
          ) : null
        }
      >
        {removeRoommateError ? (
          <p className="form-message form-message--error">{removeRoommateError}</p>
        ) : null}
        <ul className="roommate-list">
          {roommates.map((roommate) => (
            <li key={roommate.id} className="roommate-list__item">
              <div className="roommate-list__main">
                <div className="roommate-list__name">{roommate.name}</div>
                <div className="roommate-list__meta">{roommate.email}</div>
              </div>
              <div className="roommate-list__aside">
                <span className="chip chip--primary">
                  {roommate.role === 'admin' ? 'דייר מנהל' : 'דייר'}
                </span>
                {isAdmin && roommate.role !== 'admin' ? (
                  <button
                    type="button"
                    className="btn-text btn-text--danger"
                    onClick={() => {
                      setRemoveRoommateError('')
                      setRoommateToRemove(roommate.id)
                    }}
                  >
                    הסרה
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      </Card>

      <Card title="בעל הדירה">
        {current?.landlordUser ? (
          <div className="roommate-landlord">
            <div>
              <div className="roommate-list__name">{current.landlordUser.name}</div>
              <div className="roommate-list__meta">{current.landlordUser.email}</div>
              {current.landlordContact?.phone ? (
                <div className="roommate-list__meta" dir="ltr">
                  {current.landlordContact.phone}
                </div>
              ) : null}
            </div>
            <span className="chip chip--warning">בעל דירה</span>
          </div>
        ) : (
          <p className="muted">לא שויך בעל דירה.</p>
        )}
      </Card>

      {isAdmin && isLandlordModalOpen ? (
        <div className="modal-backdrop" role="presentation" onClick={closeLandlordModal}>
          <section
            className="roommate-modal card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="add-landlord-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="roommate-modal__head">
              <div>
                <p className="tickets-hero__eyebrow">בעל דירה</p>
                <h2 id="add-landlord-title">הזמנת בעל דירה לדירה</h2>
                <p>
                  {usesInviteOnlyFlow
                    ? 'ניצור קישור הזמנה לבעל הדירה. הוא יבחר אם להתחבר עם חשבון קיים או לפתוח חשבון חדש, ואז ישויך אוטומטית לדירה.'
                    : 'ניצור קישור הזמנה לבעל הדירה כדי שיוכל להתחבר או לפתוח חשבון.'}
                </p>
              </div>
              <button type="button" className="btn-text" onClick={closeLandlordModal}>
                סגירה
              </button>
            </div>

            <form className="roommate-form" onSubmit={(event) => void onLandlordSubmit(event)} noValidate>
              {usesInviteOnlyFlow ? (
                <p className="form-message">
                  הקישור לא שומר מייל או טלפון. בעל הדירה יזין את הפרטים שלו בזמן
                  ההתחברות או ההרשמה, והמערכת תשמור את הפרטים שהוא יבחר.
                </p>
              ) : (
                <>
                  <label className="field">
                    <span className="field__label">שם מלא</span>
                    <input
                      className="field__input"
                      type="text"
                      value={landlordForm.name}
                      onChange={(event) =>
                        setLandlordForm((currentForm) => ({
                          ...currentForm,
                          name: event.target.value,
                        }))
                      }
                      placeholder="שם פרטי ושם משפחה"
                    />
                  </label>
                  <label className="field">
                    <span className="field__label">מספר טלפון</span>
                    <input
                      className="field__input"
                      type="tel"
                      dir="ltr"
                      value={landlordForm.phone}
                      onChange={(event) =>
                        setLandlordForm((currentForm) => ({
                          ...currentForm,
                          phone: event.target.value,
                        }))
                      }
                      placeholder="050-123-4567"
                    />
                  </label>
                  <label className="field">
                    <span className="field__label">כתובת אימייל</span>
                    <input
                      className="field__input"
                      type="email"
                      dir="ltr"
                      value={landlordForm.email}
                      onChange={(event) =>
                        setLandlordForm((currentForm) => ({
                          ...currentForm,
                          email: event.target.value,
                        }))
                      }
                      placeholder="name@example.com"
                    />
                  </label>
                </>
              )}

              {landlordError ? (
                <p className="form-message form-message--error">{landlordError}</p>
              ) : null}
              {landlordInviteStatus ? (
                <p className="form-message form-message--success">{landlordInviteStatus}</p>
              ) : null}
              {landlordInviteLink ? (
                <label className="field">
                  <span className="field__label">קישור הזמנה לבעל הדירה</span>
                  <input className="field__input" type="text" readOnly value={landlordInviteLink} />
                </label>
              ) : null}
              <div className="roommate-form__actions">
                <button
                  type="button"
                  className="btn btn--secondary"
                  onClick={closeLandlordModal}
                >
                  ביטול
                </button>
                {landlordInviteLink ? (
                  <button
                    type="button"
                    className="btn btn--primary"
                    onClick={() => void onCopyLandlordInvite()}
                  >
                    העתקת קישור
                  </button>
                ) : (
                  <button type="submit" className="btn btn--primary">
                    יצירת הזמנה
                  </button>
                )}
              </div>
            </form>
          </section>
        </div>
      ) : null}

      {isAdmin && isInviteOpen ? (
        <div className="modal-backdrop" role="presentation" onClick={closeInviteModal}>
          <section
            className="roommate-modal card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="invite-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="roommate-modal__head">
              <div>
                <p className="tickets-hero__eyebrow">הזמנה</p>
                <h2 id="invite-title">הזמנת דייר חדש</h2>
                <p>שתפו את הקישור והדייר יצטרף דרך התחברות או הרשמה.</p>
              </div>
              <button type="button" className="btn-text" onClick={closeInviteModal}>
                סגירה
              </button>
            </div>

            <div className="roommate-form">
              <label className="field">
                <span className="field__label">קישור הזמנה</span>
                <input className="field__input" type="text" readOnly value={inviteLink} />
                <span className="field__hint">
                  הקישור ישייך את הדייר לדירה הנוכחית אחרי התחברות או הרשמה.
                </span>
              </label>
              {inviteStatus ? (
                <p className="form-message form-message--success">{inviteStatus}</p>
              ) : null}
              <div className="invite-actions">
                <button type="button" className="btn btn--secondary" onClick={closeInviteModal}>
                  סגירה
                </button>
                <button type="button" className="btn btn--primary" onClick={() => void onCopyInvite()}>
                  העתקת קישור
                </button>
              </div>
            </div>
          </section>
        </div>
      ) : null}

      {roommateToRemove != null ? (
        <ConfirmDialog
          title="להסיר את הדייר מהדירה?"
          message={
            roommatePendingRemoval
              ? `הדייר ${roommatePendingRemoval.name} יוסר מרשימת הדיירים הפעילים ויצטרך לקבל קישור הזמנה חדש אם ירצה לחזור.`
              : 'הדייר יוסר מרשימת הדיירים הפעילים ויצטרך לקבל קישור הזמנה חדש אם ירצה לחזור.'
          }
          confirmLabel={isRemovingRoommate ? 'מסיר...' : 'הסרה'}
          cancelLabel="ביטול"
          onConfirm={() => void confirmRemoveRoommate()}
          onCancel={() => {
            if (isRemovingRoommate) return
            setRoommateToRemove(null)
          }}
        />
      ) : null}
    </div>
  )
}
