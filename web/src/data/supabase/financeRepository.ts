import type {
  Expense,
  ExpenseAttachment,
  Payment,
} from '../../types/models'
import type {
  ExpenseAttachmentRow,
  ExpenseParticipantRow,
  ExpenseRow,
  PaymentRow,
} from '../../types/database'
import { supabase } from '../../lib/supabase/client'
import { ensureSupabaseResult, ensureValue } from './errors'
import { listMembershipRowsByApartmentId } from './membershipsRepository'

function mapAttachmentRow(row: ExpenseAttachmentRow): ExpenseAttachment {
  return {
    id: row.id,
    name: row.file_name,
    type: row.file_type,
    size: row.file_size,
    url: row.file_url,
  }
}

async function loadMembershipMaps(apartmentId: number) {
  const rows = await listMembershipRowsByApartmentId(apartmentId)
  return {
    accountToMembership: new Map(rows.map((row) => [row.account_id, row.id])),
    membershipToAccount: new Map(rows.map((row) => [row.id, row.account_id])),
  }
}

function mapExpenseRowToModel(
  row: ExpenseRow,
  participants: ExpenseParticipantRow[],
  attachments: ExpenseAttachmentRow[],
  membershipToAccount: Map<number, number>,
): Expense {
  return {
    id: row.id,
    apartment_id: row.apartment_id,
    paid_by: membershipToAccount.get(row.paid_by_membership_id) ?? 0,
    amount: row.amount,
    description: row.description,
    category: row.category,
    date: row.expense_date,
    status: row.status,
    participant_ids: participants
      .map((participant) => membershipToAccount.get(participant.membership_id) ?? 0)
      .filter((userId) => userId > 0),
    attachments: attachments.map(mapAttachmentRow),
  }
}

function mapPaymentRowToModel(
  row: PaymentRow,
  membershipToAccount: Map<number, number>,
): Payment {
  return {
    id: row.id,
    apartment_id: row.apartment_id,
    payer_id: membershipToAccount.get(row.payer_membership_id) ?? 0,
    payee_id: membershipToAccount.get(row.payee_membership_id) ?? 0,
    amount: row.amount,
    status: row.status,
    created_at: row.payment_date,
    note: row.note,
  }
}

function hasMappedExpenseParticipants(
  participants: ExpenseParticipantRow[],
  membershipToAccount: Map<number, number>,
) {
  return participants.every((participant) => (membershipToAccount.get(participant.membership_id) ?? 0) > 0)
}

function hasMappedExpensePayer(
  row: ExpenseRow,
  membershipToAccount: Map<number, number>,
) {
  return (membershipToAccount.get(row.paid_by_membership_id) ?? 0) > 0
}

function hasMappedPaymentMembers(
  row: PaymentRow,
  membershipToAccount: Map<number, number>,
) {
  return (
    (membershipToAccount.get(row.payer_membership_id) ?? 0) > 0 &&
    (membershipToAccount.get(row.payee_membership_id) ?? 0) > 0
  )
}

export async function listExpensesByApartmentId(apartmentId: number) {
  const client = ensureValue(supabase, 'Supabase client is not configured.')
  const { accountToMembership, membershipToAccount } = await loadMembershipMaps(apartmentId)
  if (!accountToMembership.size) return []

  const { data, error } = await client
    .from('expenses')
    .select('*')
    .eq('apartment_id', apartmentId)
    .order('expense_date', { ascending: false })
    .order('id', { ascending: false })
  ensureSupabaseResult(error, 'Failed to load expenses')

  const rows = (data ?? []) as ExpenseRow[]
  if (!rows.length) return []

  const expenseIds = rows.map((row) => row.id)
  const [{ data: participantData, error: participantError }, { data: attachmentData, error: attachmentError }] =
    await Promise.all([
      client.from('expense_participants').select('*').in('expense_id', expenseIds),
      client.from('expense_attachments').select('*').in('expense_id', expenseIds),
    ])

  ensureSupabaseResult(participantError, 'Failed to load expense participants')
  ensureSupabaseResult(attachmentError, 'Failed to load expense attachments')

  const participants = (participantData ?? []) as ExpenseParticipantRow[]
  const attachments = (attachmentData ?? []) as ExpenseAttachmentRow[]

  return rows
    .map((row) => ({
      row,
      rowParticipants: participants.filter((participant) => participant.expense_id === row.id),
      rowAttachments: attachments.filter((attachment) => attachment.expense_id === row.id),
    }))
    .filter(
      ({ row, rowParticipants }) =>
        hasMappedExpensePayer(row, membershipToAccount) &&
        hasMappedExpenseParticipants(rowParticipants, membershipToAccount),
    )
    .map(({ row, rowParticipants, rowAttachments }) =>
      mapExpenseRowToModel(row, rowParticipants, rowAttachments, membershipToAccount),
    )
}

export async function createExpenseRecord(input: {
  apartmentId: number
  paidByAccountId: number
  amount: string
  description: string
  category: string | null
  date: string
  participantAccountIds: number[]
}) {
  const client = ensureValue(supabase, 'Supabase client is not configured.')
  const { accountToMembership } = await loadMembershipMaps(input.apartmentId)
  const paidByMembershipId = accountToMembership.get(input.paidByAccountId)
  if (!paidByMembershipId) throw new Error('לא נמצא שיוך דייר תקף למשלם.')

  const participantMembershipIds = input.participantAccountIds
    .map((accountId) => accountToMembership.get(accountId) ?? 0)
    .filter((membershipId) => membershipId > 0)

  const { data, error } = await client
    .from('expenses')
    .insert({
      apartment_id: input.apartmentId,
      paid_by_membership_id: paidByMembershipId,
      amount: input.amount,
      description: input.description,
      category: input.category,
      expense_date: input.date,
      status: 'active',
    })
    .select('*')
    .single()
  ensureSupabaseResult(error, 'Failed to create expense')

  if (participantMembershipIds.length) {
    const { error: participantsError } = await client.from('expense_participants').insert(
      participantMembershipIds.map((membershipId) => ({
        expense_id: (data as ExpenseRow).id,
        membership_id: membershipId,
      })),
    )
    ensureSupabaseResult(participantsError, 'Failed to create expense participants')
  }

  const expenses = await listExpensesByApartmentId(input.apartmentId)
  return expenses.find((expense) => expense.id === (data as ExpenseRow).id) ?? null
}

export async function updateExpenseRecord(input: {
  expenseId: number
  apartmentId: number
  paidByAccountId: number
  amount: string
  description: string
  category: string | null
  date: string
  participantAccountIds: number[]
}) {
  const client = ensureValue(supabase, 'Supabase client is not configured.')
  const { accountToMembership } = await loadMembershipMaps(input.apartmentId)
  const paidByMembershipId = accountToMembership.get(input.paidByAccountId)
  if (!paidByMembershipId) throw new Error('לא נמצא שיוך דייר תקף למשלם.')

  const participantMembershipIds = input.participantAccountIds
    .map((accountId) => accountToMembership.get(accountId) ?? 0)
    .filter((membershipId) => membershipId > 0)

  const { error } = await client
    .from('expenses')
    .update({
      paid_by_membership_id: paidByMembershipId,
      amount: input.amount,
      description: input.description,
      category: input.category,
      expense_date: input.date,
      updated_at: new Date().toISOString(),
    })
    .eq('id', input.expenseId)
  ensureSupabaseResult(error, 'Failed to update expense')

  const { error: deleteParticipantsError } = await client
    .from('expense_participants')
    .delete()
    .eq('expense_id', input.expenseId)
  ensureSupabaseResult(deleteParticipantsError, 'Failed to reset expense participants')

  if (participantMembershipIds.length) {
    const { error: participantsError } = await client.from('expense_participants').insert(
      participantMembershipIds.map((membershipId) => ({
        expense_id: input.expenseId,
        membership_id: membershipId,
      })),
    )
    ensureSupabaseResult(participantsError, 'Failed to update expense participants')
  }

  const expenses = await listExpensesByApartmentId(input.apartmentId)
  return expenses.find((expense) => expense.id === input.expenseId) ?? null
}

export async function softDeleteExpenseRecord(expenseId: number) {
  const client = ensureValue(supabase, 'Supabase client is not configured.')
  const { error } = await client
    .from('expenses')
    .update({
      status: 'deleted',
      updated_at: new Date().toISOString(),
    })
    .eq('id', expenseId)
  ensureSupabaseResult(error, 'Failed to delete expense')
}

export async function listPaymentsByApartmentId(apartmentId: number) {
  const client = ensureValue(supabase, 'Supabase client is not configured.')
  const { membershipToAccount } = await loadMembershipMaps(apartmentId)

  const { data, error } = await client
    .from('payments')
    .select('*')
    .eq('apartment_id', apartmentId)
    .order('payment_date', { ascending: false })
    .order('id', { ascending: false })
  ensureSupabaseResult(error, 'Failed to load payments')

  return ((data ?? []) as PaymentRow[])
    .filter((row) => hasMappedPaymentMembers(row, membershipToAccount))
    .map((row) => mapPaymentRowToModel(row, membershipToAccount))
}

export async function createPaymentRecord(input: {
  apartmentId: number
  payerAccountId: number
  payeeAccountId: number
  amount: string
  createdAt: string
  note?: string | null
}) {
  const client = ensureValue(supabase, 'Supabase client is not configured.')
  const { accountToMembership } = await loadMembershipMaps(input.apartmentId)
  const payerMembershipId = accountToMembership.get(input.payerAccountId)
  const payeeMembershipId = accountToMembership.get(input.payeeAccountId)
  if (!payerMembershipId || !payeeMembershipId) {
    throw new Error('לא נמצא שיוך דייר תקף לתשלום.')
  }

  const { data, error } = await client
    .from('payments')
    .insert({
      apartment_id: input.apartmentId,
      payer_membership_id: payerMembershipId,
      payee_membership_id: payeeMembershipId,
      amount: input.amount,
      status: 'recorded',
      payment_date: input.createdAt,
      note: input.note ?? null,
    })
    .select('*')
    .single()
  ensureSupabaseResult(error, 'Failed to create payment')

  const payments = await listPaymentsByApartmentId(input.apartmentId)
  return payments.find((payment) => payment.id === (data as PaymentRow).id) ?? null
}

export async function updatePaymentRecord(input: {
  paymentId: number
  apartmentId: number
  payerAccountId: number
  payeeAccountId: number
  amount: string
  createdAt: string
  note?: string | null
}) {
  const client = ensureValue(supabase, 'Supabase client is not configured.')
  const { accountToMembership } = await loadMembershipMaps(input.apartmentId)
  const payerMembershipId = accountToMembership.get(input.payerAccountId)
  const payeeMembershipId = accountToMembership.get(input.payeeAccountId)
  if (!payerMembershipId || !payeeMembershipId) {
    throw new Error('לא נמצא שיוך דייר תקף לתשלום.')
  }

  const { error } = await client
    .from('payments')
    .update({
      payer_membership_id: payerMembershipId,
      payee_membership_id: payeeMembershipId,
      amount: input.amount,
      payment_date: input.createdAt,
      note: input.note ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', input.paymentId)
  ensureSupabaseResult(error, 'Failed to update payment')

  const payments = await listPaymentsByApartmentId(input.apartmentId)
  return payments.find((payment) => payment.id === input.paymentId) ?? null
}

export async function softDeletePaymentRecord(paymentId: number) {
  const client = ensureValue(supabase, 'Supabase client is not configured.')
  const { error } = await client
    .from('payments')
    .update({
      status: 'cancelled',
      updated_at: new Date().toISOString(),
    })
    .eq('id', paymentId)
  ensureSupabaseResult(error, 'Failed to delete payment')
}
