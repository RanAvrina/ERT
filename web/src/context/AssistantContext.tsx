/* eslint-disable react-refresh/only-export-components */
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { queryAssistantViaApi, type AssistantContextSnapshot } from '../data/server/assistantApi'
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
  open: () => void
  close: () => void
  toggle: () => void
  ask: (question: string) => Promise<void>
}

const AssistantContext = createContext<AssistantState | null>(null)

function createMessage(role: AssistantMessage['role'], text: string): AssistantMessage {
  return {
    id: `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    role,
    text,
  }
}

export function AssistantProvider({ children }: { children: ReactNode }) {
  const { current } = useApartment()
  const [isOpen, setIsOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [messages, setMessages] = useState<AssistantMessage[]>([
    createMessage(
      'assistant',
      'אני יכול לענות על מידע מתוך הדירה: יתרות לתיאום, קניות פתוחות, משימות ופניות.',
    ),
  ])
  const [suggestions, setSuggestions] = useState<string[]>([
    'למה אני חייב כסף?',
    'מה צריך לקנות עכשיו?',
    'כמה משימות פתוחות יש?',
  ])
  const [contextSnapshot, setContextSnapshot] = useState<AssistantContextSnapshot | null>(null)

  const open = useCallback(() => setIsOpen(true), [])
  const close = useCallback(() => setIsOpen(false), [])
  const toggle = useCallback(() => setIsOpen((currentValue) => !currentValue), [])

  const ask = useCallback(
    async (question: string) => {
      const trimmedQuestion = question.trim()
      if (!trimmedQuestion || !current?.apartment.id || isLoading) return

      setMessages((currentMessages) => [
        ...currentMessages,
        createMessage('user', trimmedQuestion),
      ])
      setIsLoading(true)

      try {
        const response = await queryAssistantViaApi(
          current.apartment.id,
          trimmedQuestion,
        )

        setContextSnapshot(response.context)
        setSuggestions(response.suggestions)
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
              : 'לא הצלחנו לקבל תשובה מהסוכן כרגע.',
          ),
        ])
      } finally {
        setIsLoading(false)
      }
    },
    [current?.apartment.id, isLoading],
  )

  const value = useMemo(
    () => ({
      isOpen,
      isLoading,
      messages,
      suggestions,
      contextSnapshot,
      open,
      close,
      toggle,
      ask,
    }),
    [ask, close, contextSnapshot, isLoading, isOpen, messages, open, suggestions, toggle],
  )

  return <AssistantContext.Provider value={value}>{children}</AssistantContext.Provider>
}

export function useAssistant() {
  const context = useContext(AssistantContext)
  if (!context) throw new Error('useAssistant must be used within AssistantProvider')
  return context
}
