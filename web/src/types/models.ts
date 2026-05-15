/** Shapes aligned with `database_schema_tables.xlsx` and system spec (mock only). */

export type UserRole = 'admin' | 'tenant' | 'landlord'
export type UserStatus = 'active' | 'inactive'

export interface User {
  id: number
  apartment_id: number
  name: string
  email: string
  role: UserRole
  status: UserStatus
  joined_at: string
}

export interface Apartment {
  id: number
  name: string
  is_active: boolean
}

export interface Expense {
  id: number
  apartment_id: number
  paid_by: number
  amount: string
  description: string
  category: string | null
  date: string
  status: 'active' | 'deleted'
  participant_ids: number[]
  attachments?: ExpenseAttachment[]
}

export interface ExpenseAttachment {
  id: string
  name: string
  type: string
  size: number
  url: string
}

export type PaymentStatus = 'recorded' | 'cancelled'

export interface Payment {
  id: number
  apartment_id: number
  payer_id: number
  payee_id: number
  amount: string
  status: PaymentStatus
  created_at: string
  note?: string | null
}

export type TaskStatus = 'open' | 'in_progress' | 'done' | 'cancelled'

export interface Task {
  id: number
  apartment_id: number
  title: string
  description: string | null
  assignee_id: number | null
  due_date: string | null
  status: TaskStatus
  created_by: number
}

export type ShoppingListStatus = 'active' | 'completed' | 'cancelled'

export interface ShoppingList {
  id: number
  apartment_id: number
  title: string
  status: ShoppingListStatus
  created_by: number
}

export type ShoppingItemStatus = 'open' | 'purchased' | 'cancelled'

export interface ShoppingItem {
  id: number
  apartment_id?: number
  shopping_list_id: number
  item_name: string
  quantity: string | null
  category: string | null
  status: ShoppingItemStatus
  added_by: number
  purchased_by: number | null
  created_at: string
  purchased_at: string | null
}

export type TicketCategory = 'תקלה' | 'בקשה' | 'כספים' | 'אחר'

export type TicketStatus =
  | 'open'
  | 'in_progress'
  | 'closed'

export interface MaintenanceTicket {
  id: number
  apartment_id: number
  title: string
  description: string
  category: TicketCategory
  status: TicketStatus
  created_by: number
  created_at: string
  attachments?: TicketAttachment[]
}

export interface TicketComment {
  id: number
  ticket_id: number
  user_id: number
  comment_text: string
  created_at: string
}

export interface TicketAttachment {
  id: string
  name: string
  type: string
  size: number
  url: string
}

export interface ApartmentInfoAttachment {
  id: string
  name: string
  type: string
  size: number
  url: string
}

export interface ApartmentInfoItem {
  id: number
  apartment_id: number
  title: string
  category_label: string | null
  provider: string | null
  meter_number: string | null
  account_number: string | null
  phone: string | null
  notes: string | null
  attachments: ApartmentInfoAttachment[]
  created_at: string
  updated_at: string
}
