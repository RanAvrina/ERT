import { ApiError } from '../lib/api-error.js'
import { supabaseAdmin } from '../lib/supabase.js'
import { listActiveMembershipsByApartmentId } from './membership-service.js'

interface TaskRow {
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

async function loadMembershipMaps(apartmentId: number) {
  const rows = await listActiveMembershipsByApartmentId(apartmentId)
  return {
    accountToMembership: new Map(rows.map((row) => [row.account_id, row.id])),
    membershipToAccount: new Map(rows.map((row) => [row.id, row.account_id])),
  }
}

function mapTask(row: TaskRow, membershipToAccount: Map<number, number>) {
  return {
    id: row.id,
    apartmentId: row.apartment_id,
    title: row.title,
    description: row.description,
    assigneeAccountId:
      row.assignee_membership_id == null ? null : (membershipToAccount.get(row.assignee_membership_id) ?? null),
    dueDate: row.due_date,
    status: row.status,
    createdByAccountId: membershipToAccount.get(row.created_by_membership_id) ?? 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function requireMembershipId(map: Map<number, number>, accountId: number, contextLabel: string) {
  const membershipId = map.get(accountId)
  if (!membershipId) {
    throw new ApiError(400, `No active apartment membership was found for ${contextLabel}.`)
  }

  return membershipId
}

export async function listTasksByApartmentId(apartmentId: number) {
  const { membershipToAccount } = await loadMembershipMaps(apartmentId)
  const { data, error } = await supabaseAdmin
    .from('tasks')
    .select('*')
    .eq('apartment_id', apartmentId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })

  if (error) throw new Error(`Failed to load tasks: ${error.message}`)
  return ((data ?? []) as TaskRow[]).map((row) => mapTask(row, membershipToAccount))
}

export async function createTask(input: {
  apartmentId: number
  title: string
  description?: string | null
  assigneeAccountId: number | null
  dueDate: string | null
  status: TaskRow['status']
  createdByAccountId: number
}) {
  const { accountToMembership } = await loadMembershipMaps(input.apartmentId)
  const createdByMembershipId = requireMembershipId(accountToMembership, input.createdByAccountId, 'the task creator')
  const assigneeMembershipId =
    input.assigneeAccountId == null ? null : requireMembershipId(accountToMembership, input.assigneeAccountId, 'the task assignee')

  const { data, error } = await supabaseAdmin
    .from('tasks')
    .insert({
      apartment_id: input.apartmentId,
      title: input.title,
      description: input.description ?? null,
      assignee_membership_id: assigneeMembershipId,
      due_date: input.dueDate,
      status: input.status,
      created_by_membership_id: createdByMembershipId,
    })
    .select('*')
    .single()

  if (error) throw new Error(`Failed to create task: ${error.message}`)
  const taskRow = data as TaskRow
  const tasks = await listTasksByApartmentId(input.apartmentId)
  return tasks.find((task) => task.id === taskRow.id) ?? null
}

export async function updateTask(input: {
  apartmentId: number
  taskId: number
  title: string
  description?: string | null
  assigneeAccountId: number | null
  dueDate: string | null
  status: TaskRow['status']
}) {
  const { accountToMembership } = await loadMembershipMaps(input.apartmentId)
  const assigneeMembershipId =
    input.assigneeAccountId == null ? null : requireMembershipId(accountToMembership, input.assigneeAccountId, 'the task assignee')

  const { error } = await supabaseAdmin
    .from('tasks')
    .update({
      title: input.title,
      description: input.description ?? null,
      assignee_membership_id: assigneeMembershipId,
      due_date: input.dueDate,
      status: input.status,
      updated_at: new Date().toISOString(),
    })
    .eq('id', input.taskId)

  if (error) throw new Error(`Failed to update task: ${error.message}`)
  const tasks = await listTasksByApartmentId(input.apartmentId)
  return tasks.find((task) => task.id === input.taskId) ?? null
}

export async function deleteTask(taskId: number) {
  const { error } = await supabaseAdmin.from('tasks').delete().eq('id', taskId)
  if (error) throw new Error(`Failed to delete task: ${error.message}`)
}
