import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'

interface InlineStatusMenuProps {
  isOpen: boolean
  onOpenChange: (nextValue: boolean) => void
  trigger: ReactNode
  children: ReactNode
}

interface MenuPosition {
  top: number
  left: number
}

export function InlineStatusMenu({
  isOpen,
  onOpenChange,
  trigger,
  children,
}: InlineStatusMenuProps) {
  const anchorRef = useRef<HTMLDivElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const [position, setPosition] = useState<MenuPosition>({ top: 0, left: 12 })

  useLayoutEffect(() => {
    if (!isOpen || !anchorRef.current) return

    const updatePosition = () => {
      if (!anchorRef.current) return
      const rect = anchorRef.current.getBoundingClientRect()
      const panelWidth = panelRef.current?.offsetWidth ?? 180
      const maxLeft = Math.max(window.innerWidth - panelWidth - 12, 12)

      setPosition({
        top: Math.min(rect.bottom + 8, window.innerHeight - 12),
        left: Math.min(Math.max(rect.right - panelWidth, 12), maxLeft),
      })
    }

    updatePosition()
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)

    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) return

    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null
      if (
        target &&
        (anchorRef.current?.contains(target) || panelRef.current?.contains(target))
      ) {
        return
      }

      onOpenChange(false)
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onOpenChange(false)
      }
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('touchstart', handlePointerDown)
    document.addEventListener('keydown', handleEscape)

    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('touchstart', handlePointerDown)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [isOpen, onOpenChange])

  return (
    <>
      <div className="inline-status-menu" ref={anchorRef}>
        {trigger}
      </div>
      {isOpen
        ? createPortal(
            <div
              ref={panelRef}
              className="inline-status-menu__panel inline-status-menu__panel--portal"
              style={{
                top: `${position.top}px`,
                left: `${position.left}px`,
              }}
            >
              {children}
            </div>,
            document.body,
          )
        : null}
    </>
  )
}
