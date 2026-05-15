import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Card } from '../../components/Card'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { TicketStatusActionChip, TicketStatusChip, ticketLabels } from '../../components/StatusChip'
import { useAuth } from '../../context/AuthContext'
import { useApartment } from '../../context/ApartmentContext'
import { useTickets } from '../../context/TicketsContext'
import { appRoutes } from '../../routes/paths'
import type { TicketCategory, TicketStatus } from '../../types/models'

interface TicketEditFormState {
  title: string
  description: string
  category: TicketCategory
}

const ticketCategoryOptions: TicketCategory[] = ['תקלה', 'בקשה', 'כספים', 'אחר']

const ticketStatusCycle: TicketStatus[] = [
  'open',
  'sent_to_landlord',
  'in_progress',
  'closed',
  'cancelled',
]

function formatTicketDateTime(value: string) {
  return new Intl.DateTimeFormat('he-IL', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

export function TicketDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const { current } = useApartment()
  const {
    getTicketById,
    addComment,
    updateTicket,
    deleteTicket,
    updateTicketStatus,
    getCommentsByTicketId,
  } = useTickets()
  const ticket = getTicketById(id)
  const apartmentId = current?.apartment.id ?? 0
  const [commentText, setCommentText] = useState('')
  const [commentError, setCommentError] = useState('')
  const [isEditOpen, setIsEditOpen] = useState(false)
  const [ticketToDelete, setTicketToDelete] = useState(false)
  const [editError, setEditError] = useState('')
  const [actionError, setActionError] = useState('')
  const [isStatusMenuOpen, setIsStatusMenuOpen] = useState(false)
  const isLandlord = user?.role === 'landlord'

  if (!ticket || ticket.apartment_id !== apartmentId) {
    return (
      <div className="page">
        <p>לא מצאנו את הפנייה הזו.</p>
        <Link to={appRoutes.tickets} className="link">
          חזרה לפניות
        </Link>
      </div>
    )
  }

  const currentTicket = ticket
  const [editForm, setEditForm] = useState<TicketEditFormState>({
    title: currentTicket.title,
    description: currentTicket.description,
    category: currentTicket.category ?? 'תקלה',
  })

  const knownUsers = [
    ...(current?.roommates ?? []),
    ...(current?.landlordUser ? [current.landlordUser] : []),
  ]
  const author = knownUsers.find((candidate) => candidate.id === currentTicket.created_by)
  const comments = getCommentsByTicketId(currentTicket.id)
  const ticketId = currentTicket.id

  async function handleCommentSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setCommentError('')

    if (!commentText.trim()) {
      setCommentError('צריך לכתוב עדכון קצר לפני השליחה.')
      return
    }

    try {
      await addComment(ticketId, user?.id ?? 0, commentText.trim())
      setCommentText('')
    } catch (error) {
      setCommentError(error instanceof Error ? error.message : 'שליחת העדכון נכשלה.')
    }
  }

  async function handleStatusChange(status: TicketStatus) {
    setActionError('')
    try {
      await updateTicketStatus(ticketId, status)
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'עדכון הסטטוס נכשל.')
    } finally {
      setIsStatusMenuOpen(false)
    }
  }

  function openEditModal() {
    setEditForm({
      title: currentTicket.title,
      description: currentTicket.description,
      category: currentTicket.category,
    })
    setEditError('')
    setIsEditOpen(true)
  }

  function closeEditModal() {
    setIsEditOpen(false)
    setEditError('')
  }

  async function handleEditSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setEditError('')

    if (!editForm.title.trim()) {
      setEditError('צריך לתת לפנייה כותרת קצרה וברורה.')
      return
    }

    if (!editForm.description.trim()) {
      setEditError('צריך להוסיף תיאור קצר כדי שיהיה ברור מה צריך טיפול.')
      return
    }

    try {
      await updateTicket(currentTicket.id, {
        title: editForm.title.trim(),
        description: editForm.description.trim(),
        category: editForm.category,
      })
      closeEditModal()
    } catch (error) {
      setEditError(error instanceof Error ? error.message : 'שמירת השינויים נכשלה.')
    }
  }

  async function confirmDeleteTicket() {
    setActionError('')
    try {
      await deleteTicket(currentTicket.id)
      navigate(appRoutes.tickets)
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'מחיקת הפנייה נכשלה.')
    }
  }

  return (
    <div className="page">
      <Link to={appRoutes.tickets} className="link back-link">
        חזרה לפניות
      </Link>
      <div className="page__head page__head--ticket">
        <h1 className="page__title">{currentTicket.title}</h1>
        <div className="ticket-status">
          {isLandlord ? (
            <div className="inline-status-menu">
              <TicketStatusActionChip
                status={currentTicket.status}
                onClick={() => setIsStatusMenuOpen((currentValue) => !currentValue)}
              />
              {isStatusMenuOpen ? (
                <div className="inline-status-menu__panel">
                  {ticketStatusCycle.map((status) => (
                    <button
                      key={status}
                      type="button"
                      className={`inline-status-menu__option${
                        status === currentTicket.status ? ' inline-status-menu__option--active' : ''
                      }`}
                      onClick={() => void handleStatusChange(status)}
                    >
                      {ticketLabels[status]}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : (
            <TicketStatusChip status={currentTicket.status} />
          )}
          {isLandlord ? <span className="ticket-status__hint">לחיצה על הסטטוס פותחת אפשרויות</span> : null}
        </div>
      </div>

      <Card
        title="פרטי הפנייה"
        action={
          isLandlord ? null : (
            <div className="roommate-actions">
              <button type="button" className="btn btn--secondary btn--small" onClick={openEditModal}>
                עריכה
              </button>
              <button
                type="button"
                className="btn btn--danger btn--small"
                onClick={() => setTicketToDelete(true)}
              >
                מחיקה
              </button>
            </div>
          )
        }
      >
        {actionError ? <p className="form-message form-message--error">{actionError}</p> : null}
        <p className="ticket-body">{currentTicket.description}</p>
        <div className="ticket-facts">
          <span>נפתחה על ידי: {author?.name ?? 'דייר'}</span>
          <span>נפתחה: {formatTicketDateTime(currentTicket.created_at)}</span>
        </div>
      </Card>

      <Card title="עדכונים ושיח">
        {comments.length === 0 ? (
          <p className="muted">אין עדכונים עדיין.</p>
        ) : (
          <ul className="comment-list">
            {comments.map((comment) => {
              const currentUser = knownUsers.find((candidate) => candidate.id === comment.user_id)
              return (
                <li key={comment.id} className="comment-list__item">
                  <div className="comment-list__meta">
                    {currentUser?.name} · {comment.created_at.replace('T', ' ').slice(0, 16)}
                  </div>
                  <p className="comment-list__text">{comment.comment_text}</p>
                </li>
              )
            })}
          </ul>
        )}
        {isLandlord ? (
          <form className="comment-form" onSubmit={handleCommentSubmit} noValidate>
            <label className="field">
              <span className="field__label">עדכון חדש</span>
              <textarea
                className="field__input comment-form__textarea"
                value={commentText}
                onChange={(event) => setCommentText(event.target.value)}
                placeholder="כתבו תגובה קצרה לדיירים"
              />
            </label>
            {commentError ? (
              <p className="form-message form-message--error">{commentError}</p>
            ) : null}
            <div className="comment-form__actions">
              <button type="submit" className="btn btn--primary">
                שליחת עדכון
              </button>
            </div>
          </form>
        ) : null}
      </Card>

      <Card title="קבצים מצורפים">
        {currentTicket.attachments.length === 0 ? (
          <p className="muted">לא צורפו קבצים לפנייה הזו.</p>
        ) : (
          <ul className="ticket-attachments">
            {currentTicket.attachments.map((attachment) => (
              <li key={attachment.id} className="ticket-attachments__item">
                <a href={attachment.url} target="_blank" rel="noreferrer">
                  {attachment.name}
                </a>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {isEditOpen ? (
        <div className="modal-backdrop" role="presentation">
          <section
            className="ticket-modal card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="edit-ticket-title"
          >
            <div className="ticket-modal__head">
              <div>
                <p className="tickets-hero__eyebrow">עריכת פנייה</p>
                <h2 id="edit-ticket-title">עדכון פרטי הפנייה</h2>
                <p>אפשר לעדכן כאן את הכותרת, התיאור והקטגוריה.</p>
              </div>
              <button type="button" className="btn-text" onClick={closeEditModal}>
                סגירה
              </button>
            </div>

            <form className="ticket-form" onSubmit={handleEditSubmit} noValidate>
              <label className="field">
                <span className="field__label">כותרת הפנייה</span>
                <input
                  className="field__input"
                  value={editForm.title}
                  onChange={(event) =>
                    setEditForm((currentForm) => ({ ...currentForm, title: event.target.value }))
                  }
                />
              </label>

              <label className="field">
                <span className="field__label">תיאור</span>
                <textarea
                  className="field__input ticket-form__textarea"
                  value={editForm.description}
                  onChange={(event) =>
                    setEditForm((currentForm) => ({
                      ...currentForm,
                      description: event.target.value,
                    }))
                  }
                />
              </label>

              <label className="field">
                <span className="field__label">קטגוריה</span>
                <select
                  className="field__input"
                  value={editForm.category}
                  onChange={(event) =>
                    setEditForm((currentForm) => ({
                      ...currentForm,
                      category: event.target.value as TicketCategory,
                    }))
                  }
                >
                  {ticketCategoryOptions.map((category) => (
                    <option key={category} value={category}>
                      {category}
                    </option>
                  ))}
                </select>
              </label>

              {editError ? <p className="form-message form-message--error">{editError}</p> : null}

              <div className="ticket-form__actions">
                <button type="button" className="btn btn--secondary" onClick={closeEditModal}>
                  ביטול
                </button>
                <button type="submit" className="btn btn--primary">
                  שמירת שינויים
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}

      {ticketToDelete ? (
        <ConfirmDialog
          title="למחוק את הפנייה?"
          message="הפנייה תוסר מרשימת הפניות ולא תהיה זמינה עוד."
          confirmLabel="מחיקה"
          cancelLabel="ביטול"
          onConfirm={confirmDeleteTicket}
          onCancel={() => setTicketToDelete(false)}
        />
      ) : null}
    </div>
  )
}
