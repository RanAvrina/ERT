/* eslint-disable react-refresh/only-export-components */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import {
  cancelAssistantActionViaApi,
  confirmAssistantActionViaApi,
  queryAssistantViaApi,
  readAssistantContextViaApi,
  type AssistantActionProposal,
  type AssistantContextSnapshot,
  type AssistantHistoryMessage,
} from '../data/server/assistantApi'
import { useApartment } from './ApartmentContext'

export interface AssistantMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
}

interface AssistantState {
  isOpen: boolean
  isLoading: boolean
  messages: AssistantMessage[]
  suggestions: string[]
  contextSnapshot: AssistantContextSnapshot | null
  pendingAction: AssistantActionProposal | null
  open: () => void
  close: () => void
  toggle: () => void
  ask: (question: string) => Promise<void>
  confirmAction: () => Promise<void>
  cancelAction: () => Promise<void>
}

const AssistantContext = createContext<AssistantState | null>(null)
export const ASSISTANT_DATA_CHANGED_EVENT = 'assistant:data-changed'
const defaultSuggestions = [
  'תן לי תמונת מצב קצרה',
  'למה אני חייב כסף?',
  'מה צריך לקנות עכשיו?',
  'מה הוצאנו הכי הרבה כסף החודש?',
]

function createMessage(role: AssistantMessage['role'], text: string): AssistantMessage {
  return {
    id: `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    role,
    text,
  }
}

function getWelcomeMessage(apartmentName?: string) {
  if (!apartmentName) {
    return 'אני יכול לענות על נתוני הדירה: חובות, קניות, משימות, פניות ומידע כללי.'
  }

  return `אני מחובר לנתונים של "${apartmentName}". אפשר לשאול אותי על חובות, קניות, משימות, פניות ומידע כללי.`
}

export function AssistantProvider({ children }: { children: ReactNode }) {
  const { current } = useApartment()
  const apartmentId = current?.apartment.id ?? 0
  const apartmentName = current?.apartment.name
  const [isOpen, setIsOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [messages, setMessages] = useState<AssistantMessage[]>([
    createMessage('assistant', getWelcomeMessage(apartmentName)),
  ])
  const [suggestions, setSuggestions] = useState<string[]>(defaultSuggestions)
  const [contextSnapshot, setContextSnapshot] = useState<AssistantContextSnapshot | null>(null)
  const [pendingAction, setPendingAction] = useState<AssistantActionProposal | null>(null)

  useEffect(() => {
    setMessages([createMessage('assistant', getWelcomeMessage(apartmentName))])
    setSuggestions(defaultSuggestions)
    setContextSnapshot(null)
    setPendingAction(null)
  }, [apartmentId, apartmentName])

  useEffect(() => {
    let cancelled = false

    async function loadContext() {
      if (!isOpen || !apartmentId) return

      try {
        const nextContext = await readAssistantContextViaApi(apartmentId)
        if (!cancelled) {
          setContextSnapshot(nextContext)
        }
      } catch {
        if (!cancelled) {
          setContextSnapshot(null)
        }
      }
    }

    void loadContext()

    return () => {
      cancelled = true
    }
  }, [apartmentId, isOpen])

  const open = useCallback(() => setIsOpen(true), [])
  const close = useCallback(() => setIsOpen(false), [])
  const toggle = useCallback(() => setIsOpen((currentValue) => !currentValue), [])

  const ask = useCallback(
    async (question: string) => {
      const trimmedQuestion = question.trim()
      if (!trimmedQuestion || !apartmentId || isLoading) return

      setMessages((currentMessages) => [
        ...currentMessages,
        createMessage('user', trimmedQuestion),
      ])
      setIsLoading(true)

      try {
        const previousUserQuestion =
          [...messages]
            .reverse()
            .find((message) => message.role === 'user')?.text ?? null
        const history: AssistantHistoryMessage[] = messages
          .slice(-6)
          .map((message) => ({ role: message.role, text: message.text }))

        const response = await queryAssistantViaApi(
          apartmentId,
          trimmedQuestion,
          previousUserQuestion,
          history,
        )

        setContextSnapshot(response.context)
        setSuggestions(response.suggestions)
        setPendingAction(response.proposedAction ?? null)
        setMessages((currentMessages) => [
          ...currentMessages,
          createMessage('assistant', response.answer),
        ])
      } catch (error) {
        setMessages((currentMessages) => [
          ...currentMessages,
          createMessage(
            'assistant',
            error instanceof Error && error.message
              ? error.message
              : 'לא הצלחתי לענות כרגע. נסה שוב בעוד רגע.',
          ),
        ])
      } finally {
        setIsLoading(false)
      }
    },
    [apartmentId, isLoading, messages],
  )

  const confirmAction = useCallback(async () => {
    if (!pendingAction || !apartmentId || isLoading) return

    setIsLoading(true)
    try {
      const response = await confirmAssistantActionViaApi(apartmentId, pendingAction.token)
      setMessages((currentMessages) => [
        ...currentMessages,
        createMessage('assistant', response.message),
      ])
      setPendingAction(null)
      const nextContext = await readAssistantContextViaApi(apartmentId)
      setContextSnapshot(nextContext)
      window.dispatchEvent(
        new CustomEvent(ASSISTANT_DATA_CHANGED_EVENT, {
          detail: { apartmentId },
        }),
      )
    } catch (error) {
      setMessages((currentMessages) => [
        ...currentMessages,
        createMessage(
          'assistant',
          error instanceof Error && error.message
            ? error.message
            : 'אישור הפעולה נכשל.',
        ),
      ])
    } finally {
      setIsLoading(false)
    }
  }, [apartmentId, isLoading, pendingAction])

  const cancelAction = useCallback(async () => {
    if (!pendingAction || !apartmentId || isLoading) return

    setIsLoading(true)
    try {
      await cancelAssistantActionViaApi(apartmentId, pendingAction.token)
      setMessages((currentMessages) => [
        ...currentMessages,
        createMessage('assistant', 'הפעולה בוטלה.'),
      ])
      setPendingAction(null)
    } catch (error) {
      setMessages((currentMessages) => [
        ...currentMessages,
        createMessage(
          'assistant',
          error instanceof Error && error.message
            ? error.message
            : 'ביטול הפעולה נכשל.',
        ),
      ])
    } finally {
      setIsLoading(false)
    }
  }, [apartmentId, isLoading, pendingAction])

  const value = useMemo(
    () => ({
      isOpen,
      isLoading,
      messages,
      suggestions,
      contextSnapshot,
      pendingAction,
      open,
      close,
      toggle,
      ask,
      confirmAction,
      cancelAction,
    }),
    [
      ask,
      cancelAction,
      close,
      confirmAction,
      contextSnapshot,
      isLoading,
      isOpen,
      messages,
      open,
      pendingAction,
      suggestions,
      toggle,
    ],
  )

  return <AssistantContext.Provider value={value}>{children}</AssistantContext.Provider>
}

export function useAssistant() {
  const context = useContext(AssistantContext)
  if (!context) throw new Error('useAssistant must be used within AssistantProvider')
  return context
}
