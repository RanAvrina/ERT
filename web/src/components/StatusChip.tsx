import type { PaymentStatus, ShoppingItemStatus, TaskStatus, TicketStatus } from '../types/models'

type ChipTone = 'success' | 'warning' | 'danger' | 'muted' | 'primary'

const toneClass: Record<ChipTone, string> = {
  success: 'chip--success',
  warning: 'chip--warning',
  danger: 'chip--danger',
  muted: 'chip--muted',
  primary: 'chip--primary',
}

export function StatusChip({
  label,
  tone,
}: {
  label: string
  tone: ChipTone
}) {
  return <span className={`chip ${toneClass[tone]}`}>{label}</span>
}

const paymentLabels: Record<PaymentStatus, string> = {
  recorded: 'נרשם',
  cancelled: 'בוטל',
}

const paymentTone: Record<PaymentStatus, ChipTone> = {
  recorded: 'success',
  cancelled: 'muted',
}

export function PaymentStatusChip({ status }: { status: PaymentStatus }) {
  return <StatusChip label={paymentLabels[status]} tone={paymentTone[status]} />
}

const taskLabels: Record<TaskStatus, string> = {
  open: 'פתוחה',
  in_progress: 'בביצוע',
  done: 'בוצעה',
  cancelled: 'בוטלה',
}

const taskTone: Record<TaskStatus, ChipTone> = {
  open: 'primary',
  in_progress: 'warning',
  done: 'success',
  cancelled: 'muted',
}

export function TaskStatusChip({ status }: { status: TaskStatus }) {
  return <StatusChip label={taskLabels[status]} tone={taskTone[status]} />
}

const itemLabels: Record<ShoppingItemStatus, string> = {
  open: 'פתוח',
  purchased: 'נרכש',
  cancelled: 'בוטל',
}

const itemTone: Record<ShoppingItemStatus, ChipTone> = {
  open: 'primary',
  purchased: 'success',
  cancelled: 'muted',
}

export function ShoppingItemStatusChip({ status }: { status: ShoppingItemStatus }) {
  return <StatusChip label={itemLabels[status]} tone={itemTone[status]} />
}

const ticketLabels: Record<TicketStatus, string> = {
  open: 'פתוח',
  sent_to_landlord: 'הועבר לבעל הדירה',
  in_progress: 'בטיפול',
  closed: 'סגור',
  cancelled: 'מבוטל',
}

const ticketTone: Record<TicketStatus, ChipTone> = {
  open: 'primary',
  sent_to_landlord: 'warning',
  in_progress: 'warning',
  closed: 'success',
  cancelled: 'muted',
}

export function TicketStatusChip({ status }: { status: TicketStatus }) {
  return <StatusChip label={ticketLabels[status]} tone={ticketTone[status]} />
}
