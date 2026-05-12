import type {
  Apartment,
  Expense,
  MaintenanceTicket,
  Payment,
  ShoppingItem,
  ShoppingList,
  Task,
  TicketComment,
  User,
} from '../types/models'

export const mockApartment: Apartment = {
  id: 1,
  name: 'דירת השותפים — הרצל 12',
  is_active: true,
}

export const mockUsers: User[] = [
  {
    id: 1,
    apartment_id: 1,
    name: 'רן אברינה',
    email: 'ran@example.com',
    role: 'admin',
    status: 'active',
    joined_at: '2025-09-01',
  },
  {
    id: 2,
    apartment_id: 1,
    name: 'תומר לוי',
    email: 'tomer@example.com',
    role: 'tenant',
    status: 'active',
    joined_at: '2025-09-01',
  },
  {
    id: 3,
    apartment_id: 1,
    name: 'אילון לוינשטיין',
    email: 'ilon@example.com',
    role: 'tenant',
    status: 'active',
    joined_at: '2025-10-15',
  },
]

export const mockCurrentUserId = 1

export function userById(id: number): User | undefined {
  return mockUsers.find((u) => u.id === id)
}

export function userByEmail(email: string): User | undefined {
  const normalizedEmail = email.trim().toLowerCase()
  return mockUsers.find((u) => u.email.toLowerCase() === normalizedEmail)
}

export const mockExpenses: Expense[] = [
  {
    id: 1,
    apartment_id: 1,
    paid_by: 1,
    amount: '420.00',
    description: 'חשבון חשמל — ינואר',
    category: 'חשבונות',
    date: '2026-03-28',
    status: 'active',
    participant_ids: [1, 2, 3],
  },
  {
    id: 2,
    apartment_id: 1,
    paid_by: 2,
    amount: '180.50',
    description: 'קניות סופר',
    category: 'מזון',
    date: '2026-04-02',
    status: 'active',
    participant_ids: [1, 2, 3],
  },
  {
    id: 3,
    apartment_id: 1,
    paid_by: 3,
    amount: '95.00',
    description: 'אינטרנט',
    category: 'חשבונות',
    date: '2026-04-05',
    status: 'active',
    participant_ids: [1, 2, 3],
  },
  {
    id: 4,
    apartment_id: 1,
    paid_by: 1,
    amount: '75.00',
    description: 'חומרי ניקיון',
    category: 'ניקיון',
    date: '2026-04-09',
    status: 'active',
    participant_ids: [1, 2, 3],
  },
]

export const mockPayments: Payment[] = [
  {
    id: 1,
    apartment_id: 1,
    payer_id: 2,
    payee_id: 1,
    amount: '120.00',
    status: 'recorded',
    created_at: '2026-04-01T10:00:00',
    note: 'הועבר בביט',
  },
  {
    id: 2,
    apartment_id: 1,
    payer_id: 3,
    payee_id: 1,
    amount: '60.00',
    status: 'recorded',
    created_at: '2026-04-08T14:30:00',
  },
  {
    id: 3,
    apartment_id: 1,
    payer_id: 1,
    payee_id: 3,
    amount: '35.50',
    status: 'recorded',
    created_at: '2026-04-09T20:10:00',
    note: 'החזר חלקי על קניות',
  },
]

export const mockDebtSettlements = [
  {
    id: 'd1',
    payer_id: 2,
    payee_id: 1,
    amount: '84.50',
    source: 'חלק יחסי בהוצאות אפריל',
  },
  {
    id: 'd2',
    payer_id: 3,
    payee_id: 1,
    amount: '60.00',
    source: 'יתרה פתוחה מהוצאות משותפות',
  },
]

export const mockTasks: Task[] = [
  {
    id: 1,
    apartment_id: 1,
    title: 'ניקיון מטבח',
    description: 'כולל כלים ומשטחים',
    assignee_id: 2,
    due_date: '2026-04-11',
    status: 'open',
    created_by: 1,
  },
  {
    id: 2,
    apartment_id: 1,
    title: 'החלפת מסנן מדיח',
    description: null,
    assignee_id: 1,
    due_date: '2026-04-09',
    status: 'in_progress',
    created_by: 2,
  },
  {
    id: 3,
    apartment_id: 1,
    title: 'קניות לשבת',
    description: 'לפי הרשימה המשותפת',
    assignee_id: 3,
    due_date: '2026-04-12',
    status: 'open',
    created_by: 1,
  },
]

export const mockShoppingList: ShoppingList = {
  id: 1,
  apartment_id: 1,
  title: 'רשימת קניות פעילה',
  status: 'active',
  created_by: 1,
}

export const mockShoppingItems: ShoppingItem[] = [
  {
    id: 1,
    shopping_list_id: 1,
    item_name: 'חלב 3%',
    quantity: '2 ליטר',
    category: 'מזון',
    status: 'open',
    added_by: 2,
    purchased_by: null,
    created_at: '2026-04-07',
    purchased_at: null,
  },
  {
    id: 2,
    shopping_list_id: 1,
    item_name: 'נייר טואלט',
    quantity: '12 גלילים',
    category: 'ניקיון',
    status: 'open',
    added_by: 1,
    purchased_by: null,
    created_at: '2026-04-08',
    purchased_at: null,
  },
  {
    id: 3,
    shopping_list_id: 1,
    item_name: 'שמן זית',
    quantity: '1',
    category: 'מזון',
    status: 'purchased',
    added_by: 3,
    purchased_by: 3,
    created_at: '2026-04-06',
    purchased_at: '2026-04-09T18:00:00',
  },
]

export const mockTickets: MaintenanceTicket[] = [
  {
    id: 1,
    apartment_id: 1,
    title: 'דליפה מהברז במטבח',
    description: 'טיפטוף מתמיד מהברז הכפול. צירפתי תמונה בפנייה.',
    category: 'תקלה',
    status: 'in_progress',
    created_by: 2,
    created_at: '2026-04-03T09:00:00',
  },
  {
    id: 2,
    apartment_id: 1,
    title: 'בקשה להחלפת מנעול',
    description: 'המפתח השני לא מסתובב חלק.',
    category: 'בקשה',
    status: 'sent_to_landlord',
    created_by: 1,
    created_at: '2026-04-06T11:20:00',
  },
]

export const mockTicketComments: TicketComment[] = [
  {
    id: 1,
    ticket_id: 1,
    user_id: 2,
    comment_text: 'בעל הדירה אמר שישלח אינסטלטור ביום רביעי.',
    created_at: '2026-04-04T16:00:00',
  },
]

/** Simplified net balance text for dashboard (illustrative mock, not a full debt engine). */
export const mockPersonalBalanceSummary = {
  youOweOthers: '₪84.50',
  othersOweYou: '₪60.00',
  monthExpensesTotal: '₪695.50',
}

export const mockNotifications = [
  {
    id: 'n1',
    text: 'תזכורת: מועד תשלום שכר דירה מתקרב (לדוגמה).',
    tone: 'warning' as const,
  },
  {
    id: 'n2',
    text: 'תומר הוסיף הוצאה חדשה: קניות סופר.',
    tone: 'neutral' as const,
  },
  {
    id: 'n3',
    text: 'עודכן סטטוס פנייה לבעל הדירה: דליפה מהברז במטבח.',
    tone: 'success' as const,
  },
]
