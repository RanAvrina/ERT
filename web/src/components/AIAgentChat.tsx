import { useEffect, useRef, useState, type FormEvent } from 'react'
import {
  confirmAgentActionViaApi,
  queryAgentViaApi,
  type PendingAgentAction,
} from '../data/server/agentApi'

const ASSISTANT_DATA_CHANGED_EVENT = 'assistant:data-changed'

interface AgentMessage {
  role: 'user' | 'assistant'
  content: string
}

function compactText(value: string | null | undefined, fallback = '') {
  return value?.trim() || fallback
}

export function AIAgentChat() {
  const [isOpen, setIsOpen] = useState(false)
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState<AgentMessage[]>([
    {
      role: 'assistant',
      content:
        'היי, אני עוזר הדירה. אפשר לשאול אותי על מצב הדירה, חובות, מטלות, קניות ופניות. אם תבקש פעולה, אציע אותה לאישור לפני ביצוע.',
    },
  ])
  const [pendingAction, setPendingAction] = useState<PendingAgentAction | null>(null)
  const [isSending, setIsSending] = useState(false)
  const [isConfirming, setIsConfirming] = useState(false)
  const [error, setError] = useState('')

  const rootRef = useRef<HTMLDivElement | null>(null)
  const panelRef = useRef<HTMLElement | null>(null)
  const messagesRef = useRef<HTMLDivElement | null>(null)

  const agentContext = useMemo(() => {
    const scopedTasks = tasks
      .filter((task) => task.apartment_id === apartmentId)
      .slice(0, 12)
      .map((task) => ({
        id: task.id,
        title: task.title,
        description: task.description,
        dueDate: task.due_date,
        status: task.status,
      }))
    const scopedExpenses = expenses
      .filter((expense) => expense.apartment_id === apartmentId && expense.status === 'active')
      .slice(0, 10)
      .map((expense) => ({
        id: expense.id,
        description: expense.description,
        amount: expense.amount,
        category: expense.category,
        date: expense.date,
      }))
    const scopedPayments = payments
      .filter((payment) => payment.apartment_id === apartmentId && payment.status === 'recorded')
      .slice(0, 8)
      .map((payment) => ({
        id: payment.id,
        amount: payment.amount,
        note: payment.note,
        date: payment.created_at,
      }))
    const scopedTickets = tickets
      .filter((ticket) => ticket.apartment_id === apartmentId)
      .slice(0, 10)
      .map((ticket) => ({
        id: ticket.id,
        title: ticket.title,
        category: ticket.category,
        status: ticket.status,
        createdAt: ticket.created_at,
      }))
    const scopedShoppingItems = shoppingItems
      .filter((item) => (item.apartment_id ?? apartmentId) === apartmentId)
      .slice(0, 15)
      .map((item) => ({
        id: item.id,
        name: item.item_name,
        quantity: item.quantity,
        category: item.category,
        status: item.status,
        createdAt: item.created_at,
        purchasedAt: item.purchased_at,
      }))

    const element = messagesRef.current
    if (!element) return

    element.scrollTop = element.scrollHeight
  }, [isOpen, messages, pendingAction, error, isSending, isConfirming])

  useEffect(() => {
    if (!isOpen) return

    function handlePointerDown(event: PointerEvent) {
      const target = event.target
      if (!(target instanceof Node)) return
      if (panelRef.current?.contains(target)) return
      if (rootRef.current?.contains(target) && !panelRef.current) return
      setIsOpen(false)
    }

    document.addEventListener('pointerdown', handlePointerDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
    }
  }, [isOpen])

  async function submitMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const message = input.trim()
    if (!message || isSending) return

    const history = messages.slice(-6)
    setMessages((currentMessages) => [...currentMessages, { role: 'user', content: message }])
    setInput('')
    setError('')
    setPendingAction(null)
    setIsSending(true)

    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 35000) // 35 seconds

      const agentUrl = apiBaseUrl ? `${apiBaseUrl}/agent` : '/api/agent'
      const response = await fetch(agentUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message,
          history,
          context: agentContext,
        }),
        signal: controller.signal,
      })

      clearTimeout(timeoutId)

      const responseText = await response.text()
      let data: {
        reply?: string
        action?: unknown
        error?: string
      }

      setMessages((currentMessages) => [
        ...currentMessages,
        {
          role: 'assistant',
          content: compactText(result.reply, 'לא התקבלה תשובה מהסוכן.'),
        },
      ])
    } catch (requestError) {
      let messageText = 'הסוכן לא הצליח לענות כרגע.'
      
      if (requestError instanceof DOMException && requestError.name === 'AbortError') {
        messageText = 'זמן ההמתנה הסתיים. נסה שוב בעוד רגע.'
      } else if (requestError instanceof Error) {
        messageText = requestError.message
      }
      
      setError(messageText)
      setMessages((currentMessages) => [
        ...currentMessages,
        {
          role: 'assistant',
          content: messageText,
        },
      ])
    } finally {
      setIsSending(false)
    }
  }

  async function confirmPendingAction() {
    if (!pendingAction || isConfirming) return

    setError('')
    setIsConfirming(true)

    try {
      const result = await confirmAgentActionViaApi(pendingAction.token)
      setPendingAction(null)
      window.dispatchEvent(
        new CustomEvent(ASSISTANT_DATA_CHANGED_EVENT, {
          detail: { apartmentId: result.apartmentId },
        }),
      )
      setMessages((currentMessages) => [
        ...currentMessages,
        { role: 'assistant', content: compactText(result.message, 'הפעולה בוצעה.') },
      ])
    } catch (requestError) {
      const messageText =
        requestError instanceof Error ? requestError.message : 'אישור הפעולה נכשל.'
      setError(messageText)
      setMessages((currentMessages) => [
        ...currentMessages,
        {
          role: 'assistant',
          content: compactText(messageText, 'אישור הפעולה נכשל.'),
        },
      ])
    } finally {
      setIsConfirming(false)
    }
  }

  return (
    <div ref={rootRef} className={`ai-agent${isOpen ? ' ai-agent--open' : ''}`}>
      {isOpen ? (
        <section ref={panelRef} className="ai-agent__panel" aria-label="סוכן AI">
          <header className="ai-agent__head">
            <div>
              <p>סוכן AI</p>
              <strong>עוזר הדירה</strong>
            </div>
            <button type="button" className="btn-text" onClick={() => setIsOpen(false)}>
              סגירה
            </button>
          </header>

          <div ref={messagesRef} className="ai-agent__messages" role="log" aria-live="polite">
            {messages.map((messageItem, index) => (
              <div
                key={`${messageItem.role}-${index}`}
                className={`ai-agent__message ai-agent__message--${messageItem.role}`}
              >
                {messageItem.content}
              </div>
            ))}
            {isSending ? (
              <div className="ai-agent__message ai-agent__message--assistant">חושב על תשובה...</div>
            ) : null}
          </div>

          {pendingAction ? (
            <div className="ai-agent__pending">
              <span>פעולה מוצעת</span>
              <strong>{pendingAction.summary}</strong>
              <div className="ai-agent__pending-actions">
                <button
                  type="button"
                  className="btn btn--secondary btn--small"
                  onClick={() => setPendingAction(null)}
                  disabled={isConfirming}
                >
                  ביטול
                </button>
                <button
                  type="button"
                  className="btn btn--primary btn--small"
                  onClick={() => void confirmPendingAction()}
                  disabled={isConfirming}
                >
                  {isConfirming ? 'מבצע...' : 'בצע'}
                </button>
              </div>
            </div>
          ) : null}

          {error ? <p className="form-message form-message--error">{error}</p> : null}

          <form className="ai-agent__form" onSubmit={submitMessage}>
            <input
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="שאלו על מצב הדירה, חובות, מטלות, קניות או פניות..."
            />
            <button type="submit" className="btn btn--primary" disabled={isSending}>
              {isSending ? 'שולח...' : 'שלח'}
            </button>
          </form>
        </section>
      ) : (
        <button type="button" className="ai-agent__toggle" onClick={() => setIsOpen(true)}>
          AI
        </button>
      )}
    </div>
  )
}
