import { useMemo } from 'react'
import { Card } from '../../components/Card'
import { useApartment } from '../../context/ApartmentContext'
import { useExpenses } from '../../context/ExpensesContext'
import { Link } from 'react-router-dom'
import { appRoutes } from '../../routes/paths'

function formatCurrency(value: number | string) {
  return new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS' }).format(Number(value))
}

export function FinancePage() {
  const { current } = useApartment()
  const apartmentId = current?.apartment.id ?? 0
  const { expenses, payments } = useExpenses()

  const apartmentExpenses = useMemo(() => expenses.filter((e) => e.apartment_id === apartmentId), [expenses, apartmentId])
  const apartmentPayments = useMemo(() => payments.filter((p) => p.apartment_id === apartmentId), [payments, apartmentId])

  const netBalanceByUser = useMemo(() => {
    const map: Record<number, number> = {}
    apartmentExpenses.forEach((expense) => {
      const amount = Number(expense.amount)
      const participants = expense.participant_ids
      if (!Number.isFinite(amount) || amount <= 0 || participants.length === 0) return
      const share = amount / participants.length
      map[expense.paid_by] = (map[expense.paid_by] ?? 0) + amount
      participants.forEach((id) => (map[id] = (map[id] ?? 0) - share))
    })
    apartmentPayments.forEach((payment) => {
      if (payment.status !== 'recorded') return
      const amount = Number(payment.amount)
      map[payment.payer_id] = (map[payment.payer_id] ?? 0) + amount
      map[payment.payee_id] = (map[payment.payee_id] ?? 0) - amount
    })
    return map
  }, [apartmentExpenses, apartmentPayments])

  const totalExpenses = apartmentExpenses.reduce((s, e) => s + Number(e.amount), 0)
  const totalPayments = apartmentPayments.filter((p) => p.status === 'recorded').reduce((s, p) => s + Number(p.amount), 0)

  return (
    <div className="page finance-page">
      <div className="page__head">
        <h1>כספים</h1>
        <div className="finance-actions">
          <Link to={appRoutes.expenses} className="btn btn--secondary">הוצאות</Link>
          <Link to={appRoutes.payments} className="btn btn--secondary">תשלומים</Link>
        </div>
      </div>

      <section className="finance-summary">
        <Card>
          <p className="muted">סה"כ הוצאות</p>
          <p className="large">{formatCurrency(totalExpenses)}</p>
        </Card>
        <Card>
          <p className="muted">סה"כ תשלומים</p>
          <p className="large">{formatCurrency(totalPayments)}</p>
        </Card>
        <Card>
          <p className="muted">מאזן נקי לפי דייר</p>
          <ul>
            {Object.entries(netBalanceByUser).map(([userId, amount]) => (
              <li key={userId}>{userId}: {formatCurrency(amount)}</li>
            ))}
          </ul>
        </Card>
      </section>
    </div>
  )
}

export default FinancePage
