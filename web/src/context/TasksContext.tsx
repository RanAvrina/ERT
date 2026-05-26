/* eslint-disable react-refresh/only-export-components */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from 'react'
import { useTasksStore } from '../data/repositories/tasksRepository'
import {
  createTaskViaApi,
  deleteTaskViaApi,
  listTasksViaApi,
  updateTaskViaApi,
} from '../data/server/tasksApi'
import { isSupabaseConfigured } from '../lib/supabase/env'
import { useApartment } from './ApartmentContext'
import type { Task, TaskStatus } from '../types/models'

const ASSISTANT_DATA_CHANGED_EVENT = 'assistant:data-changed'

interface NewTaskInput {
  apartment_id: number
  title: string
  description: string | null
  assignee_id: number
  due_date: string
  status: TaskStatus
  created_by: number
}

interface UpdateTaskInput {
  title: string
  description: string | null
  assignee_id: number
  due_date: string
  status: TaskStatus
}

interface TasksState {
  tasks: Task[]
  addTask: (task: NewTaskInput) => Promise<Task | null>
  updateTask: (taskId: number, task: UpdateTaskInput) => Promise<Task | null>
  updateTaskStatus: (taskId: number, status: TaskStatus) => Promise<Task | null>
  deleteTask: (taskId: number) => Promise<void>
}

const TasksContext = createContext<TasksState | null>(null)

export function isTaskIncomplete(task: Task) {
  return task.status !== 'done' && task.status !== 'cancelled'
}

export function getTodayDate() {
  return new Date().toISOString().slice(0, 10)
}

export function isTaskOverdue(task: Task, today = getTodayDate()) {
  return Boolean(task.due_date && task.due_date < today && isTaskIncomplete(task))
}

export function TasksProvider({ children }: { children: ReactNode }) {
  const { current } = useApartment()
  const [tasks, setTasks] = useTasksStore()
  const nextTaskId = useRef(Math.max(...tasks.map((item) => item.id), 0) + 1)
  const nextTempTaskId = useRef(-1)
  const loadedApartmentIdRef = useRef<number | null>(null)

  useEffect(() => {
    let cancelled = false

    async function loadApartmentTasks() {
      if (!isSupabaseConfigured || !current?.apartment.id) return
      if (loadedApartmentIdRef.current === current.apartment.id) return

      try {
        const nextTasks = await listTasksViaApi(current.apartment.id)
        if (!cancelled) {
          setTasks(nextTasks)
          nextTaskId.current = Math.max(...nextTasks.map((item) => item.id), 0) + 1
          loadedApartmentIdRef.current = current.apartment.id
        }
      } catch {
        if (!cancelled) {
          setTasks([])
          loadedApartmentIdRef.current = null
        }
      }
    }

    void loadApartmentTasks()

    return () => {
      cancelled = true
    }
  }, [current?.apartment.id, setTasks])

  useEffect(() => {
    const apartmentId: number | null = current?.apartment.id ?? null
    if (!isSupabaseConfigured || !apartmentId) return
    const resolvedApartmentId = apartmentId

    async function refreshTasks() {
      try {
        const nextTasks = await listTasksViaApi(resolvedApartmentId)
        setTasks(nextTasks)
        nextTaskId.current = Math.max(...nextTasks.map((item) => item.id), 0) + 1
        loadedApartmentIdRef.current = resolvedApartmentId
      } catch (error) {
        console.error('Failed to refresh tasks after assistant action.', error)
      }
    }

    function handleAssistantDataChanged(event: Event) {
      const customEvent = event as CustomEvent<{ apartmentId?: number }>
      if (customEvent.detail?.apartmentId !== resolvedApartmentId) return
      void refreshTasks()
    }

    window.addEventListener(ASSISTANT_DATA_CHANGED_EVENT, handleAssistantDataChanged)
    return () => {
      window.removeEventListener(ASSISTANT_DATA_CHANGED_EVENT, handleAssistantDataChanged)
    }
  }, [current?.apartment.id, setTasks])

  const addTask = useCallback(
    (task: NewTaskInput) => {
      if (isSupabaseConfigured) {
        const optimisticTask: Task = {
          id: nextTempTaskId.current,
          apartment_id: task.apartment_id,
          title: task.title,
          description: task.description,
          assignee_id: task.assignee_id,
          due_date: task.due_date,
          status: task.status,
          created_by: task.created_by,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }
        nextTempTaskId.current -= 1

        setTasks((currentTasks) => [optimisticTask, ...currentTasks])

        void createTaskViaApi({
          apartmentId: task.apartment_id,
          title: task.title,
          description: task.description,
          assigneeAccountId: task.assignee_id,
          dueDate: task.due_date,
          status: task.status,
        })
          .then((nextTask) => {
            if (!nextTask) {
              setTasks((currentTasks) =>
                currentTasks.filter((item) => item.id !== optimisticTask.id),
              )
              return
            }

            setTasks((currentTasks) =>
              currentTasks.map((item) => (item.id === optimisticTask.id ? nextTask : item)),
            )
          })
          .catch((error) => {
            console.error('Failed to create task.', error)
            setTasks((currentTasks) =>
              currentTasks.filter((item) => item.id !== optimisticTask.id),
            )
          })

        return Promise.resolve(optimisticTask)
      }

      const nextTask: Task = {
        id: nextTaskId.current,
        apartment_id: task.apartment_id,
        title: task.title,
        description: task.description,
        assignee_id: task.assignee_id,
        due_date: task.due_date,
        status: task.status,
        created_by: task.created_by,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }
      nextTaskId.current += 1
      setTasks((currentTasks) => [nextTask, ...currentTasks])
      return Promise.resolve(nextTask)
    },
    [setTasks],
  )

  const updateTaskStatus = useCallback(
    (taskId: number, status: TaskStatus) => {
      const currentTask = tasks.find((task) => task.id === taskId)
      if (!currentTask) return Promise.resolve(null)

      if (isSupabaseConfigured) {
        const optimisticTask: Task = { ...currentTask, status }
        optimisticTask.updated_at = new Date().toISOString()
        setTasks((currentTasks) =>
          currentTasks.map((task) => (task.id === taskId ? optimisticTask : task)),
        )

        const apartmentId = current?.apartment.id ?? 0
        void updateTaskViaApi({
          apartmentId,
          taskId,
          title: currentTask.title,
          description: currentTask.description,
          assigneeAccountId: currentTask.assignee_id,
          dueDate: currentTask.due_date,
          status,
        })
          .then((updatedTask) => {
            if (!updatedTask) {
              setTasks((currentTasks) =>
                currentTasks.map((task) => (task.id === taskId ? currentTask : task)),
              )
              return
            }

            setTasks((currentTasks) =>
              currentTasks.map((task) => (task.id === taskId ? updatedTask : task)),
            )
          })
          .catch((error) => {
            console.error('Failed to update task status.', error)
            setTasks((currentTasks) =>
              currentTasks.map((task) => (task.id === taskId ? currentTask : task)),
            )
          })

        return Promise.resolve(optimisticTask)
      }

      let updatedTask: Task | null = null
      setTasks((currentTasks) =>
        currentTasks.map((task) => {
          if (task.id !== taskId) return task
          updatedTask = { ...task, status }
          return updatedTask
        }),
      )
      return Promise.resolve(updatedTask)
    },
    [current?.apartment.id, setTasks, tasks],
  )

  const updateTask = useCallback(
    (taskId: number, task: UpdateTaskInput) => {
      if (isSupabaseConfigured) {
        const apartmentId = current?.apartment.id ?? 0
        const currentTask = tasks.find((item) => item.id === taskId)
        if (!currentTask) return Promise.resolve(null)

        const optimisticTask: Task = {
          ...currentTask,
          title: task.title,
          description: task.description,
          assignee_id: task.assignee_id,
          due_date: task.due_date,
          status: task.status,
          updated_at: new Date().toISOString(),
        }

        setTasks((currentTasks) =>
          currentTasks.map((item) => (item.id === taskId ? optimisticTask : item)),
        )

        void updateTaskViaApi({
          apartmentId,
          taskId,
          title: task.title,
          description: task.description,
          assigneeAccountId: task.assignee_id,
          dueDate: task.due_date,
          status: task.status,
        })
          .then((updatedTask) => {
            if (!updatedTask) {
              setTasks((currentTasks) =>
                currentTasks.map((item) => (item.id === taskId ? currentTask : item)),
              )
              return
            }

            setTasks((currentTasks) =>
              currentTasks.map((item) => (item.id === taskId ? updatedTask : item)),
            )
          })
          .catch((error) => {
            console.error('Failed to update task.', error)
            setTasks((currentTasks) =>
              currentTasks.map((item) => (item.id === taskId ? currentTask : item)),
            )
          })

        return Promise.resolve(optimisticTask)
      }

      let updatedTask: Task | null = null

      setTasks((currentTasks) =>
        currentTasks.map((item) => {
          if (item.id !== taskId) return item
          updatedTask = {
            ...item,
            title: task.title,
            description: task.description,
            assignee_id: task.assignee_id,
            due_date: task.due_date,
            status: task.status,
            updated_at: new Date().toISOString(),
          }
          return updatedTask
        }),
      )

      return Promise.resolve(updatedTask)
    },
    [current?.apartment.id, setTasks, tasks],
  )

  const deleteTask = useCallback(
    async (taskId: number) => {
      const previousTask = tasks.find((task) => task.id === taskId)
      if (isSupabaseConfigured) {
        const apartmentId = current?.apartment.id ?? 0
        setTasks((currentTasks) => currentTasks.filter((task) => task.id !== taskId))

        try {
          await deleteTaskViaApi(apartmentId, taskId)
          return
        } catch (error) {
          console.error('Failed to delete task.', error)
          if (previousTask) {
            setTasks((currentTasks) => [previousTask, ...currentTasks])
          }
          throw error
        }
      }

      setTasks((currentTasks) => currentTasks.filter((task) => task.id !== taskId))
    },
    [current?.apartment.id, setTasks, tasks],
  )

  const value = useMemo(
    () => ({ tasks, addTask, updateTask, updateTaskStatus, deleteTask }),
    [tasks, addTask, updateTask, updateTaskStatus, deleteTask],
  )

  return <TasksContext.Provider value={value}>{children}</TasksContext.Provider>
}

export function useTasks() {
  const context = useContext(TasksContext)
  if (!context) throw new Error('useTasks must be used within TasksProvider')
  return context
}
