import { randomUUID } from 'node:crypto'
import { ApiError } from '../lib/api-error.js'
import { supabaseAdmin } from '../lib/supabase.js'
import { listActiveMembershipsByApartmentId } from './membership-service.js'

interface ExpenseRow {
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

interface ExpenseParticipantRow {
  expense_id: number
  membership_id: number
}

interface ExpenseAttachmentRow {
  id: string
  expense_id: number
  file_name: string
  file_type: string
  file_size: number
  file_url: string
}

interface PaymentRow {
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

function toUuid(id?: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    id ?? '',
  )
    ? id!
    : randomUUID()
}

function mapExpenseAttachmentRow(row: ExpenseAttachmentRow) {
  return {
    id: row.id,
    name: row.file_name,
    type: row.file_type,
    size: row.file_size,
    url: row.file_url,
  }
}

async function loadMembershipMaps(apartmentId: number) {
  const rows = await listActiveMembershipsByApartmentId(apartmentId)
  return {
    accountToMembership: new Map(rows.map((row) => [row.account_id, row.id])),
    membershipToAccount: new Map(rows.map((row) => [row.id, row.account_id])),
  }
}

function requireMembershipId(map: Map<number, number>, accountId: number, contextLabel: string) {
  const membershipId = map.get(accountId)
  if (!membershipId) {
    throw new ApiError(400, `No active apartment membership was found for ${contextLabel}.`)
  }

  return membershipId
}

function mapExpense(
  row: ExpenseRow,
  participants: ExpenseParticipantRow[],
  attachments: ExpenseAttachmentRow[],
  membershipToAccount: Map<number, number>,
) {
  return {
    id: row.id,
    apartmentId: row.apartment_id,
    paidByAccountId: membershipToAccount.get(row.paid_by_membership_id) ?? 0,
    amount: row.amount,
    description: row.description,
    category: row.category,
    date: row.expense_date,
    status: row.status,
    participantAccountIds: participants
      .map((participant) => membershipToAccount.get(participant.membership_id) ?? 0)
      .filter((accountId) => accountId > 0),
    attachments: attachments.map(mapExpenseAttachmentRow),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function mapPayment(row: PaymentRow, membershipToAccount: Map<number, number>) {
  return {
    id: row.id,
    apartmentId: row.apartment_id,
    payerAccountId: membershipToAccount.get(row.payer_membership_id) ?? 0,
    payeeAccountId: membershipToAccount.get(row.payee_membership_id) ?? 0,
    amount: row.amount,
    status: row.status,
    paymentDate: row.payment_date,
    note: row.note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

async function getExpenseById(expenseId: number, membershipToAccount: Map<number, number>) {
  const { data, error } = await supabaseAdmin
    .from('expenses')
    .select('*')
    .eq('id', expenseId)
    .single()

  if (error) throw new Error(`Failed to load expense: ${error.message}`)
  const row = data as ExpenseRow

  const [{ data: participantsData, error: participantsError }, { data: attachmentsData, error: attachmentsError }] =
    await Promise.all([
      supabaseAdmin.from('expense_participants').select('*').eq('expense_id', expenseId),
      supabaseAdmin.from('expense_attachments').select('*').eq('expense_id', expenseId),
    ])

  if (participantsError) throw new Error(`Failed to load expense participants: ${participantsError.message}`)
  if (attachmentsError) throw new Error(`Failed to load expense attachments: ${attachmentsError.message}`)

  return mapExpense(
    row,
    (participantsData ?? []) as ExpenseParticipantRow[],
    (attachmentsData ?? []) as ExpenseAttachmentRow[],
    membershipToAccount,
  )
}

async function requireExpenseRowInApartment(apartmentId: number, expenseId: number) {
  const { data, error } = await supabaseAdmin
    .from('expenses')
    .select('*')
    .eq('id', expenseId)
    .single()

  if (error) {
    if (error.code === 'PGRST116') {
      throw new ApiError(404, 'Expense not found.')
    }
    throw new Error(`Failed to load expense: ${error.message}`)
  }

  const row = data as ExpenseRow
  if (row.apartment_id !== apartmentId) {
    throw new ApiError(404, 'Expense not found in this apartment.')
  }

  return row
}

async function getPaymentById(paymentId: number, membershipToAccount: Map<number, number>) {
  const { data, error } = await supabaseAdmin
    .from('payments')
    .select('*')
    .eq('id', paymentId)
    .single()

  if (error) throw new Error(`Failed to load payment: ${error.message}`)
  return mapPayment(data as PaymentRow, membershipToAccount)
}

async function requirePaymentRowInApartment(apartmentId: number, paymentId: number) {
  const { data, error } = await supabaseAdmin
    .from('payments')
    .select('*')
    .eq('id', paymentId)
    .single()

  if (error) {
    if (error.code === 'PGRST116') {
      throw new ApiError(404, 'Payment not found.')
    }
    throw new Error(`Failed to load payment: ${error.message}`)
  }

  const row = data as PaymentRow
  if (row.apartment_id !== apartmentId) {
    throw new ApiError(404, 'Payment not found in this apartment.')
  }

  return row
}

export async function listExpensesByApartmentId(apartmentId: number) {
  const { membershipToAccount } = await loadMembershipMaps(apartmentId)
  const { data, error } = await supabaseAdmin
    .from('expenses')
    .select('*')
    .eq('apartment_id', apartmentId)
    .order('expense_date', { ascending: false })
    .order('id', { ascending: false })

  if (error) throw new Error(`Failed to load expenses: ${error.message}`)

  const rows = (data ?? []) as ExpenseRow[]
  if (!rows.length) return []

  const expenseIds = rows.map((row) => row.id)
  const [{ data: participantsData, error: participantsError }, { data: attachmentsData, error: attachmentsError }] =
    await Promise.all([
      supabaseAdmin.from('expense_participants').select('*').in('expense_id', expenseIds),
      supabaseAdmin.from('expense_attachments').select('*').in('expense_id', expenseIds),
    ])

  if (participantsError) throw new Error(`Failed to load expense participants: ${participantsError.message}`)
  if (attachmentsError) throw new Error(`Failed to load expense attachments: ${attachmentsError.message}`)

  const participants = (participantsData ?? []) as ExpenseParticipantRow[]
  const attachments = (attachmentsData ?? []) as ExpenseAttachmentRow[]

  return rows.map((row) =>
    mapExpense(
      row,
      participants.filter((participant) => participant.expense_id === row.id),
      attachments.filter((attachment) => attachment.expense_id === row.id),
      membershipToAccount,
    ),
  )
}

export async function createExpense(input: {
  apartmentId: number
  paidByAccountId: number
  amount: string
  description: string
  category: string | null
  date: string
  participantAccountIds: number[]
  attachments?: Array<{ id?: string; name: string; type: string; size: number; url: string }>
}) {
  const { accountToMembership, membershipToAccount } = await loadMembershipMaps(input.apartmentId)
  const paidByMembershipId = requireMembershipId(accountToMembership, input.paidByAccountId, 'the payer')
  const participantMembershipIds = input.participantAccountIds.map((accountId) =>
    requireMembershipId(accountToMembership, accountId, 'an expense participant'),
  )

  const { data, error } = await supabaseAdmin
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

  if (error) throw new Error(`Failed to create expense: ${error.message}`)
  const expenseRow = data as ExpenseRow

  if (participantMembershipIds.length) {
    const { error: participantsError } = await supabaseAdmin.from('expense_participants').insert(
      participantMembershipIds.map((membershipId) => ({
        expense_id: expenseRow.id,
        membership_id: membershipId,
      })),
    )

    if (participantsError) throw new Error(`Failed to create expense participants: ${participantsError.message}`)
  }

  if (input.attachments?.length) {
    const { error: attachmentsError } = await supabaseAdmin.from('expense_attachments').insert(
      input.attachments.map((attachment) => ({
        id: toUuid(attachment.id),
        expense_id: expenseRow.id,
        file_name: attachment.name,
        file_type: attachment.type,
        file_size: attachment.size,
        file_url: attachment.url,
      })),
    )

    if (attachmentsError) throw new Error(`Failed to create expense attachments: ${attachmentsError.message}`)
  }

  return getExpenseById(expenseRow.id, membershipToAccount)
}

export async function updateExpense(input: {
  apartmentId: number
  expenseId: number
  paidByAccountId: number
  amount: string
  description: string
  category: string | null
  date: string
  participantAccountIds: number[]
  attachments?: Array<{ id?: string; name: string; type: string; size: number; url: string }>
}) {
  const { accountToMembership, membershipToAccount } = await loadMembershipMaps(input.apartmentId)
  await requireExpenseRowInApartment(input.apartmentId, input.expenseId)
  const paidByMembershipId = requireMembershipId(accountToMembership, input.paidByAccountId, 'the payer')
  const participantMembershipIds = input.participantAccountIds.map((accountId) =>
    requireMembershipId(accountToMembership, accountId, 'an expense participant'),
  )

  const { error } = await supabaseAdmin
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

  if (error) throw new Error(`Failed to update expense: ${error.message}`)

  const { error: deleteParticipantsError } = await supabaseAdmin
    .from('expense_participants')
    .delete()
    .eq('expense_id', input.expenseId)

  if (deleteParticipantsError) {
    throw new Error(`Failed to reset expense participants: ${deleteParticipantsError.message}`)
  }

  if (participantMembershipIds.length) {
    const { error: participantsError } = await supabaseAdmin.from('expense_participants').insert(
      participantMembershipIds.map((membershipId) => ({
        expense_id: input.expenseId,
        membership_id: membershipId,
      })),
    )

    if (participantsError) throw new Error(`Failed to update expense participants: ${participantsError.message}`)
  }

  const { error: deleteAttachmentsError } = await supabaseAdmin
    .from('expense_attachments')
    .delete()
    .eq('expense_id', input.expenseId)

  if (deleteAttachmentsError) {
    throw new Error(`Failed to reset expense attachments: ${deleteAttachmentsError.message}`)
  }

  if (input.attachments?.length) {
    const { error: attachmentsError } = await supabaseAdmin.from('expense_attachments').insert(
      input.attachments.map((attachment) => ({
        id: toUuid(attachment.id),
        expense_id: input.expenseId,
        file_name: attachment.name,
        file_type: attachment.type,
        file_size: attachment.size,
        file_url: attachment.url,
      })),
    )

    if (attachmentsError) throw new Error(`Failed to update expense attachments: ${attachmentsError.message}`)
  }

  return getExpenseById(input.expenseId, membershipToAccount)
}

export async function softDeleteExpense(apartmentId: number, expenseId: number) {
  await requireExpenseRowInApartment(apartmentId, expenseId)
  const { error } = await supabaseAdmin
    .from('expenses')
    .update({
      status: 'deleted',
      updated_at: new Date().toISOString(),
    })
    .eq('id', expenseId)

  if (error) throw new Error(`Failed to delete expense: ${error.message}`)
}

export async function listPaymentsByApartmentId(apartmentId: number) {
  const { membershipToAccount } = await loadMembershipMaps(apartmentId)
  const { data, error } = await supabaseAdmin
    .from('payments')
    .select('*')
    .eq('apartment_id', apartmentId)
    .order('payment_date', { ascending: false })
    .order('id', { ascending: false })

  if (error) throw new Error(`Failed to load payments: ${error.message}`)
  return ((data ?? []) as PaymentRow[]).map((row) => mapPayment(row, membershipToAccount))
}

export async function createPayment(input: {
  apartmentId: number
  payerAccountId: number
  payeeAccountId: number
  amount: string
  paymentDate: string
  note?: string | null
}) {
  const { accountToMembership, membershipToAccount } = await loadMembershipMaps(input.apartmentId)
  const payerMembershipId = requireMembershipId(accountToMembership, input.payerAccountId, 'the payer')
  const payeeMembershipId = requireMembershipId(accountToMembership, input.payeeAccountId, 'the payee')

  const { data, error } = await supabaseAdmin
    .from('payments')
    .insert({
      apartment_id: input.apartmentId,
      payer_membership_id: payerMembershipId,
      payee_membership_id: payeeMembershipId,
      amount: input.amount,
      status: 'recorded',
      payment_date: input.paymentDate,
      note: input.note ?? null,
    })
    .select('*')
    .single()

  if (error) throw new Error(`Failed to create payment: ${error.message}`)
  const paymentRow = data as PaymentRow
  return getPaymentById(paymentRow.id, membershipToAccount)
}

export async function updatePayment(input: {
  apartmentId: number
  paymentId: number
  payerAccountId: number
  payeeAccountId: number
  amount: string
  paymentDate: string
  note?: string | null
}) {
  const { accountToMembership, membershipToAccount } = await loadMembershipMaps(input.apartmentId)
  await requirePaymentRowInApartment(input.apartmentId, input.paymentId)
  const payerMembershipId = requireMembershipId(accountToMembership, input.payerAccountId, 'the payer')
  const payeeMembershipId = requireMembershipId(accountToMembership, input.payeeAccountId, 'the payee')

  const { error } = await supabaseAdmin
    .from('payments')
    .update({
      payer_membership_id: payerMembershipId,
      payee_membership_id: payeeMembershipId,
      amount: input.amount,
      payment_date: input.paymentDate,
      note: input.note ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', input.paymentId)

  if (error) throw new Error(`Failed to update payment: ${error.message}`)
  return getPaymentById(input.paymentId, membershipToAccount)
}

export async function softDeletePayment(apartmentId: number, paymentId: number) {
  await requirePaymentRowInApartment(apartmentId, paymentId)
  const { error } = await supabaseAdmin
    .from('payments')
    .update({
      status: 'cancelled',
      updated_at: new Date().toISOString(),
    })
    .eq('id', paymentId)

  if (error) throw new Error(`Failed to delete payment: ${error.message}`)
}
