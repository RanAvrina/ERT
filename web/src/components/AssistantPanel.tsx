import { useEffect, useRef, useState } from 'react'
import { useAssistant } from '../context/AssistantContext'
import { useApartment } from '../context/ApartmentContext'

export function AssistantPanel() {
  const { current } = useApartment()
  const {
    isOpen,
    isLoading,
    messages,
    suggestions,
    pendingAction,
    close,
    ask,
    confirmAction,
    cancelAction,
  } = useAssistant()
  const [draft, setDraft] = useState('')
  const messagesEndRef = useRef<HTMLDivElement | null>(null)
  const quickQuestions = suggestions.slice(0, 3)

  useEffect(() => {
    if (!isOpen) return

    messagesEndRef.current?.scrollIntoView({
      block: 'end',
      behavior: 'smooth',
    })
  }, [isLoading, isOpen, messages, pendingAction])

  if (!isOpen || !current) return null

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const question = draft.trim()
    if (!question || isLoading) return
    setDraft('')
    await ask(question)
  }

  return (
    <div className="assistant-panel" role="dialog" aria-modal="false" aria-label="סוכן הדירה">
      <div className="assistant-panel__head">
        <div>
          <h2>סוכן הדירה</h2>
          <p>{current.apartment.name}</p>
        </div>
        <button type="button" className="btn-text" onClick={close}>
          סגירה
        </button>
      </div>

      <div className="assistant-panel__messages">
        {messages.length === 0 ? (
          <div className="assistant-panel__message assistant-panel__message--assistant assistant-panel__message--intro">
            אני מחובר לנתונים של {current.apartment.name}. אפשר לשאול אותי על חובות, קניות,
            משימות ופניות.
          </div>
        ) : null}

        {messages.map((message) => (
          <div
            key={message.id}
            className={`assistant-panel__message assistant-panel__message--${message.role}`}
          >
            {message.text.split('\n').map((line, index, lines) => (
              <span key={`${message.id}-${index}`}>
                {line}
                {index < lines.length - 1 ? <br /> : null}
              </span>
            ))}
          </div>
        ))}

        {pendingAction ? (
          <div className="assistant-panel__message assistant-panel__message--assistant assistant-panel__message--action">
            <div>{pendingAction.summary}</div>
            <div className="assistant-panel__action-row">
              <button
                type="button"
                className="btn btn--primary btn--small"
                onClick={() => void confirmAction()}
                disabled={isLoading}
              >
                {pendingAction.confirmLabel}
              </button>
              <button
                type="button"
                className="btn btn--secondary btn--small"
                onClick={() => void cancelAction()}
                disabled={isLoading}
              >
                ביטול
              </button>
            </div>
          </div>
        ) : null}

        {isLoading ? (
          <div className="assistant-panel__message assistant-panel__message--assistant assistant-panel__message--loading">
            בודק את הנתונים של הדירה...
          </div>
        ) : null}

        <div ref={messagesEndRef} aria-hidden="true" />
      </div>

      <div className="assistant-panel__quick">
        {quickQuestions.map((suggestion) => (
          <button
            key={suggestion}
            type="button"
            className="assistant-panel__chip"
            onClick={() => void ask(suggestion)}
            disabled={isLoading}
          >
            {suggestion}
          </button>
        ))}
      </div>

      <form className="assistant-panel__form" onSubmit={handleSubmit}>
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          className="field__input"
          placeholder="למשל: תרשום ששילמתי 400 לתומר"
        />
        <button type="submit" className="btn btn--primary" disabled={isLoading || !draft.trim()}>
          שלח
        </button>
      </form>
    </div>
  )
}
