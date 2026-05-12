import { useAssistant } from '../context/AssistantContext'
import { useApartment } from '../context/ApartmentContext'
import { useAuth } from '../context/AuthContext'

export function AssistantLauncher() {
  const { user } = useAuth()
  const { current } = useApartment()
  const { isOpen, toggle } = useAssistant()

  if (!user || !current) return null

  return (
    <button
      type="button"
      className={`assistant-launcher${isOpen ? ' assistant-launcher--active' : ''}`}
      onClick={toggle}
      aria-label="פתיחת הסוכן"
    >
      AI
    </button>
  )
}
