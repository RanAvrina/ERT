import type { ShoppingItemStatus, TaskStatus, TicketStatus } from '../types/models'

export const taskLabels: Record<TaskStatus, string> = {
  open: 'פתוחה',
  in_progress: 'בביצוע',
  done: 'בוצעה',
  cancelled: 'בוטלה',
}

export const shoppingItemLabels: Record<ShoppingItemStatus, string> = {
  open: 'פתוח',
  purchased: 'נרכש',
  cancelled: 'בוטל',
}

export const ticketLabels: Record<TicketStatus, string> = {
  open: 'פתוח',
  in_progress: 'בטיפול',
  closed: 'סגור',
}
