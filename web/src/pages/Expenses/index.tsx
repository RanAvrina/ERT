import { useMemo, useState, type FormEvent } from 'react'
import { Card } from '../../components/Card'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { useApartment } from '../../context/ApartmentContext'
import { useExpenses } from '../../context/ExpensesContext'
import type { Expense, User } from '../../types/models'

const allCategories = 'כל הקטגוריות'

interface ExpenseFormState {
  description: string
  amount: string
  category: string
  date: string
  paidBy: string
  participantIds: number[]
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
  const getUserName = (userId: number) => userNameById.get(userId)
  const { expenses, addExpense, updateExpense, deleteExpense } = useExpenses()
  const [monthFilter, setMonthFilter] = useState(new Date().toISOString().slice(0, 7))
  const [categoryFilter, setCategoryFilter] = useState(allCategories)
  const [isAddOpen, setIsAddOpen] = useState(false)
  const [selectedExpense, setSelectedExpense] = useState<Expense | null>(null)
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null)
  const [expenseToDelete, setExpenseToDelete] = useState<Expense | null>(null)
  const [form, setForm] = useState<ExpenseFormState>(() => createInitialFormState(roommates))
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

  const filteredExpenses = activeExpenses.filter((expense) => {
    const matchesMonth = getMonth(expense.date) === monthFilter
    const matchesCategory = categoryFilter === allCategories || expense.category === categoryFilter
    return matchesMonth && matchesCategory
  })

  const monthlyExpenses = activeExpenses.filter((expense) => getMonth(expense.date) === monthFilter)
  const monthlyTotal = monthlyExpenses.reduce((sum, expense) => sum + Number(expense.amount), 0)
  const filteredTotal = filteredExpenses.reduce((sum, expense) => sum + Number(expense.amount), 0)
  const averageExpense = monthlyExpenses.length > 0 ? monthlyTotal / monthlyExpenses.length : 0
  const totalsByUser = monthlyExpenses.reduce<Record<number, number>>(
    (totals, expense) => ({
      ...totals,
      [expense.paid_by]: (totals[expense.paid_by] ?? 0) + Number(expense.amount),
    }),
    {},
  )
  const [topPayerId, topPayerTotal] =
    Object.entries(totalsByUser).sort((a, b) => Number(b[1]) - Number(a[1]))[0] ?? []
  const topPayer = topPayerId
    ? { name: getUserName(Number(topPayerId)), total: Number(topPayerTotal) }
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
    setFormError('')
    setIsAddOpen(true)
  }

  function openEditModal(expense: Expense) {
    setSelectedExpense(null)
    setEditingExpense(expense)
    setForm(buildFormFromExpense(expense))
    setFormError('')
    setIsAddOpen(true)
  }

  function closeAddModal() {
    setIsAddOpen(false)
    setEditingExpense(null)
    setForm(createInitialFormState(roommates))
    setFormError('')
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

      <section className="expenses-summary" aria-label="סיכום חודשי">
        <Card className="expenses-summary__main">
          <p className="expenses-summary__label">סה"כ הוצאות ב{monthLabel(monthFilter)}</p>
          <p className="expenses-summary__amount">{formatCurrency(monthlyTotal)}</p>
          <p className="expenses-summary__hint">{monthlyExpenses.length} הוצאות פעילות בחודש הנבחר</p>
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

      <Card title="סינון הוצאות">
        <div className="expenses-filters">
          <label className="field">
            <span className="field__label">חודש</span>
            <select className="field__input" value={monthFilter} onChange={(event) => setMonthFilter(event.target.value)}>
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
      </Card>

      <Card title="רשימת הוצאות">
        {filteredExpenses.length === 0 ? (
          <div className="expenses-empty">
            <p className="expenses-empty__title">אין הוצאות שמתאימות לסינון.</p>
            <p className="muted">אפשר לשנות חודש או קטגוריה, או להוסיף הוצאה חדשה.</p>
          </div>
        ) : (
          <ul className="expense-list expense-list--cards">
            {filteredExpenses.map((expense) => {
              const payerName = getUserName(expense.paid_by)

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
                        {payerName ? ` · שילם: ${payerName}` : ''}
                      </span>
                    </span>
                    <span className="expense-item-card__side">
                      <span className="expense-list__amount">{formatCurrency(expense.amount)}</span>
                      <span className="expense-item-card__share">
                        חלק לדייר: {formatCurrency(calculateShare(expense))}
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
          <section className="expense-modal card" role="dialog" aria-modal="true" aria-labelledby="add-expense-title">
            <div className="expense-modal__head">
              <div>
                <p className="expenses-hero__eyebrow">{editingExpense ? 'עריכת הוצאה' : 'הוצאה חדשה'}</p>
                <h2 id="add-expense-title">{editingExpense ? 'עדכון פרטי הוצאה' : 'מה שולם בדירה?'}</h2>
              </div>
              <button type="button" className="btn-text" onClick={closeAddModal}>
                סגירה
              </button>
            </div>

            <form className="expense-form" onSubmit={(event) => void handleAddExpense(event)} noValidate>
              <label className="field">
                <span className="field__label">תיאור ההוצאה</span>
                <input className="field__input" value={form.description} onChange={(event) => updateForm('description', event.target.value)} />
              </label>

              <div className="expense-form__grid">
                <label className="field">
                  <span className="field__label">סכום</span>
                  <input className="field__input" type="number" min="0" step="0.01" dir="ltr" value={form.amount} onChange={(event) => updateForm('amount', event.target.value)} />
                </label>

                <label className="field">
                  <span className="field__label">תאריך</span>
                  <input className="field__input" type="date" dir="ltr" value={form.date} onChange={(event) => updateForm('date', event.target.value)} />
                </label>
              </div>

              <div className="expense-form__grid">
                <label className="field">
                  <span className="field__label">קטגוריה</span>
                  <select className="field__input" value={form.category} onChange={(event) => updateForm('category', event.target.value)}>
                    {['חשבונות', 'מזון', 'ניקיון', 'תחזוקה', 'אחר'].map((category) => (
                      <option key={category} value={category}>
                        {category}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="field">
                  <span className="field__label">מי שילם?</span>
                  <select className="field__input" value={form.paidBy} onChange={(event) => updateForm('paidBy', event.target.value)}>
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
          <section className="expense-modal expense-modal--details card" role="dialog" aria-modal="true" aria-labelledby="expense-details-title">
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
                  <strong>{getUserName(selectedExpense.paid_by) ?? 'לא ידוע'}</strong>
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
                    <li key={userId}>{getUserName(userId) ?? 'דייר לא ידוע'}</li>
                  ))}
                </ul>
              </div>

              <div className="expense-form__actions">
                <button type="button" className="btn btn--secondary" onClick={() => openEditModal(selectedExpense)}>
                  עריכה
                </button>
                <button type="button" className="btn btn--danger" onClick={() => setExpenseToDelete(selectedExpense)}>
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
