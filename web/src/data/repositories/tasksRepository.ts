import type { TasksRepository } from '../contracts/repositories'
import type { Task } from '../../types/models'
import { useMemoryValue } from '../persistence/useMemoryValue'

const tasksRepository: TasksRepository = {
  useTasksStore() {
    return useMemoryValue<Task[]>([])
  },
}

export function useTasksStore() {
  return tasksRepository.useTasksStore()
}
