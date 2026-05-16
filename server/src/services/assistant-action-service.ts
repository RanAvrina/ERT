import { randomUUID } from 'node:crypto'
import { ApiError } from '../lib/api-error.js'
import type { AuthAccount, AuthMembership } from '../types/auth.js'
import { createExpense, createPayment } from './finance-service.js'
import { createShoppingItem, updateShoppingItem } from './shopping-service.js'
import { createTask, updateTask } from './task-service.js'
import { createTicket, updateTicketStatus } from './ticket-service.js'

type PendingActionType =
  | 'create_payment'
  | 'create_shopping_item'
  | 'create_expense'
  | 'create_task'
  | 'create_ticket'
  | 'update_task_status'
  | 'update_shopping_status'
  | 'update_ticket_status'

interface BasePendingAction {
  token: string
  apartmentId: number
  accountId: number
  type: PendingActionType
  summary: string
  createdAt: number
}

interface PendingPaymentAction extends BasePendingAction {
  type: 'create_payment'
  payload: {
    payerAccountId: number
    payeeAccountId: number
    amount: string
    paymentDate: string
    note: string | null
  }
}

interface PendingShoppingAction extends BasePendingAction {
  type: 'create_shopping_item'
  payload: {
    actorAccountId: number
    itemName: string
    quantity: string | null
    category: string | null
    status: 'open'
  }
}

interface PendingExpenseAction extends BasePendingAction {
  type: 'create_expense'
  payload: {
    paidByAccountId: number
    amount: string
    description: string
    category: string | null
    date: string
    participantAccountIds: number[]
  }
}

interface PendingTaskAction extends BasePendingAction {
  type: 'create_task'
  payload: {
    title: string
    description: string | null
    assigneeAccountId: number | null
    dueDate: string | null
    status: 'open'
    createdByAccountId: number
  }
}

interface PendingTicketAction extends BasePendingAction {
  type: 'create_ticket'
  payload: {
    title: string
    description: string
    category: 'issue' | 'request' | 'finance' | 'other'
    createdByAccountId: number
  }
}

interface PendingTaskStatusAction extends BasePendingAction {
  type: 'update_task_status'
  payload: {
    taskId: number
    title: string
    description: string | null
    assigneeAccountId: number | null
    dueDate: string | null
    status: 'open' | 'in_progress' | 'done' | 'cancelled'
  }
}

interface PendingShoppingStatusAction extends BasePendingAction {
  type: 'update_shopping_status'
  payload: {
    itemId: number
    itemName: string
    quantity: string | null
    category: string | null
    status: 'open' | 'purchased' | 'cancelled'
    actorAccountId: number
    purchasedByAccountId: number | null
    purchasedAt: string | null
  }
}

interface PendingTicketStatusAction extends BasePendingAction {
  type: 'update_ticket_status'
  payload: {
    ticketId: number
    title: string
    status: 'open' | 'in_progress' | 'closed'
  }
}

type PendingAssistantAction =
  | PendingPaymentAction
  | PendingShoppingAction
  | PendingExpenseAction
  | PendingTaskAction
  | PendingTicketAction
  | PendingTaskStatusAction
  | PendingShoppingStatusAction
  | PendingTicketStatusAction

export interface AssistantActionProposal {
  token: string
  type: PendingActionType
  summary: string
  confirmLabel: string
}

const ACTION_TTL_MS = 10 * 60 * 1000
const pendingActions = new Map<string, PendingAssistantAction>()

function cleanupExpiredActions() {
  const now = Date.now()
  for (const [token, action] of pendingActions.entries()) {
    if (now - action.createdAt > ACTION_TTL_MS) {
      pendingActions.delete(token)
    }
  }
}

function toProposal(action: PendingAssistantAction): AssistantActionProposal {
  return {
    token: action.token,
    type: action.type,
    summary: action.summary,
    confirmLabel:
      action.type === 'create_payment'
        ? 'אישור רישום תשלום'
        : action.type === 'create_shopping_item'
          ? 'אישור הוספה לרשימה'
          : action.type === 'create_expense'
            ? 'אישור רישום הוצאה'
            : action.type === 'create_task'
              ? 'אישור פתיחת משימה'
              : action.type === 'create_ticket'
                ? 'אישור פתיחת פנייה'
                : action.type === 'update_task_status'
                  ? 'אישור שינוי סטטוס משימה'
                  : action.type === 'update_shopping_status'
                    ? 'אישור שינוי סטטוס קנייה'
                    : 'אישור שינוי סטטוס פנייה',
  }
}

export function createPaymentAction(input: {
  apartmentId: number
  account: AuthAccount
  payerAccountId?: number
  payerName?: string
  payeeAccountId: number
  payeeName: string
  amount: string
}) {
  cleanupExpiredActions()

  const action: PendingPaymentAction = {
    token: randomUUID(),
    apartmentId: input.apartmentId,
    accountId: input.account.id,
    type: 'create_payment',
    summary: `לרשום תשלום של ${input.amount} ש"ח מ-${input.payerName ?? 'אתה'} ל-${input.payeeName}.`,
    createdAt: Date.now(),
    payload: {
      payerAccountId: input.payerAccountId ?? input.account.id,
      payeeAccountId: input.payeeAccountId,
      amount: input.amount,
      paymentDate: new Date().toISOString(),
      note: 'נרשם דרך הסוכן',
    },
  }

  pendingActions.set(action.token, action)
  return toProposal(action)
}

export function createShoppingItemAction(input: {
  apartmentId: number
  account: AuthAccount
  itemName: string
  quantity: string | null
}) {
  cleanupExpiredActions()

  const action: PendingShoppingAction = {
    token: randomUUID(),
    apartmentId: input.apartmentId,
    accountId: input.account.id,
    type: 'create_shopping_item',
    summary: `להוסיף לרשימת הקניות: ${input.itemName}${input.quantity ? ` (כמות: ${input.quantity})` : ''}.`,
    createdAt: Date.now(),
    payload: {
      actorAccountId: input.account.id,
      itemName: input.itemName,
      quantity: input.quantity,
      category: null,
      status: 'open',
    },
  }

  pendingActions.set(action.token, action)
  return toProposal(action)
}

export function createExpenseAction(input: {
  apartmentId: number
  account: AuthAccount
  amount: string
  description: string
  category: string | null
  participantAccountIds: number[]
  participantLabel: string
}) {
  cleanupExpiredActions()

  const action: PendingExpenseAction = {
    token: randomUUID(),
    apartmentId: input.apartmentId,
    accountId: input.account.id,
    type: 'create_expense',
    summary: `לרשום הוצאה של ${input.amount} ש"ח עבור "${input.description}"${input.category ? ` בקטגוריית ${input.category}` : ''}, להתחלקות ${input.participantLabel}.`,
    createdAt: Date.now(),
    payload: {
      paidByAccountId: input.account.id,
      amount: input.amount,
      description: input.description,
      category: input.category,
      date: new Date().toISOString().slice(0, 10),
      participantAccountIds: input.participantAccountIds,
    },
  }

  pendingActions.set(action.token, action)
  return toProposal(action)
}

export function createTaskAction(input: {
  apartmentId: number
  account: AuthAccount
  title: string
  description: string | null
  assigneeAccountId: number | null
  assigneeLabel: string
  dueDate: string | null
}) {
  cleanupExpiredActions()

  const action: PendingTaskAction = {
    token: randomUUID(),
    apartmentId: input.apartmentId,
    accountId: input.account.id,
    type: 'create_task',
    summary: `לפתוח משימה "${input.title}"${input.dueDate ? ` עם יעד ${input.dueDate}` : ''}, באחריות ${input.assigneeLabel}.`,
    createdAt: Date.now(),
    payload: {
      title: input.title,
      description: input.description,
      assigneeAccountId: input.assigneeAccountId,
      dueDate: input.dueDate,
      status: 'open',
      createdByAccountId: input.account.id,
    },
  }

  pendingActions.set(action.token, action)
  return toProposal(action)
}

export function createTicketAction(input: {
  apartmentId: number
  account: AuthAccount
  title: string
  description: string
  category: 'issue' | 'request' | 'finance' | 'other'
}) {
  cleanupExpiredActions()

  const action: PendingTicketAction = {
    token: randomUUID(),
    apartmentId: input.apartmentId,
    accountId: input.account.id,
    type: 'create_ticket',
    summary: `לפתוח פנייה "${input.title}" בקטגוריית ${input.category}.`,
    createdAt: Date.now(),
    payload: {
      title: input.title,
      description: input.description,
      category: input.category,
      createdByAccountId: input.account.id,
    },
  }

  pendingActions.set(action.token, action)
  return toProposal(action)
}

export function createTaskStatusAction(input: {
  apartmentId: number
  account: AuthAccount
  taskId: number
  title: string
  description: string | null
  assigneeAccountId: number | null
  dueDate: string | null
  status: 'open' | 'in_progress' | 'done' | 'cancelled'
  statusLabel: string
}) {
  cleanupExpiredActions()

  const action: PendingTaskStatusAction = {
    token: randomUUID(),
    apartmentId: input.apartmentId,
    accountId: input.account.id,
    type: 'update_task_status',
    summary: `לשנות את הסטטוס של המשימה "${input.title}" ל-${input.statusLabel}.`,
    createdAt: Date.now(),
    payload: {
      taskId: input.taskId,
      title: input.title,
      description: input.description,
      assigneeAccountId: input.assigneeAccountId,
      dueDate: input.dueDate,
      status: input.status,
    },
  }

  pendingActions.set(action.token, action)
  return toProposal(action)
}

export function createShoppingStatusAction(input: {
  apartmentId: number
  account: AuthAccount
  itemId: number
  itemName: string
  quantity: string | null
  category: string | null
  status: 'open' | 'purchased' | 'cancelled'
  statusLabel: string
}) {
  cleanupExpiredActions()

  const action: PendingShoppingStatusAction = {
    token: randomUUID(),
    apartmentId: input.apartmentId,
    accountId: input.account.id,
    type: 'update_shopping_status',
    summary: `לשנות את הסטטוס של "${input.itemName}" ל-${input.statusLabel}.`,
    createdAt: Date.now(),
    payload: {
      itemId: input.itemId,
      itemName: input.itemName,
      quantity: input.quantity,
      category: input.category,
      status: input.status,
      actorAccountId: input.account.id,
      purchasedByAccountId: input.status === 'purchased' ? input.account.id : null,
      purchasedAt: input.status === 'purchased' ? new Date().toISOString() : null,
    },
  }

  pendingActions.set(action.token, action)
  return toProposal(action)
}

export function createTicketStatusAction(input: {
  apartmentId: number
  account: AuthAccount
  ticketId: number
  title: string
  status: 'open' | 'in_progress' | 'closed'
  statusLabel: string
}) {
  cleanupExpiredActions()

  const action: PendingTicketStatusAction = {
    token: randomUUID(),
    apartmentId: input.apartmentId,
    accountId: input.account.id,
    type: 'update_ticket_status',
    summary: `לשנות את הסטטוס של הפנייה "${input.title}" ל-${input.statusLabel}.`,
    createdAt: Date.now(),
    payload: {
      ticketId: input.ticketId,
      title: input.title,
      status: input.status,
    },
  }

  pendingActions.set(action.token, action)
  return toProposal(action)
}

export function cancelAssistantAction(input: {
  token: string
  apartmentId: number
  accountId: number
}) {
  const action = pendingActions.get(input.token)
  if (!action) return
  if (action.apartmentId !== input.apartmentId || action.accountId !== input.accountId) return
  pendingActions.delete(input.token)
}

export async function executeAssistantAction(input: {
  token: string
  apartmentId: number
  account: AuthAccount
  membership: AuthMembership | null
}) {
  cleanupExpiredActions()

  const action = pendingActions.get(input.token)
  if (!action) {
    throw new ApiError(404, 'פעולת הסוכן כבר לא זמינה. צריך לנסח אותה מחדש.')
  }

  if (action.apartmentId !== input.apartmentId || action.accountId !== input.account.id) {
    throw new ApiError(403, 'אי אפשר לאשר פעולה שלא שייכת למשתמש או לדירה הנוכחיים.')
  }

  pendingActions.delete(action.token)

  if (action.type === 'create_payment') {
    await createPayment({
      apartmentId: action.apartmentId,
      payerAccountId: action.payload.payerAccountId,
      payeeAccountId: action.payload.payeeAccountId,
      amount: action.payload.amount,
      paymentDate: action.payload.paymentDate,
      note: action.payload.note,
    })

    return {
      message: `נרשם תשלום של ${action.payload.amount} ש"ח בהצלחה.`,
    }
  }

  if (action.type === 'create_shopping_item') {
    await createShoppingItem({
      apartmentId: action.apartmentId,
      actorAccountId: action.payload.actorAccountId,
      itemName: action.payload.itemName,
      quantity: action.payload.quantity,
      category: action.payload.category,
      status: action.payload.status,
    })

    return {
      message: `הפריט "${action.payload.itemName}" נוסף לרשימת הקניות.`,
    }
  }

  if (action.type === 'create_expense') {
    await createExpense({
      apartmentId: action.apartmentId,
      paidByAccountId: action.payload.paidByAccountId,
      amount: action.payload.amount,
      description: action.payload.description,
      category: action.payload.category,
      date: action.payload.date,
      participantAccountIds: action.payload.participantAccountIds,
    })

    return {
      message: `נרשמה הוצאה של ${action.payload.amount} ש"ח עבור "${action.payload.description}".`,
    }
  }

  if (action.type === 'create_task') {
    await createTask({
      apartmentId: action.apartmentId,
      title: action.payload.title,
      description: action.payload.description,
      assigneeAccountId: action.payload.assigneeAccountId,
      dueDate: action.payload.dueDate,
      status: action.payload.status,
      createdByAccountId: action.payload.createdByAccountId,
    })

    return {
      message: `נפתחה משימה חדשה: "${action.payload.title}".`,
    }
  }

  if (action.type === 'create_ticket') {
    await createTicket({
      apartmentId: action.apartmentId,
      title: action.payload.title,
      description: action.payload.description,
      category: action.payload.category,
      createdByAccountId: action.payload.createdByAccountId,
    })

    return {
      message: `נפתחה פנייה חדשה: "${action.payload.title}".`,
    }
  }

  if (action.type === 'update_task_status') {
    await updateTask({
      apartmentId: action.apartmentId,
      taskId: action.payload.taskId,
      title: action.payload.title,
      description: action.payload.description,
      assigneeAccountId: action.payload.assigneeAccountId,
      dueDate: action.payload.dueDate,
      status: action.payload.status,
    })

    return {
      message: `הסטטוס של המשימה "${action.payload.title}" עודכן.`,
    }
  }

  if (action.type === 'update_shopping_status') {
    await updateShoppingItem({
      apartmentId: action.apartmentId,
      itemId: action.payload.itemId,
      actorAccountId: action.payload.actorAccountId,
      itemName: action.payload.itemName,
      quantity: action.payload.quantity,
      category: action.payload.category,
      status: action.payload.status,
      purchasedByAccountId: action.payload.purchasedByAccountId,
      purchasedAt: action.payload.purchasedAt,
    })

    return {
      message: `הסטטוס של "${action.payload.itemName}" עודכן.`,
    }
  }

  if (action.type === 'update_ticket_status') {
    await updateTicketStatus({
      apartmentId: action.apartmentId,
      ticketId: action.payload.ticketId,
      actorRole: input.membership?.role ?? 'tenant',
      status: action.payload.status,
    })

    return {
      message: `הסטטוס של הפנייה "${action.payload.title}" עודכן.`,
    }
  }

  throw new ApiError(400, 'סוג הפעולה לא נתמך.')
}
