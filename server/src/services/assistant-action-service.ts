import { randomUUID } from 'node:crypto'
import { ApiError } from '../lib/api-error.js'
import type { AuthAccount } from '../types/auth.js'
import { createPayment } from './finance-service.js'
import { createShoppingItem } from './shopping-service.js'

type PendingActionType = 'create_payment' | 'create_shopping_item'

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

type PendingAssistantAction = PendingPaymentAction | PendingShoppingAction

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
    confirmLabel: action.type === 'create_payment' ? 'אישור רישום תשלום' : 'אישור הוספה לרשימה',
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

  throw new ApiError(400, 'סוג הפעולה לא נתמך.')
}
