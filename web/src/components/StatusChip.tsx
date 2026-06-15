import type { PaymentStatus, ShoppingItemStatus, TaskStatus, TicketStatus } from '../types/models'
import { shoppingItemLabels, taskLabels, ticketLabels } from './statusLabels'

type ChipTone = 'success' | 'warning' | 'danger' | 'muted' | 'primary'

const toneClass: Record<ChipTone, string> = {
  success: 'chip--success',
  warning: 'chip--warning',
  danger: 'chip--danger',
  muted: 'chip--muted',
  primary: 'chip--primary',
}

const paymentLabels: Record<PaymentStatus, string> = {
  recorded: 'נרשם',
  cancelled: 'בוטל',
}

const paymentTone: Record<PaymentStatus, ChipTone> = {
  recorded: 'success',
  cancelled: 'muted',
}

const taskTone: Record<TaskStatus, ChipTone> = {
  open: 'primary',
  in_progress: 'warning',
  done: 'success',
  cancelled: 'muted',
}

const itemTone: Record<ShoppingItemStatus, ChipTone> = {
  open: 'primary',
  purchased: 'success',
  cancelled: 'muted',
}

const ticketTone: Record<TicketStatus, ChipTone> = {
  open: 'primary',
  in_progress: 'warning',
  closed: 'success',
}

function getChipClass(tone: ChipTone, clickable = false) {
  return `chip ${toneClass[tone]}${clickable ? ' chip--button' : ''}`
}

export function StatusChip({
  label,
  tone,
}: {
  label: string
  tone: ChipTone
}) {
  return <span className={getChipClass(tone)}>{label}</span>
}

export function StatusActionChip({
  label,
  tone,
  onClick,
  title,
  disabled = false,
}: {
  label: string
  tone: ChipTone
  onClick: () => void
  title?: string
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      className={getChipClass(tone, true)}
      onClick={onClick}
      title={title}
      disabled={disabled}
    >
      {label}
    </button>
  )
}

export function PaymentStatusChip({ status }: { status: PaymentStatus }) {
  return <StatusChip label={paymentLabels[status]} tone={paymentTone[status]} />
}

export function TaskStatusChip({ status }: { status: TaskStatus }) {
  return <StatusChip label={taskLabels[status]} tone={taskTone[status]} />
}

export function TaskStatusActionChip({
  status,
  onClick,
}: {
  status: TaskStatus
  onClick: () => void
}) {
  return (
    <StatusActionChip
      label={taskLabels[status]}
      tone={taskTone[status]}
      onClick={onClick}
      title="שינוי סטטוס מטלה"
    />
  )
}

export function ShoppingItemStatusChip({ status }: { status: ShoppingItemStatus }) {
  return <StatusChip label={shoppingItemLabels[status]} tone={itemTone[status]} />
}

export function ShoppingItemStatusActionChip({
  status,
  onClick,
}: {
  status: ShoppingItemStatus
  onClick: () => void
}) {
  return (
    <StatusActionChip
      label={shoppingItemLabels[status]}
      tone={itemTone[status]}
      onClick={onClick}
      title="שינוי סטטוס פריט"
    />
  )
}

export function TicketStatusChip({ status }: { status: TicketStatus }) {
  return <StatusChip label={ticketLabels[status]} tone={ticketTone[status]} />
}

export function TicketStatusActionChip({
  status,
  onClick,
}: {
  status: TicketStatus
  onClick: () => void
}) {
  return (
    <StatusActionChip
      label={ticketLabels[status]}
      tone={ticketTone[status]}
      onClick={onClick}
      title="שינוי סטטוס פנייה"
    />
  )
}
