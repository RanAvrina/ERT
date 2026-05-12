import { apiRequest } from '../../lib/api/client'
import type { Task, TaskStatus } from '../../types/models'

interface TaskApiResponse {
  id: number
  apartmentId: number
  title: string
  description: string | null
  assigneeAccountId: number | null
  dueDate: string | null
  status: TaskStatus
  createdByAccountId: number
}

function mapTask(task: TaskApiResponse): Task {
  return {
    id: task.id,
    apartment_id: task.apartmentId,
    title: task.title,
    description: task.description,
    assignee_id: task.assigneeAccountId,
    due_date: task.dueDate,
    status: task.status,
    created_by: task.createdByAccountId,
  }
}

export async function listTasksViaApi(apartmentId: number) {
  return apiRequest<{ tasks: TaskApiResponse[] }>(`/apartments/${apartmentId}/tasks`, {
    method: 'GET',
  }).then((response) => response.tasks.map(mapTask))
}

export async function createTaskViaApi(input: {
  apartmentId: number
  title: string
  description?: string | null
  assigneeAccountId: number | null
  dueDate: string | null
  status: TaskStatus
}) {
  return apiRequest<{ task: TaskApiResponse | null }>(`/apartments/${input.apartmentId}/tasks`, {
    method: 'POST',
    body: JSON.stringify(input),
  }).then((response) => (response.task ? mapTask(response.task) : null))
}

export async function updateTaskViaApi(input: {
  apartmentId: number
  taskId: number
  title: string
  description?: string | null
  assigneeAccountId: number | null
  dueDate: string | null
  status: TaskStatus
}) {
  return apiRequest<{ task: TaskApiResponse | null }>(
    `/apartments/${input.apartmentId}/tasks/${input.taskId}`,
    {
      method: 'PUT',
      body: JSON.stringify(input),
    },
  ).then((response) => (response.task ? mapTask(response.task) : null))
}

export async function deleteTaskViaApi(apartmentId: number, taskId: number) {
  return apiRequest<null>(`/apartments/${apartmentId}/tasks/${taskId}`, {
    method: 'DELETE',
  })
}
