import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Card } from '../../components/Card'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import {
  createApartmentInfoItemViaApi,
  deleteApartmentInfoItemViaApi,
  listApartmentInfoViaApi,
  updateApartmentInfoItemViaApi,
} from '../../data/server/apartmentInfoApi'
import { useApartmentInfoStore } from '../../data/repositories/apartmentInfoRepository'
import { useApartment } from '../../context/ApartmentContext'
import { useAuth } from '../../context/AuthContext'
import { isSupabaseConfigured } from '../../lib/supabase/env'
import { appRoutes } from '../../routes/paths'
import type { ApartmentInfoAttachment, ApartmentInfoItem } from '../../types/models'

interface ApartmentInfoFormState {
  title: string
  categoryLabel: string
  provider: string
  meterNumber: string
  accountNumber: string
  phone: string
  notes: string
}

const initialFormState: ApartmentInfoFormState = {
  title: '',
  categoryLabel: '',
  provider: '',
  meterNumber: '',
  accountNumber: '',
  phone: '',
  notes: '',
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

function createFormState(item?: ApartmentInfoItem | null): ApartmentInfoFormState {
  if (!item) return initialFormState

  return {
    title: item.title,
    categoryLabel: item.category_label ?? '',
    provider: item.provider ?? '',
    meterNumber: item.meter_number ?? '',
    accountNumber: item.account_number ?? '',
    phone: item.phone ?? '',
    notes: item.notes ?? '',
  }
}

function formatDate(date: string) {
  return new Intl.DateTimeFormat('he-IL', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(date))
}

export function ApartmentInfoPage() {
  const { user } = useAuth()
  const { current } = useApartment()
  const canManageApartmentInfo =
    user?.role === 'admin' || user?.role === 'tenant' || user?.role === 'landlord'
  const apartmentId = current?.apartment.id ?? 0
  const [items, setItems] = useApartmentInfoStore()
  const [isEditorOpen, setIsEditorOpen] = useState(false)
  const [editingItem, setEditingItem] = useState<ApartmentInfoItem | null>(null)
  const [selectedItem, setSelectedItem] = useState<ApartmentInfoItem | null>(null)
  const [itemToDelete, setItemToDelete] = useState<ApartmentInfoItem | null>(null)
  const [form, setForm] = useState<ApartmentInfoFormState>(initialFormState)
  const [attachments, setAttachments] = useState<ApartmentInfoAttachment[]>([])
  const [error, setError] = useState('')
  const [fieldError, setFieldError] = useState('')
  const [detailsError, setDetailsError] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const loadedApartmentIdRef = useRef<number | null>(null)

  useEffect(() => {
    let cancelled = false

    async function loadApartmentInfo() {
      if (!isSupabaseConfigured || !apartmentId) return
      if (loadedApartmentIdRef.current === apartmentId) return

      if (!cancelled) {
        setIsLoading(true)
      }

      try {
        const nextItems = await listApartmentInfoViaApi(apartmentId)
        if (!cancelled) {
          setItems(nextItems)
          loadedApartmentIdRef.current = apartmentId
        }
      } catch {
        if (!cancelled) {
          setItems([])
          loadedApartmentIdRef.current = null
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false)
        }
      }
    }

    void loadApartmentInfo()

    return () => {
      cancelled = true
    }
  }, [apartmentId, setItems])

  const apartmentItems = useMemo(
    () =>
      items
        .filter((item) => item.apartment_id === apartmentId)
        .sort((first, second) => second.updated_at.localeCompare(first.updated_at)),
    [apartmentId, items],
  )
  const isInitialLoading = isLoading && apartmentItems.length === 0

  function openCreate() {
    setEditingItem(null)
    setForm(initialFormState)
    setAttachments([])
    setFieldError('')
    setError('')
    setIsEditorOpen(true)
  }

  function openEdit(item: ApartmentInfoItem) {
    setSelectedItem(null)
    setEditingItem(item)
    setForm(createFormState(item))
    setAttachments(item.attachments)
    setFieldError('')
    setError('')
    setIsEditorOpen(true)
  }

  function closeEditor() {
    setIsEditorOpen(false)
    setEditingItem(null)
    setForm(initialFormState)
    setAttachments([])
    setFieldError('')
    setError('')
  }

  function closeDetails() {
    setSelectedItem(null)
  }

  async function onAttachmentChange(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? [])
    if (!files.length) return

    try {
      const nextAttachments = await Promise.all(
        files.map(async (file) => ({
          id: `${Date.now()}-${file.name}-${file.size}`,
          name: file.name,
          type: file.type || 'application/octet-stream',
          size: file.size,
          url: await readFileAsDataUrl(file),
        })),
      )

      setAttachments((currentAttachments) => [...currentAttachments, ...nextAttachments])
      event.target.value = ''
    } catch {
      setError('לא הצלחנו לשמור את הקבצים שבחרתם.')
    }
  }

  function removeAttachment(attachmentId: string) {
    setAttachments((currentAttachments) =>
      currentAttachments.filter((attachment) => attachment.id !== attachmentId),
    )
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')

    if (!form.title.trim()) {
      setFieldError('צריך להזין שם או כותרת לפריט.')
      return
    }

    setFieldError('')
    const normalizedInput = {
      apartmentId,
      title: form.title.trim(),
      categoryLabel: form.categoryLabel.trim() || null,
      provider: form.provider.trim() || null,
      meterNumber: form.meterNumber.trim() || null,
      accountNumber: form.accountNumber.trim() || null,
      phone: form.phone.trim() || null,
      notes: form.notes.trim() || null,
      attachments,
    }

    try {
      if (editingItem) {
        const updatedItem = isSupabaseConfigured
          ? await updateApartmentInfoItemViaApi({
              ...normalizedInput,
              itemId: editingItem.id,
            })
          : {
              ...editingItem,
              title: normalizedInput.title,
              category_label: normalizedInput.categoryLabel,
              provider: normalizedInput.provider,
              meter_number: normalizedInput.meterNumber,
              account_number: normalizedInput.accountNumber,
              phone: normalizedInput.phone,
              notes: normalizedInput.notes,
              attachments,
              updated_at: new Date().toISOString(),
            }

        if (updatedItem) {
          setItems((currentItems) =>
            currentItems.map((item) => (item.id === editingItem.id ? updatedItem : item)),
          )
          setSelectedItem(updatedItem)
        }
        closeEditor()
        return
      }

      const createdItem = isSupabaseConfigured
        ? await createApartmentInfoItemViaApi(normalizedInput)
        : {
            id: Date.now(),
            apartment_id: apartmentId,
            title: normalizedInput.title,
            category_label: normalizedInput.categoryLabel,
            provider: normalizedInput.provider,
            meter_number: normalizedInput.meterNumber,
            account_number: normalizedInput.accountNumber,
            phone: normalizedInput.phone,
            notes: normalizedInput.notes,
            attachments,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }

      if (createdItem) {
        setItems((currentItems) => [createdItem, ...currentItems])
      }
      closeEditor()
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'שמירת הפריט נכשלה.')
    }
  }

  async function confirmDelete() {
    if (!itemToDelete) return

    setDetailsError('')

    try {
      if (isSupabaseConfigured) {
        await deleteApartmentInfoItemViaApi(apartmentId, itemToDelete.id)
      }

      setItems((currentItems) => currentItems.filter((item) => item.id !== itemToDelete.id))
      if (selectedItem?.id === itemToDelete.id) setSelectedItem(null)
      setItemToDelete(null)
    } catch (deleteError) {
      setDetailsError(deleteError instanceof Error ? deleteError.message : 'מחיקת הפריט נכשלה.')
      setItemToDelete(null)
    }
  }

  if (isInitialLoading) {
    return (
      <div className="page apartment-info-page">
        {canManageApartmentInfo ? (
          <div className="apartment-info-toolbar">
            <button
              type="button"
              className="btn btn--primary apartment-info-toolbar__action"
              onClick={openCreate}
            >
              הוסף מידע חדש
            </button>
          </div>
        ) : null}

        <Card title="מאגר המידע של הדירה">
          <p className="muted apartment-info-summary">טוען את המידע של הדירה...</p>
          <div className="apartment-info-empty">
            <strong>טוען פריטים...</strong>
          </div>
        </Card>

        <div className="apartment-info-back">
          <Link to={appRoutes.roommates} className="link">
            חזרה לניהול הדירה
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="page apartment-info-page">
      {canManageApartmentInfo ? (
        <div className="apartment-info-toolbar">
          <button
            type="button"
            className="btn btn--primary apartment-info-toolbar__action"
            onClick={openCreate}
          >
            הוסף מידע חדש
          </button>
        </div>
      ) : null}

      <Card title="מאגר המידע של הדירה">
        <p className="muted apartment-info-summary">
          {apartmentItems.length > 0
            ? `${apartmentItems.length} פריטים נשמרו לדירה הזו`
            : 'המאגר עדיין ריק'}
        </p>
        {apartmentItems.length === 0 ? (
          <div className="apartment-info-empty">
            <strong>עדיין לא נשמר מידע כללי לדירה.</strong>
          </div>
        ) : (
          <ul className="apartment-info-list">
            {apartmentItems.map((item) => (
              <li key={item.id} className="apartment-info-list__item">
                <button
                  type="button"
                  className="apartment-info-item"
                  onClick={() => setSelectedItem(item)}
                >
                  <div className="apartment-info-item__head">
                    <div className="apartment-info-item__main">
                      <div className="apartment-info-item__title-row">
                        <h2>{item.title}</h2>
                        {item.category_label ? (
                          <span className="chip chip--muted">{item.category_label}</span>
                        ) : null}
                      </div>
                      <p className="apartment-info-item__meta">
                        עודכן לאחרונה ב־{formatDate(item.updated_at)}
                      </p>
                    </div>
                  </div>

                  <div className="apartment-info-item__details">
                    {item.provider ? (
                      <div className="apartment-info-item__detail">
                        <span>ספק / חברה</span>
                        <strong>{item.provider}</strong>
                      </div>
                    ) : null}
                    {item.meter_number ? (
                      <div className="apartment-info-item__detail">
                        <span>מספר מונה</span>
                        <strong>{item.meter_number}</strong>
                      </div>
                    ) : null}
                    {item.account_number ? (
                      <div className="apartment-info-item__detail">
                        <span>מספר לקוח / חשבון</span>
                        <strong>{item.account_number}</strong>
                      </div>
                    ) : null}
                    {item.phone ? (
                      <div className="apartment-info-item__detail">
                        <span>טלפון</span>
                        <strong dir="ltr">{item.phone}</strong>
                      </div>
                    ) : null}
                  </div>

                  {item.notes ? (
                    <p className="apartment-info-item__notes">{item.notes}</p>
                  ) : null}

                  <div className="apartment-info-item__footer">
                    <span className="apartment-info-item__open">לחצו לצפייה בפרטים</span>
                    {item.attachments.length > 0 ? (
                      <span className="apartment-info-item__files">
                        {item.attachments.length} קבצים
                      </span>
                    ) : null}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <div className="apartment-info-back">
        <Link to={appRoutes.roommates} className="link">
          חזרה לניהול הדירה
        </Link>
      </div>

      {canManageApartmentInfo && isEditorOpen ? (
        <div className="modal-backdrop" role="presentation">
          <section
            className="roommate-modal card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="apartment-info-editor-title"
          >
            <div className="roommate-modal__head">
              <div>
                <p className="tickets-hero__eyebrow">מידע לדירה</p>
                <h2 id="apartment-info-editor-title">
                  {editingItem ? 'עריכת פריט' : 'פריט חדש לדירה'}
                </h2>
                <p>שומרים כאן פריט מידע מסודר ונגיש לכל הדיירים.</p>
              </div>
              <button type="button" className="btn-text" onClick={closeEditor}>
                סגירה
              </button>
            </div>

            <form className="roommate-form apartment-info-form" onSubmit={onSubmit} noValidate>
              <label className="field">
                <span className="field__label">שם / כותרת</span>
                <input
                  className="field__input"
                  type="text"
                  value={form.title}
                  onChange={(event) =>
                    setForm((currentForm) => ({ ...currentForm, title: event.target.value }))
                  }
                  placeholder="למשל: חוזה דירה, חשבון חשמל, ספק אינטרנט"
                />
                {fieldError ? <span className="field__error">{fieldError}</span> : null}
              </label>

              <div className="apartment-info-form__grid">
                <label className="field">
                  <span className="field__label">קטגוריה / סוג</span>
                  <input
                    className="field__input"
                    type="text"
                    value={form.categoryLabel}
                    onChange={(event) =>
                      setForm((currentForm) => ({
                        ...currentForm,
                        categoryLabel: event.target.value,
                      }))
                    }
                    placeholder="למשל: תשתיות, מסמכים, אנשי קשר"
                  />
                </label>
                <label className="field">
                  <span className="field__label">ספק / חברה</span>
                  <input
                    className="field__input"
                    type="text"
                    value={form.provider}
                    onChange={(event) =>
                      setForm((currentForm) => ({ ...currentForm, provider: event.target.value }))
                    }
                    placeholder="שם החברה או הגוף הרלוונטי"
                  />
                </label>
                <label className="field">
                  <span className="field__label">מספר מונה</span>
                  <input
                    className="field__input"
                    type="text"
                    value={form.meterNumber}
                    onChange={(event) =>
                      setForm((currentForm) => ({
                        ...currentForm,
                        meterNumber: event.target.value,
                      }))
                    }
                    placeholder="אם קיים"
                  />
                </label>
                <label className="field">
                  <span className="field__label">מספר לקוח / חשבון</span>
                  <input
                    className="field__input"
                    type="text"
                    value={form.accountNumber}
                    onChange={(event) =>
                      setForm((currentForm) => ({
                        ...currentForm,
                        accountNumber: event.target.value,
                      }))
                    }
                    placeholder="אם קיים"
                  />
                </label>
                <label className="field">
                  <span className="field__label">טלפון / איש קשר</span>
                  <input
                    className="field__input"
                    type="text"
                    dir="ltr"
                    value={form.phone}
                    onChange={(event) =>
                      setForm((currentForm) => ({ ...currentForm, phone: event.target.value }))
                    }
                    placeholder="מספר טלפון או מוקד"
                  />
                </label>
              </div>

              <label className="field">
                <span className="field__label">הערות</span>
                <textarea
                  className="field__input apartment-info-form__textarea"
                  value={form.notes}
                  onChange={(event) =>
                    setForm((currentForm) => ({ ...currentForm, notes: event.target.value }))
                  }
                  placeholder="כל פרט נוסף שחשוב לשמור לדירה"
                />
              </label>

              <label className="field">
                <span className="field__label">תמונות / קבצים קשורים</span>
                <input
                  className="field__input"
                  type="file"
                  accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx,.txt"
                  multiple
                  onChange={onAttachmentChange}
                />
              </label>

              {attachments.length > 0 ? (
                <div className="expense-form__attachments">
                  <span>קבצים שנשמרו לפריט</span>
                  <ul>
                    {attachments.map((attachment) => (
                      <li key={attachment.id}>
                        <button
                          type="button"
                          className="btn-text"
                          onClick={() => removeAttachment(attachment.id)}
                        >
                          הסרה
                        </button>{' '}
                        {attachment.name}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {error ? <p className="form-message form-message--error">{error}</p> : null}

              <div className="roommate-form__actions">
                <button type="button" className="btn btn--secondary" onClick={closeEditor}>
                  ביטול
                </button>
                <button type="submit" className="btn btn--primary">
                  {editingItem ? 'שמירת שינויים' : 'שמירת פריט'}
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}

      {selectedItem ? (
        <div className="modal-backdrop" role="presentation">
          <section
            className="roommate-modal card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="apartment-info-details-title"
          >
            <div className="roommate-modal__head">
              <div>
                <p className="tickets-hero__eyebrow">פרטי מידע</p>
                <h2 id="apartment-info-details-title">{selectedItem.title}</h2>
                <p>עודכן לאחרונה ב־{formatDate(selectedItem.updated_at)}</p>
              </div>
              <button type="button" className="btn-text" onClick={closeDetails}>
                סגירה
              </button>
            </div>

            <div className="expense-detail">
              <div className="expense-detail__facts">
                {selectedItem.category_label ? (
                  <div>
                    <span>קטגוריה</span>
                    <strong>{selectedItem.category_label}</strong>
                  </div>
                ) : null}
                {selectedItem.provider ? (
                  <div>
                    <span>ספק / חברה</span>
                    <strong>{selectedItem.provider}</strong>
                  </div>
                ) : null}
                {selectedItem.meter_number ? (
                  <div>
                    <span>מספר מונה</span>
                    <strong>{selectedItem.meter_number}</strong>
                  </div>
                ) : null}
                {selectedItem.account_number ? (
                  <div>
                    <span>מספר לקוח / חשבון</span>
                    <strong>{selectedItem.account_number}</strong>
                  </div>
                ) : null}
                {selectedItem.phone ? (
                  <div>
                    <span>טלפון</span>
                    <strong dir="ltr">{selectedItem.phone}</strong>
                  </div>
                ) : null}
              </div>

              {selectedItem.notes ? (
                <div>
                  <h3>הערות</h3>
                  <p className="apartment-info-item__notes apartment-info-item__notes--detail">
                    {selectedItem.notes}
                  </p>
                </div>
              ) : null}

              {selectedItem.attachments.length > 0 ? (
                <div className="apartment-info-item__attachments apartment-info-item__attachments--detail">
                  <span>קבצים ותמונות</span>
                  <ul>
                    {selectedItem.attachments.map((attachment) => (
                      <li key={attachment.id}>
                        <a href={attachment.url} target="_blank" rel="noreferrer">
                          {attachment.name}
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {detailsError ? <p className="form-message form-message--error">{detailsError}</p> : null}

              {canManageApartmentInfo ? (
                <div className="expense-form__actions">
                  <button
                    type="button"
                    className="btn btn--secondary"
                    onClick={() => openEdit(selectedItem)}
                  >
                    עריכה
                  </button>
                  <button
                    type="button"
                    className="btn btn--danger"
                    onClick={() => setItemToDelete(selectedItem)}
                  >
                    מחיקה
                  </button>
                </div>
              ) : null}
            </div>
          </section>
        </div>
      ) : null}

      {canManageApartmentInfo && itemToDelete ? (
        <ConfirmDialog
          title="למחוק את הפריט הזה?"
          message={`${itemToDelete.title} יוסר ממאגר המידע של הדירה.`}
          confirmLabel="כן, למחוק"
          cancelLabel="לא עכשיו"
          onCancel={() => setItemToDelete(null)}
          onConfirm={confirmDelete}
        />
      ) : null}
    </div>
  )
}
