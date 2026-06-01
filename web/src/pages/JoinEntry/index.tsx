import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AuthShell } from '../../components/auth/AuthShell'
import { appRoutes } from '../../routes/paths'

function parseInviteInput(input: string) {
  try {
    const url = new URL(input)
    const params = new URLSearchParams(url.search)
    const token = params.get('token')
    const role = params.get('role') || 'tenant'
    const pathParts = url.pathname.split('/').filter(Boolean)
    const maybeId = pathParts[pathParts.length - 1]
    const apartmentId = Number(maybeId)
    if (!Number.isFinite(apartmentId) || apartmentId <= 0) return null
    return { apartmentId, token, role }
  } catch {
    // not a url, maybe input like "123?token=..."
    const [left, q] = input.split('?')
    const apartmentId = Number(left.trim())
    const params = new URLSearchParams(q || '')
    const token = params.get('token')
    const role = params.get('role') || 'tenant'
    if (!Number.isFinite(apartmentId) || apartmentId <= 0) return null
    return { apartmentId, token, role }
  }
}

export function JoinEntryPage() {
  const [value, setValue] = useState('')
  const [error, setError] = useState('')
  const navigate = useNavigate()

  function onSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError('')
    const parsed = parseInviteInput(value.trim())
    if (!parsed) {
      setError('הזינו מזהה הזמנה תקין או הדביקו את קישור ההזמנה.')
      return
    }

    const { apartmentId, token, role } = parsed
    const url = `${appRoutes.joinApartment.replace(':apartmentId', String(apartmentId))}${token ? `?token=${encodeURIComponent(token)}&role=${encodeURIComponent(role)}` : ''}`
    navigate(url)
  }

  return (
    <AuthShell title="הצטרפות לדירה" subtitle="הדביקו כאן את קוד ההזמנה או הקישור" hideIntro footer={null}>
      <form className="form-stack" onSubmit={onSubmit}>
        <label className="field">
          <span className="field__label">קוד או קישור הזמנה</span>
          <input className="field__input" value={value} onChange={(e) => setValue(e.target.value)} placeholder="לדוגמה: https://.../invite/123?token=abc" />
        </label>
        {error ? <p className="form-message form-message--error">{error}</p> : null}
        <button className="btn btn--primary btn--block" type="submit">המשך</button>
      </form>
    </AuthShell>
  )
}

export default JoinEntryPage
