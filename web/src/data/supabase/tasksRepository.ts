import type { Task } from '../../types/models'
import type { TaskRow } from '../../types/database'
import { supabase } from '../../lib/supabase/client'
import { ensureSupabaseResult, ensureValue } from './errors'
import { listMembershipRowsByApartmentId } from './membershipsRepository'

async function loadMembershipMaps(apartmentId: number) {
  const rows = await listMembershipRowsByApartmentId(apartmentId)
  return {
    accountToMembership: new Map(rows.map((row) => [row.account_id, row.id])),
    membershipToAccount: new Map(rows.map((row) => [row.id, row.account_id])),
  }
}

function mapTaskRowToModel(row: TaskRow, membershipToAccount: Map<number, number>) {
  const task: Task = {
    id: row.id,
    apartment_id: row.apartment_id,
    title: row.title,
    description: row.description,
    assignee_id:
      row.assignee_membership_id == null
        ? null
        : (membershipToAccount.get(row.assignee_membership_id) ?? null),
    due_date: row.due_date,
    status: row.status,
    created_by: membershipToAccount.get(row.created_by_membership_id) ?? 0,
  }

  return task
}

export async function listTasksByApartmentId(apartmentId: number) {
  const client = ensureValue(supabase, 'Supabase client is not configured.')
  const { membershipToAccount } = await loadMembershipMaps(apartmentId)

  const { data, error } = await client
    .from('tasks')
    .select('*')
    .eq('apartment_id', apartmentId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
  ensureSupabaseResult(error, 'Failed to load tasks')

  return ((data ?? []) as TaskRow[]).map((row) => mapTaskRowToModel(row, membershipToAccount))
}

export async function createTaskRecord(input: {
  apartmentId: number
  title: string
  assigneeAccountId: number | null
  dueDate: string | null
  status: Task['status']
  createdByAccountId: number
}) {
  const client = ensureValue(supabase, 'Supabase client is not configured.')
  const { accountToMembership } = await loadMembershipMaps(input.apartmentId)
  const createdByMembershipId = accountToMembership.get(input.createdByAccountId)

  if (!createdByMembershipId) {
    throw new Error('לא נמצא שיוך דייר תקף ליוצר המטלה.')
  }

  const assigneeMembershipId =
    input.assigneeAccountId == null ? null : (accountToMembership.get(input.assigneeAccountId) ?? null)

  const { data, error } = await client
    .from('tasks')
    .insert({
      apartment_id: input.apartmentId,
      title: input.title,
      description: null,
      assignee_membership_id: assigneeMembershipId,
      due_date: input.dueDate,
      status: input.status,
      created_by_membership_id: createdByMembershipId,
    })
    .select('*')
    .single()
  ensureSupabaseResult(error, 'Failed to create task')

  const tasks = await listTasksByApartmentId(input.apartmentId)
  return tasks.find((task) => task.id === (data as TaskRow).id) ?? null
}

export async function updateTaskRecord(input: {
  apartmentId: number
  taskId: number
  title: string
  assigneeAccountId: number | null
  dueDate: string | null
  status: Task['status']
}) {
  const client = ensureValue(supabase, 'Supabase client is not configured.')
  const { accountToMembership } = await loadMembershipMaps(input.apartmentId)
  const assigneeMembershipId =
    input.assigneeAccountId == null ? null : (accountToMembership.get(input.assigneeAccountId) ?? null)

  const { error } = await client
    .from('tasks')
    .update({
      title: input.title,
      assignee_membership_id: assigneeMembershipId,
      due_date: input.dueDate,
      status: input.status,
      updated_at: new Date().toISOString(),
    })
    .eq('id', input.taskId)
  ensureSupabaseResult(error, 'Failed to update task')

  const tasks = await listTasksByApartmentId(input.apartmentId)
  return tasks.find((task) => task.id === input.taskId) ?? null
}

export async function deleteTaskRecord(taskId: number) {
  const client = ensureValue(supabase, 'Supabase client is not configured.')
  const { error } = await client.from('tasks').delete().eq('id', taskId)
  ensureSupabaseResult(error, 'Failed to delete task')
}
