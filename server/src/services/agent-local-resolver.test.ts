import test from 'node:test'
import assert from 'node:assert/strict'

import {
  inferLocalReadToolRequest,
  normalizeAgentMessage,
  resolveLocalWriteAction,
  type AgentLocalResolverContext,
} from './agent-local-resolver.js'

function createContext(): AgentLocalResolverContext {
  return {
    today: '2026-06-28',
    user: {
      id: 1,
      name: 'רן אברינה',
      role: 'tenant',
    },
    apartment: 'רינגלבלום 47',
    roommates: [
      { id: 1, name: 'רן אברינה', role: 'tenant', status: 'active' },
      { id: 2, name: 'דוד', role: 'tenant', status: 'active' },
      { id: 3, name: 'יוני', role: 'tenant', status: 'active' },
    ],
    tasks: [
      {
        id: 10,
        title: 'להוציא זבל',
        description: null,
        dueDate: '2026-06-30',
        status: 'open',
        assigneeAccountId: 1,
        assigneeName: 'רן אברינה',
      },
    ],
    expenses: [],
    payments: [],
    shoppingItems: [
      {
        id: 30,
        name: 'חלב',
        quantity: '1',
        category: null,
        status: 'open',
        createdAt: '2026-06-20T10:00:00Z',
        purchasedAt: null,
      },
    ],
    tickets: [
      {
        id: 40,
        title: 'נזילה במטבח',
        category: 'issue',
        status: 'open',
        createdAt: '2026-06-18T10:00:00Z',
      },
    ],
    homeItems: [
      {
        id: 50,
        area: 'מטבח',
        name: 'מיקרוגל',
        defaultNote: '',
      },
    ],
    apartmentInfoItems: [
      {
        id: 60,
        title: 'חשמל',
        categoryLabel: 'תשתיות',
        provider: 'חברת חשמל',
        meterNumber: '12345',
        accountNumber: '999',
        phone: '03-5555555',
        notes: '',
      },
    ],
    balanceSummary: {
      currentUserNetBalance: 120,
      roommates: [
        { id: 1, name: 'רן אברינה', netBalance: 120, position: 'creditor' },
        { id: 2, name: 'דוד', netBalance: -70, position: 'debtor' },
        { id: 3, name: 'יוני', netBalance: -50, position: 'debtor' },
      ],
      settlements: [],
    },
  }
}

test('normalizeAgentMessage fixes common typos', () => {
  assert.equal(normalizeAgentMessage('מי חייב לי כסך'), 'מי חייב לי כסף')
  assert.equal(normalizeAgentMessage('מה המטלטות שלי'), 'מה המטלות שלי')
})

test('resolveLocalWriteAction handles shopping item creation', () => {
  const action = resolveLocalWriteAction('תוסיף חלב 1 לרשימת קניות', createContext())
  assert.ok(action)
  assert.equal((action?.action as { type: string }).type, 'create_shopping_item')
  assert.deepEqual(
    (action?.action as { payload: { itemName: string; quantity: string } }).payload,
    {
      itemName: 'חלב',
      quantity: '1',
      category: null,
    },
  )
})

test('resolveLocalWriteAction handles expense creation with roommates', () => {
  const action = resolveLocalWriteAction(
    'תוסיף הוצאה 500 שקל על מים ותחלק בין רן אברינה לדוד',
    createContext(),
  )
  assert.ok(action)
  assert.equal((action?.action as { type: string }).type, 'create_expense')
  assert.deepEqual(
    (action?.action as { payload: { description: string; amount: number; participantNames: string[] } })
      .payload,
    {
      description: 'מים',
      amount: 500,
      category: 'מים',
      date: null,
      paidByName: null,
      participantNames: ['רן אברינה', 'דוד'],
    },
  )
})

test('resolveLocalWriteAction handles payment creation', () => {
  const action = resolveLocalWriteAction('תרשום שדוד שילם לי 500 שקל', createContext())
  assert.ok(action)
  assert.equal((action?.action as { type: string }).type, 'create_payment')
  assert.deepEqual(
    (action?.action as {
      payload: { payerName: string; payeeName: string; amount: number; paymentDate: string | null; note: null }
    }).payload,
    {
      payerName: 'דוד',
      payeeName: 'רן אברינה',
      amount: 500,
      paymentDate: null,
      note: null,
    },
  )
})

test('inferLocalReadToolRequest handles user tasks', () => {
  assert.deepEqual(inferLocalReadToolRequest('מה המטלות שלי?', createContext()), {
    name: 'get_tasks',
    args: { scope: 'mine', limit: 10 },
  })
})

test('inferLocalReadToolRequest handles shopping list', () => {
  assert.deepEqual(inferLocalReadToolRequest('מה חסר לקנות?', createContext()), {
    name: 'get_shopping_items',
    args: { status: 'open', limit: 12 },
  })
})

test('inferLocalReadToolRequest handles apartment info lookup', () => {
  assert.deepEqual(inferLocalReadToolRequest('מה מספר מונה החשמל?', createContext()), {
    name: 'get_apartment_info',
    args: { query: 'חשמל', limit: 10 },
  })
})

test('inferLocalReadToolRequest handles balances query with typo', () => {
  assert.deepEqual(inferLocalReadToolRequest('מי חייב לי כסך?', createContext()), {
    name: 'get_balances',
    args: {},
  })
})

test('inferLocalReadToolRequest handles debt explanation by expenses', () => {
  assert.deepEqual(inferLocalReadToolRequest('למה חייבים לי כסף?', createContext()), {
    name: 'get_expenses',
    args: { scope: 'mine', limit: 12 },
  })
})

test('inferLocalReadToolRequest handles apartment summary', () => {
  assert.deepEqual(inferLocalReadToolRequest('מה המצב?', createContext()), {
    name: 'get_apartment_summary',
    args: {},
  })
})
