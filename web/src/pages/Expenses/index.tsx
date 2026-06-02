import { useMemo, useState, type ChangeEvent, type FormEvent } from 'react'
import { Card } from '../../components/Card'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { useApartment } from '../../context/ApartmentContext'
import { useExpenses } from '../../context/ExpensesContext'
import type { Expense, ExpenseAttachment, User } from '../../types/models'
import { openAttachment } from '../../utils/attachments'

const allCategories = 'כל הקטגוריות'
const allMonths = 'all'
const expenseCategoryOptions = ['חשבונות', 'מזון', 'ניקיון', 'תחזוקה', 'אחר']

interface ExpenseFormState {
  description: string
  amount: string
  category: string
  date: string
  paidBy: string
  participantIds: number[]
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

function createInitialFormState(roommates: User[]): ExpenseFormState {
  const fallbackPayerId = roommates[0]?.id ?? 0

  return {
    description: '',
    amount: '',
    category: 'חשבונות',
    date: new Date().toISOString().slice(0, 10),
    paidBy: fallbackPayerId ? String(fallbackPayerId) : '',
    participantIds: roommates.map((user) => user.id),
  }
}

function buildFormFromExpense(expense: Expense): ExpenseFormState {
  return {
    description: expense.description,
    amount: String(Number(expense.amount)),
    category: expense.category ?? '',
    date: expense.date,
    paidBy: String(expense.paid_by),
    participantIds: [...expense.participant_ids],
  }
}

function formatCurrency(value: string | number) {
  return new Intl.NumberFormat('he-IL', {
    style: 'currency',
    currency: 'ILS',
    maximumFractionDigits: 2,
  }).format(Number(value))
}

function formatDate(date: string) {
  return new Intl.DateTimeFormat('he-IL', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  }).format(new Date(date))
}

function monthLabel(month: string) {
  return new Intl.DateTimeFormat('he-IL', {
    month: 'long',
    year: 'numeric',
  }).format(new Date(`${month}-01T00:00:00`))
}

function getMonth(date: string) {
  return date.slice(0, 7)
}

function calculateShare(expense: Expense) {
  const participants = Math.max(expense.participant_ids.length, 1)
  return Number(expense.amount) / participants
}

export function ExpensesPage() {
  const { current } = useApartment()
  const apartmentId = current?.apartment.id ?? 0
  const roommates = useMemo(
    () => (current?.roommates ?? []).filter((roommate) => roommate.status === 'active'),
    [current],
  )
  const userNameById = useMemo(
    () => new Map(roommates.map((roommate) => [roommate.id, roommate.name])),
    [roommates],
  )
  const { expenses, addExpense, updateExpense, deleteExpense } = useExpenses()

  const [monthFilter, setMonthFilter] = useState(new Date().toISOString().slice(0, 7))
  const [categoryFilter, setCategoryFilter] = useState(allCategories)
  const [isAddOpen, setIsAddOpen] = useState(false)
  const [selectedExpense, setSelectedExpense] = useState<Expense | null>(null)
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null)
  const [expenseToDelete, setExpenseToDelete] = useState<Expense | null>(null)
  const [form, setForm] = useState<ExpenseFormState>(() => createInitialFormState(roommates))
  const [attachments, setAttachments] = useState<ExpenseAttachment[]>([])
  const [formError, setFormError] = useState('')

  const activeExpenses = expenses.filter(
    (expense) => expense.status === 'active' && expense.apartment_id === apartmentId,
  )
  const monthOptions = Array.from(new Set(activeExpenses.map((expense) => getMonth(expense.date)))).sort(
    (first, second) => second.localeCompare(first),
  )
  const categoryOptions = Array.from(
    new Set(
      activeExpenses
        .map((expense) => expense.category)
        .filter((category): category is string => Boolean(category)),
    ),
  ).sort((first, second) => first.localeCompare(second, 'he'))

  const scopedExpenses =
    monthFilter === allMonths
      ? activeExpenses
      : activeExpenses.filter((expense) => getMonth(expense.date) === monthFilter)

  const filteredExpenses = scopedExpenses.filter((expense) => {
    const matchesCategory = categoryFilter === allCategories || expense.category === categoryFilter
    return matchesCategory
  })

  const monthlyTotal = scopedExpenses.reduce((sum, expense) => sum + Number(expense.amount), 0)
  const filteredTotal = filteredExpenses.reduce((sum, expense) => sum + Number(expense.amount), 0)
  const averageExpense = scopedExpenses.length > 0 ? monthlyTotal / scopedExpenses.length : 0

  const totalsByUser = scopedExpenses.reduce<Record<number, number>>(
    (totals, expense) => ({
      ...totals,
      [expense.paid_by]: (totals[expense.paid_by] ?? 0) + Number(expense.amount),
    }),
    {},
  )

  const [topPayerId, topPayerTotal] =
    Object.entries(totalsByUser).sort((a, b) => Number(b[1]) - Number(a[1]))[0] ?? []
  const topPayer =
    topPayerId && topPayerTotal
      ? {
          name: userNameById.get(Number(topPayerId)) ?? 'לא ידוע',
          total: Number(topPayerTotal),
        }
      : null

  function updateForm(field: keyof ExpenseFormState, value: string | number[]) {
    setForm((currentForm) => ({ ...currentForm, [field]: value }))
  }

  function toggleParticipant(userId: number) {
    setForm((currentForm) => {
      const exists = currentForm.participantIds.includes(userId)
      const participantIds = exists
        ? currentForm.participantIds.filter((id) => id !== userId)
        : [...currentForm.participantIds, userId]

      return { ...currentForm, participantIds }
    })
  }

  function openAddModal() {
    setEditingExpense(null)
    setForm(createInitialFormState(roommates))
    setAttachments([])
    setFormError('')
    setIsAddOpen(true)
  }

  function openEditModal(expense: Expense) {
    setSelectedExpense(null)
    setEditingExpense(expense)
    setForm(buildFormFromExpense(expense))
    setAttachments(expense.attachments ?? [])
    setFormError('')
    setIsAddOpen(true)
  }

  function closeAddModal() {
    setIsAddOpen(false)
    setEditingExpense(null)
    setForm(createInitialFormState(roommates))
    setAttachments([])
    setFormError('')
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
      setFormError('לא הצלחנו לצרף את הקבצים שנבחרו.')
    }
  }

  function removeAttachment(attachmentId: string) {
    setAttachments((currentAttachments) =>
      currentAttachments.filter((attachment) => attachment.id !== attachmentId),
    )
  }

  function handleOpenAttachment(attachment: ExpenseAttachment) {
    try {
      openAttachment(attachment.url, attachment.name)
    } catch {
      setFormError('לא הצלחנו לפתוח את הקובץ המצורף.')
    }
  }

  async function confirmDeleteExpense() {
    if (!expenseToDelete) return

    await deleteExpense(expenseToDelete.id)
    if (selectedExpense?.id === expenseToDelete.id) setSelectedExpense(null)
    if (editingExpense?.id === expenseToDelete.id) closeAddModal()
    setExpenseToDelete(null)
  }

  async function handleAddExpense(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFormError('')

    const amount = Number(form.amount)
    if (!form.description.trim()) {
      setFormError('צריך להוסיף תיאור קצר להוצאה.')
      return
    }

    if (!Number.isFinite(amount) || amount <= 0) {
      setFormError('הסכום חייב להיות מספר חיובי.')
      return
    }

    if (!form.date) {
      setFormError('צריך לבחור תאריך להוצאה.')
      return
    }

    if (!form.paidBy) {
      setFormError('צריך לבחור מי שילם את ההוצאה.')
      return
    }

    if (form.participantIds.length === 0) {
      setFormError('צריך לבחור לפחות דייר אחד שמשתתף בהוצאה.')
      return
    }

    try {
      if (editingExpense) {
        const updatedExpense = await updateExpense(editingExpense.id, {
          paid_by: Number(form.paidBy),
          amount: amount.toFixed(2),
          description: form.description.trim(),
          category: form.category.trim() || null,
          date: form.date,
          participant_ids: form.participantIds,
          attachments,
        })

        if (updatedExpense) {
          setSelectedExpense(updatedExpense)
          setMonthFilter(getMonth(updatedExpense.date))
          if (updatedExpense.category) setCategoryFilter(updatedExpense.category)
        }
      } else {
        const nextExpense = await addExpense({
          apartment_id: apartmentId,
          paid_by: Number(form.paidBy),
          amount: amount.toFixed(2),
          description: form.description.trim(),
          category: form.category.trim() || null,
          date: form.date,
          participant_ids: form.participantIds,
          attachments,
        })

        if (nextExpense) {
          setMonthFilter(getMonth(nextExpense.date))
          if (nextExpense.category) setCategoryFilter(nextExpense.category)
        }
      }
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'לא הצלחנו לשמור את ההוצאה.')
      return
    }

    closeAddModal()
  }

  return (
    <div className="page expenses-page">
      <div className="page__head expenses-hero">
        <button
          type="button"
          className="btn btn--primary expenses-hero__action"
          onClick={openAddModal}
        >
          + הוצאה חדשה
        </button>
      </div>

      <section className="expenses-summary" aria-label="סיכום הוצאות">
        <Card className="expenses-summary__main">
          <p className="expenses-summary__label">
            {monthFilter === allMonths
              ? 'סה"כ הוצאות בכל החודשים'
              : `סה"כ הוצאות ב${monthLabel(monthFilter)}`}
          </p>
          <p className="expenses-summary__amount">{formatCurrency(monthlyTotal)}</p>
          <p className="expenses-summary__hint">
            {scopedExpenses.length}{' '}
            {monthFilter === allMonths ? 'הוצאות פעילות בכלל התקופה' : 'הוצאות פעילות בחודש הנבחר'}
          </p>
        </Card>

        <div className="expenses-summary__grid">
          <Card>
            <p className="expenses-mini-stat__label">ממוצע להוצאה</p>
            <p className="expenses-mini-stat__value">{formatCurrency(averageExpense)}</p>
          </Card>
          <Card>
            <p className="expenses-mini-stat__label">שילם הכי הרבה</p>
            <p className="expenses-mini-stat__value">{topPayer?.name ?? 'אין נתונים'}</p>
            {topPayer ? <p className="expenses-mini-stat__hint">{formatCurrency(topPayer.total)}</p> : null}
          </Card>
        </div>
      </section>

      <Card title="רשימת הוצאות">
        <div className="expenses-filters expenses-filters--inline">
          <label className="field">
            <span className="field__label">חודש</span>
            <select className="field__input" value={monthFilter} onChange={(event) => setMonthFilter(event.target.value)}>
              <option value={allMonths}>הכל</option>
              {monthOptions.map((month) => (
                <option key={month} value={month}>
                  {monthLabel(month)}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span className="field__label">קטגוריה</span>
            <select className="field__input" value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}>
              <option value={allCategories}>{allCategories}</option>
              {categoryOptions.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
          </label>
        </div>

        <p className="expenses-filter-note">
          מוצגות {filteredExpenses.length} הוצאות בסכום כולל של <strong>{formatCurrency(filteredTotal)}</strong>.
        </p>

        {filteredExpenses.length === 0 ? (
          <div className="expenses-empty">
            <p className="expenses-empty__title">אין הוצאות שמתאימות לסינון.</p>
            <p className="muted">אפשר לשנות חודש או קטגוריה, או להוסיף הוצאה חדשה.</p>
          </div>
        ) : (
          <ul className="expense-list expense-list--cards">
            {filteredExpenses.map((expense) => {
              const payerName = userNameById.get(expense.paid_by)

              return (
                <li key={expense.id} className="expense-list__item expense-item-card">
                  <button
                    type="button"
                    className="expense-item-card__button"
                    onClick={() => setSelectedExpense(expense)}
                  >
                    <span className="expense-item-card__main">
                      <span className="expense-list__title">{expense.description}</span>
                      <span className="expense-list__meta">
                        {formatDate(expense.date)}
                        {expense.category ? ` · ${expense.category}` : ''}
                        {payerName ? ` · שולם על ידי: ${payerName}` : ''}
                      </span>
                    </span>
                    <span className="expense-item-card__side">
                      <span className="expense-list__amount">{formatCurrency(expense.amount)}</span>
                      <span className="expense-item-card__share">
                        חלק לכל דייר: {formatCurrency(calculateShare(expense))}
                      </span>
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </Card>

      {isAddOpen ? (
        <div className="modal-backdrop" role="presentation">
          <section
            className="expense-modal card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="add-expense-title"
          >
            <div className="expense-modal__head">
              <div>
                <p className="expenses-hero__eyebrow">{editingExpense ? 'עריכת הוצאה' : 'הוצאה חדשה'}</p>
                <h2 id="add-expense-title">
                  {editingExpense ? 'עדכון פרטי ההוצאה' : 'מה שולם בדירה?'}
                </h2>
              </div>
              <button type="button" className="btn-text" onClick={closeAddModal}>
                סגירה
              </button>
            </div>

            <form className="expense-form" onSubmit={(event) => void handleAddExpense(event)} noValidate>
              <label className="field">
                <span className="field__label">תיאור ההוצאה</span>
                <input
                  className="field__input"
                  value={form.description}
                  onChange={(event) => updateForm('description', event.target.value)}
                />
              </label>

              <div className="expense-form__grid">
                <label className="field">
                  <span className="field__label">סכום</span>
                  <input
                    className="field__input"
                    type="number"
                    min="0"
                    step="0.01"
                    dir="ltr"
                    value={form.amount}
                    onChange={(event) => updateForm('amount', event.target.value)}
                  />
                </label>

                <label className="field">
                  <span className="field__label">תאריך</span>
                  <input
                    className="field__input"
                    type="date"
                    dir="ltr"
                    value={form.date}
                    onChange={(event) => updateForm('date', event.target.value)}
                  />
                </label>
              </div>

              <div className="expense-form__grid">
                <label className="field">
                  <span className="field__label">קטגוריה</span>
                  <select
                    className="field__input"
                    value={form.category}
                    onChange={(event) => updateForm('category', event.target.value)}
                  >
                    {expenseCategoryOptions.map((category) => (
                      <option key={category} value={category}>
                        {category}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="field">
                  <span className="field__label">מי שילם?</span>
                  <select
                    className="field__input"
                    value={form.paidBy}
                    onChange={(event) => updateForm('paidBy', event.target.value)}
                  >
                    {roommates.map((roommate) => (
                      <option key={roommate.id} value={roommate.id}>
                        {roommate.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <fieldset className="expense-participants">
                <legend>מי משתתף בחלוקה?</legend>
                <div className="expense-participants__grid">
                  {roommates.map((roommate) => (
                    <label key={roommate.id} className="expense-participants__option">
                      <input
                        type="checkbox"
                        checked={form.participantIds.includes(roommate.id)}
                        onChange={() => toggleParticipant(roommate.id)}
                      />
                      <span>{roommate.name}</span>
                    </label>
                  ))}
                </div>
              </fieldset>

              <div className="field">
                <span className="field__label">הוסף מסמך</span>
                <label className="ticket-form__attachments-picker">
                  <input
                    type="file"
                    accept=".pdf,image/*"
                    multiple
                    onChange={(event) => void onAttachmentChange(event)}
                  />
                  <span>בחרו קבלה, חשבון או מסמך נוסף</span>
                </label>
              </div>

              {attachments.length > 0 ? (
                <div className="ticket-form__attachments">
                  {attachments.map((attachment) => (
                    <div key={attachment.id} className="ticket-form__attachments-item">
                      <button
                        type="button"
                        className="btn-text"
                        onClick={() => handleOpenAttachment(attachment)}
                      >
                        {attachment.name}
                      </button>
                      <button
                        type="button"
                        className="btn-text btn-text--danger"
                        onClick={() => removeAttachment(attachment.id)}
                      >
                        הסר
                      </button>
                    </div>
                  ))}
                </div>
              ) : null}

              {formError ? <p className="form-message form-message--error">{formError}</p> : null}

              <div className="expense-form__actions">
                <button type="button" className="btn btn--secondary" onClick={closeAddModal}>
                  ביטול
                </button>
                <button type="submit" className="btn btn--primary">
                  {editingExpense ? 'שמירת שינויים' : 'שמירת הוצאה'}
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}

      {selectedExpense ? (
        <div className="modal-backdrop" role="presentation">
          <section
            className="expense-modal expense-modal--details card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="expense-details-title"
          >
            <div className="expense-modal__head">
              <div>
                <p className="expenses-hero__eyebrow">פרטי הוצאה</p>
                <h2 id="expense-details-title">{selectedExpense.description}</h2>
                <p>{formatDate(selectedExpense.date)}</p>
              </div>
              <button type="button" className="btn-text" onClick={() => setSelectedExpense(null)}>
                סגירה
              </button>
            </div>

            <div className="expense-detail">
              <div className="expense-detail__amount">
                <span>סכום ההוצאה</span>
                <strong>{formatCurrency(selectedExpense.amount)}</strong>
              </div>

              <div className="expense-detail__facts">
                <div>
                  <span>קטגוריה</span>
                  <strong>{selectedExpense.category ?? 'ללא קטגוריה'}</strong>
                </div>
                <div>
                  <span>שולם על ידי</span>
                  <strong>{userNameById.get(selectedExpense.paid_by) ?? 'לא ידוע'}</strong>
                </div>
                <div>
                  <span>משתתפים</span>
                  <strong>{selectedExpense.participant_ids.length} דיירים</strong>
                </div>
                <div>
                  <span>חלק לכל משתתף</span>
                  <strong>{formatCurrency(calculateShare(selectedExpense))}</strong>
                </div>
              </div>

              <div>
                <h3>דיירים שמשתתפים בהוצאה</h3>
                <ul className="expense-detail__participants">
                  {selectedExpense.participant_ids.map((userId) => (
                    <li key={userId}>{userNameById.get(userId) ?? 'דייר לא ידוע'}</li>
                  ))}
                </ul>
              </div>

              <div>
                <h3>מסמכים מצורפים</h3>
                {selectedExpense.attachments?.length ? (
                  <div className="ticket-form__attachments">
                    {selectedExpense.attachments.map((attachment) => (
                      <div key={attachment.id} className="ticket-form__attachments-item">
                        <button
                          type="button"
                          className="btn-text"
                          onClick={() => handleOpenAttachment(attachment)}
                        >
                          {attachment.name}
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="muted">לא צורפו מסמכים להוצאה הזו.</p>
                )}
              </div>

              <div className="expense-form__actions">
                <button
                  type="button"
                  className="btn btn--secondary"
                  onClick={() => openEditModal(selectedExpense)}
                >
                  עריכה
                </button>
                <button
                  type="button"
                  className="btn btn--danger"
                  onClick={() => setExpenseToDelete(selectedExpense)}
                >
                  מחיקה
                </button>
              </div>
            </div>
          </section>
        </div>
      ) : null}

      {expenseToDelete ? (
        <ConfirmDialog
          title="למחוק את ההוצאה?"
          message="ההוצאה תוסר מרשימת ההוצאות ולא תיכלל עוד בחישובי היתרות."
          confirmLabel="מחיקה"
          cancelLabel="ביטול"
          onConfirm={() => void confirmDeleteExpense()}
          onCancel={() => setExpenseToDelete(null)}
        />
      ) : null}
    </div>
  )
}
