export type DbUserRole = 'admin' | 'tenant' | 'landlord'
export type DbRecordStatus = 'active' | 'inactive'

export interface AccountRow {
  id: number
  full_name: string
  email: string
  phone: string | null
  password_hash: string
  status: DbRecordStatus
  created_at: string
  updated_at: string
}

export interface ApartmentRow {
  id: number
  name: string
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface ApartmentMembershipRow {
  id: number
  apartment_id: number
  account_id: number
  role: DbUserRole
  status: DbRecordStatus
  joined_at: string
  ended_at: string | null
}

export interface InviteRow {
  id: number
  apartment_id: number
  invited_role: Extract<DbUserRole, 'tenant' | 'landlord'>
  token: string
  status: 'active' | 'accepted' | 'expired' | 'cancelled'
  created_by_account_id: number
  accepted_by_account_id: number | null
  created_at: string
  accepted_at: string | null
  expires_at: string | null
}

export interface ExpenseRow {
  id: number
  apartment_id: number
  paid_by_membership_id: number
  amount: string
  description: string
  category: string | null
  expense_date: string
  status: 'active' | 'deleted'
  created_at: string
  updated_at: string
}

export interface ExpenseParticipantRow {
  id: number
  expense_id: number
  membership_id: number
  share_amount: string | null
  created_at: string
}

export interface FileAttachmentRow {
  id: string
  file_name: string
  file_type: string
  file_size: number
  file_url: string
  created_at: string
}

export interface ExpenseAttachmentRow extends FileAttachmentRow {
  expense_id: number
}

export interface PaymentRow {
  id: number
  apartment_id: number
  payer_membership_id: number
  payee_membership_id: number
  amount: string
  status: 'recorded' | 'cancelled'
  payment_date: string
  note: string | null
  created_at: string
  updated_at: string
}

export interface TaskRow {
  id: number
  apartment_id: number
  title: string
  description: string | null
  assignee_membership_id: number | null
  due_date: string | null
  status: 'open' | 'in_progress' | 'done' | 'cancelled'
  created_by_membership_id: number
  created_at: string
  updated_at: string
}

export interface ShoppingListRow {
  id: number
  apartment_id: number
  title: string
  status: 'active' | 'completed' | 'cancelled'
  created_by_membership_id: number
  created_at: string
  updated_at: string
}

export interface ShoppingItemRow {
  id: number
  apartment_id: number
  shopping_list_id: number
  item_name: string
  quantity: string | null
  category: string | null
  status: 'open' | 'purchased' | 'cancelled'
  added_by_membership_id: number
  purchased_by_membership_id: number | null
  created_at: string
  purchased_at: string | null
  updated_at: string
}

export interface MaintenanceTicketRow {
  id: number
  apartment_id: number
  title: string
  description: string
  category: 'issue' | 'request' | 'finance' | 'other'
  status: 'open' | 'in_progress' | 'closed'
  created_by_membership_id: number
  created_at: string
  updated_at: string
}

export interface TicketCommentRow {
  id: number
  ticket_id: number
  membership_id: number
  comment_text: string
  created_at: string
}

export interface TicketAttachmentRow extends FileAttachmentRow {
  ticket_id: number
}

export interface ApartmentInfoItemRow {
  id: number
  apartment_id: number
  title: string
  category_label: string | null
  provider: string | null
  meter_number: string | null
  account_number: string | null
  phone: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

export interface ApartmentInfoAttachmentRow extends FileAttachmentRow {
  apartment_info_item_id: number
}

export type InsertRow<T extends { id: number; created_at: string; updated_at?: string }> = Omit<
  T,
  'id' | 'created_at' | 'updated_at'
> & {
  created_at?: string
  updated_at?: string
}

export type UpdateRow<T extends { id: number }> = Partial<Omit<T, 'id'>> & { id: number }
