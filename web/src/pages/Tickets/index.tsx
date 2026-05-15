import { useState, type ChangeEvent, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Card } from '../../components/Card'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { TicketStatusActionChip, TicketStatusChip, ticketLabels } from '../../components/StatusChip'
import { useAuth } from '../../context/AuthContext'
import { useApartment } from '../../context/ApartmentContext'
import {
  useTickets,
  type TicketAttachment,
} from '../../context/TicketsContext'
import { ticketDetailsPath } from '../../routes/paths'
import type { TicketCategory, TicketStatus } from '../../types/models'

interface TicketFormState {
  title: string
  description: string
  category: TicketCategory
}

const ticketCategoryOptions: TicketCategory[] = ['תקלה', 'בקשה', 'כספים', 'אחר']

const initialTicketForm: TicketFormState = {
  title: '',
  description: '',
  category: 'תקלה',
}

const ticketStatusOptions: { value: TicketStatus; label: string }[] = [
  { value: 'open', label: ticketLabels.open },
  { value: 'sent_to_landlord', label: ticketLabels.sent_to_landlord },
  { value: 'in_progress', label: ticketLabels.in_progress },
  { value: 'closed', label: ticketLabels.closed },
  { value: 'cancelled', label: ticketLabels.cancelled },
]

function formatTicketDate(value: string) {
  return new Intl.DateTimeFormat('he-IL', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(value))
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

export function TicketsPage() {
  const { user } = useAuth()
  const { tickets, addTicket, deleteTicket, updateTicketStatus } = useTickets()
  const { current } = useApartment()
  const [isTicketModalOpen, setIsTicketModalOpen] = useState(false)
  const [ticketToDelete, setTicketToDelete] = useState<number | null>(null)
  const [ticketForm, setTicketForm] = useState<TicketFormState>(initialTicketForm)
  const [attachments, setAttachments] = useState<TicketAttachment[]>([])
  const [formError, setFormError] = useState('')
  const [listError, setListError] = useState('')
  const [openStatusTicketId, setOpenStatusTicketId] = useState<number | null>(null)
  const isLandlord = user?.role === 'landlord'
  const apartmentId = current?.apartment.id ?? 0
  const scopedTickets = tickets.filter((ticket) => ticket.apartment_id === apartmentId)

  function updateTicketForm(field: keyof TicketFormState, value: string) {
    setTicketForm((currentForm) => ({ ...currentForm, [field]: value }))
  }

  function closeTicketModal() {
    setIsTicketModalOpen(false)
    setTicketForm(initialTicketForm)
    setAttachments([])
    setFormError('')
  }

  async function handleAttachmentChange(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? [])
    if (!files.length) return

    try {
      const selectedAttachments = await Promise.all(
        files.map(async (file) => ({
          id: `${Date.now()}-${file.name}-${file.size}`,
          name: file.name,
          type: file.type || 'application/octet-stream',
          size: file.size,
          url: await readFileAsDataUrl(file),
        })),
      )

      setAttachments(selectedAttachments)
      event.target.value = ''
    } catch {
      setFormError('לא הצלחנו לשמור את הקבצים שבחרת.')
    }
  }

  async function handleAddTicket(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFormError('')

    if (!ticketForm.title.trim()) {
      setFormError('צריך לתת לפנייה כותרת קצרה וברורה.')
      return
    }

    if (!ticketForm.description.trim()) {
      setFormError('צריך להוסיף תיאור קצר כדי שיהיה ברור מה צריך טיפול.')
      return
    }

    try {
      await addTicket({
        title: ticketForm.title.trim(),
        description: ticketForm.description.trim(),
        category: ticketForm.category,
        createdBy: user?.id ?? 0,
        apartmentId,
        attachments,
      })
      closeTicketModal()
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'שמירת הפנייה נכשלה.')
    }
  }

  async function confirmDeleteTicket() {
    if (ticketToDelete == null) return
    setListError('')

    try {
      await deleteTicket(ticketToDelete)
      setTicketToDelete(null)
    } catch (error) {
      setListError(error instanceof Error ? error.message : 'מחיקת הפנייה נכשלה.')
      setTicketToDelete(null)
    }
  }

  async function handleInlineStatusChange(ticketId: number, status: TicketStatus) {
    setListError('')

    try {
      await updateTicketStatus(ticketId, status)
    } catch (error) {
      setListError(error instanceof Error ? error.message : 'עדכון הסטטוס נכשל.')
    } finally {
      setOpenStatusTicketId(null)
    }
  }

  function renderStatusMenu(ticketId: number, status: TicketStatus) {
    const isOpen = openStatusTicketId === ticketId

    return (
      <div className="inline-status-menu" onClick={(event) => event.stopPropagation()}>
        <TicketStatusActionChip
          status={status}
          onClick={() =>
            setOpenStatusTicketId((currentId) => (currentId === ticketId ? null : ticketId))
          }
        />
        {isOpen ? (
          <div className="inline-status-menu__panel">
            {ticketStatusOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                className={`inline-status-menu__option${
                  option.value === status ? ' inline-status-menu__option--active' : ''
                }`}
                onClick={() => void handleInlineStatusChange(ticketId, option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    )
  }

  return (
    <div className="page tickets-page">
      <div className="page__head tickets-hero">
        {isLandlord ? null : (
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => setIsTicketModalOpen(true)}
          >
            + פנייה חדשה
          </button>
        )}
      </div>

      <Card title="רשימת פניות" className="status-menu-card">
        {listError ? <p className="form-message form-message--error">{listError}</p> : null}
        <ul className="ticket-list ticket-list--cards">
          {scopedTickets.map((ticket) => (
            <li key={ticket.id} className="ticket-list__item">
              <div className="ticket-item-card">
                <Link
                  to={ticketDetailsPath(ticket.id)}
                  className="ticket-list__link"
                  aria-label={`פתיחת הפנייה: ${ticket.title}`}
                >
                  <div className="ticket-list__main">
                    <div className="ticket-list__title">{ticket.title}</div>
                    <p className="ticket-item-card__preview">{ticket.description}</p>
                    <div className="ticket-list__meta ticket-item-card__meta">
                      <span>נפתחה: {formatTicketDate(ticket.created_at)}</span>
                      {ticket.attachments.length > 0 ? (
                        <span>{ticket.attachments.length} קבצים מצורפים</span>
                      ) : null}
                    </div>
                  </div>
                </Link>
                <div className="ticket-item-card__status">
                  {isLandlord ? renderStatusMenu(ticket.id, ticket.status) : <TicketStatusChip status={ticket.status} />}
                </div>
                {isLandlord ? null : (
                  <div className="payment-form__actions">
                    <button
                      type="button"
                      className="btn-text btn-text--danger"
                      onClick={() => setTicketToDelete(ticket.id)}
                    >
                      מחיקה
                    </button>
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      </Card>

      {isTicketModalOpen && !isLandlord ? (
        <div className="modal-backdrop" role="presentation">
          <section
            className="ticket-modal card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="add-ticket-title"
          >
            <div className="ticket-modal__head">
              <div>
                <p className="tickets-hero__eyebrow">פנייה חדשה</p>
                <h2 id="add-ticket-title">במה צריך לטפל?</h2>
                <p>הפנייה תופיע מיד ברשימת הפניות של הדירה.</p>
              </div>
              <button type="button" className="btn-text" onClick={closeTicketModal}>
                סגירה
              </button>
            </div>

            <form className="ticket-form" onSubmit={handleAddTicket} noValidate>
              <label className="field">
                <span className="field__label">כותרת הפנייה</span>
                <input
                  className="field__input"
                  value={ticketForm.title}
                  onChange={(event) => updateTicketForm('title', event.target.value)}
                  placeholder="לדוגמה: נזילה במקלחת"
                />
              </label>

              <label className="field">
                <span className="field__label">תיאור</span>
                <textarea
                  className="field__input ticket-form__textarea"
                  value={ticketForm.description}
                  onChange={(event) => updateTicketForm('description', event.target.value)}
                  placeholder="כתבו בקצרה מה קרה ומה צריך לבדוק"
                />
              </label>

              <label className="field">
                <span className="field__label">קטגוריה</span>
                <select
                  className="field__input"
                  value={ticketForm.category}
                  onChange={(event) =>
                    updateTicketForm('category', event.target.value as TicketCategory)
                  }
                >
                  {ticketCategoryOptions.map((category) => (
                    <option key={category} value={category}>
                      {category}
                    </option>
                  ))}
                </select>
              </label>

              <label className="field">
                <span className="field__label">קבצים מצורפים (אופציונלי)</span>
                <input
                  className="field__input"
                  type="file"
                  multiple
                  accept="image/*,video/*,.pdf,.doc,.docx,.xls,.xlsx,.txt"
                  onChange={handleAttachmentChange}
                />
              </label>

              {attachments.length > 0 ? (
                <div className="ticket-form__attachments">
                  <span>קבצים שנבחרו:</span>
                  <ul>
                    {attachments.map((attachment) => (
                      <li key={attachment.id}>{attachment.name}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {formError ? (
                <p className="form-message form-message--error">{formError}</p>
              ) : null}

              <div className="ticket-form__actions">
                <button
                  type="button"
                  className="btn btn--secondary"
                  onClick={closeTicketModal}
                >
                  ביטול
                </button>
                <button type="submit" className="btn btn--primary">
                  שמירת פנייה
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}

      {ticketToDelete != null ? (
        <ConfirmDialog
          title="למחוק את הפנייה?"
          message="הפנייה תוסר מרשימת הפניות ולא תהיה זמינה עוד."
          confirmLabel="מחיקה"
          cancelLabel="ביטול"
          onConfirm={confirmDeleteTicket}
          onCancel={() => setTicketToDelete(null)}
        />
      ) : null}
    </div>
  )
}
