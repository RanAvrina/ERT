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
  updateTaskViaApi,
} from '../data/server/tasksApi'
import { listTasksByApartmentId } from '../data/supabase/tasksRepository'
import { isSupabaseConfigured } from '../lib/supabase/env'
import { useApartment } from './ApartmentContext'
import type { Task, TaskStatus } from '../types/models'

interface NewTaskInput {
  apartment_id: number
  title: string
  assignee_id: number
  due_date: string
  status: TaskStatus
  created_by: number
}

interface UpdateTaskInput {
  title: string
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
  const loadedApartmentIdRef = useRef<number | null>(null)

  useEffect(() => {
    let cancelled = false

    async function loadApartmentTasks() {
      if (!isSupabaseConfigured || !current?.apartment.id) return
      if (loadedApartmentIdRef.current === current.apartment.id) return

      try {
        const nextTasks = await listTasksByApartmentId(current.apartment.id)
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

  const addTask = useCallback(
    async (task: NewTaskInput) => {
      if (isSupabaseConfigured) {
        const nextTask = await createTaskViaApi({
          apartmentId: task.apartment_id,
          title: task.title,
          description: null,
          assigneeAccountId: task.assignee_id,
          dueDate: task.due_date,
          status: task.status,
        })

        if (!nextTask) return null
        setTasks((currentTasks) => [nextTask, ...currentTasks.filter((item) => item.id !== nextTask.id)])
        return nextTask
      }

      const nextTask: Task = {
        id: nextTaskId.current,
        apartment_id: task.apartment_id,
        title: task.title,
        description: null,
        assignee_id: task.assignee_id,
        due_date: task.due_date,
        status: task.status,
        created_by: task.created_by,
      }
      nextTaskId.current += 1
      setTasks((currentTasks) => [nextTask, ...currentTasks])
      return nextTask
    },
    [setTasks],
  )

  const updateTaskStatus = useCallback(
    async (taskId: number, status: TaskStatus) => {
      const currentTask = tasks.find((task) => task.id === taskId)
      if (!currentTask) return null

      if (isSupabaseConfigured) {
        const apartmentId = current?.apartment.id ?? 0
        const updatedTask = await updateTaskViaApi({
          apartmentId,
          taskId,
          title: currentTask.title,
          description: currentTask.description,
          assigneeAccountId: currentTask.assignee_id,
          dueDate: currentTask.due_date,
          status,
        })

        if (!updatedTask) return null
        setTasks((currentTasks) =>
          currentTasks.map((task) => (task.id === taskId ? updatedTask : task)),
        )
        return updatedTask
      }

      let updatedTask: Task | null = null
      setTasks((currentTasks) =>
        currentTasks.map((task) => {
          if (task.id !== taskId) return task
          updatedTask = { ...task, status }
          return updatedTask
        }),
      )
      return updatedTask
    },
    [current?.apartment.id, setTasks, tasks],
  )

  const updateTask = useCallback(
    async (taskId: number, task: UpdateTaskInput) => {
      if (isSupabaseConfigured) {
        const apartmentId = current?.apartment.id ?? 0
        const currentTask = tasks.find((item) => item.id === taskId)
        const updatedTask = await updateTaskViaApi({
          apartmentId,
          taskId,
          title: task.title,
          description: currentTask?.description ?? null,
          assigneeAccountId: task.assignee_id,
          dueDate: task.due_date,
          status: task.status,
        })

        if (!updatedTask) return null
        setTasks((currentTasks) =>
          currentTasks.map((item) => (item.id === taskId ? updatedTask : item)),
        )
        return updatedTask
      }

      let updatedTask: Task | null = null

      setTasks((currentTasks) =>
        currentTasks.map((item) => {
          if (item.id !== taskId) return item
          updatedTask = {
            ...item,
            title: task.title,
            assignee_id: task.assignee_id,
            due_date: task.due_date,
            status: task.status,
          }
          return updatedTask
        }),
      )

      return updatedTask
    },
    [current?.apartment.id, setTasks, tasks],
  )

  const deleteTask = useCallback(
    async (taskId: number) => {
      if (isSupabaseConfigured) {
        const apartmentId = current?.apartment.id ?? 0
        await deleteTaskViaApi(apartmentId, taskId)
      }

      setTasks((currentTasks) => currentTasks.filter((task) => task.id !== taskId))
    },
    [current?.apartment.id, setTasks],
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
