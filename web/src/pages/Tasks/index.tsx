import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Card } from '../../components/Card'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { InlineStatusMenu } from '../../components/InlineStatusMenu'
import { TaskStatusActionChip, taskLabels } from '../../components/StatusChip'
import { useApartment } from '../../context/ApartmentContext'
import { useAuth } from '../../context/AuthContext'
import {
  getTodayDate,
  isTaskIncomplete,
  isTaskOverdue,
  useTasks,
} from '../../context/TasksContext'
import {
  createHomeItemViaApi,
  deleteHomeItemViaApi,
  listHomeItemsViaApi,
  updateHomeItemViaApi,
} from '../../data/server/homeItemsApi'
import { isSupabaseConfigured } from '../../lib/supabase/env'
import type { ApartmentHomeItem, Task, TaskStatus } from '../../types/models'

type TaskType = 'cleaning' | 'maintenance' | 'shopping' | 'inspection' | 'other'
type TasksView = 'tasks' | 'saved'
type OpenTasksTab = 'mine' | 'others'

interface TaskFormState {
  savedTaskKey: string
  description: string
  assigneeId: string
  dueDate: string
  status: TaskStatus
}

interface SavedTaskFormState {
  taskType: TaskType
  targetName: string
  defaultNote: string
}

const taskTypeOptions: { value: TaskType; label: string }[] = [
  { value: 'cleaning', label: 'ניקיון' },
  { value: 'maintenance', label: 'תחזוקה' },
  { value: 'shopping', label: 'קניות והשלמות' },
  { value: 'inspection', label: 'בדיקה' },
  { value: 'other', label: 'אחר' },
]

const taskStatusOptions: { value: TaskStatus; label: string }[] = [
  { value: 'open', label: 'פתוחה' },
  { value: 'in_progress', label: 'בביצוע' },
  { value: 'done', label: 'בוצעה' },
]

function getTaskTypeLabel(type: TaskType | null | undefined) {
  return taskTypeOptions.find((option) => option.value === type)?.label ?? 'מטלה'
}

function getTaskTypeByLabel(label: string | null | undefined): TaskType {
  return taskTypeOptions.find((option) => option.label === label)?.value ?? 'other'
}

function createInitialTaskForm(savedTasks: ApartmentHomeItem[], defaultAssigneeId?: number): TaskFormState {
  const firstTask = savedTasks[0]

  return {
    savedTaskKey: firstTask?.item_key ?? '',
    description: firstTask?.default_note ?? '',
    assigneeId: defaultAssigneeId ? String(defaultAssigneeId) : '',
    dueDate: new Date().toISOString().slice(0, 10),
    status: 'open',
  }
}

function formatTaskDate(date: string) {
  return new Intl.DateTimeFormat('he-IL', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(date))
}

function formatTaskDateTime(date: string) {
  return new Intl.DateTimeFormat('he-IL', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(date))
}

function inferSavedTaskForm(task: Task, savedTasks: ApartmentHomeItem[]): SavedTaskFormState {
  const matchedPrefix = taskTypeOptions.find((option) => task.title.startsWith(`${option.label} - `))
  const targetName = matchedPrefix ? task.title.replace(`${matchedPrefix.label} - `, '').trim() : task.title
  const matchedTask = savedTasks.find((item) => item.name === targetName)

  return {
    taskType: matchedTask ? getTaskTypeByLabel(matchedTask.area) : matchedPrefix?.value ?? 'other',
    targetName,
    defaultNote: task.description ?? matchedTask?.default_note ?? '',
  }
}

function buildTaskTitle(savedTask: ApartmentHomeItem) {
  return `${savedTask.area} - ${savedTask.name}`.trim()
}

export function TasksPage() {
  const { user } = useAuth()
  const { current } = useApartment()
  const apartmentId = current?.apartment.id ?? 0
  const roommates = useMemo(
    () => (current?.roommates ?? []).filter((roommate) => roommate.status === 'active'),
    [current],
  )
  const canManageSavedTasks = Boolean(user && apartmentId)
  const getUserName = (userId: number | null) =>
    roommates.find((roommate) => roommate.id === userId)?.name

  const { tasks, addTask, updateTask, updateTaskStatus, deleteTask } = useTasks()
  const [savedTasks, setSavedTasks] = useState<ApartmentHomeItem[]>([])
  const [isSavedTasksReady, setIsSavedTasksReady] = useState(false)
  const [savedTaskNotice, setSavedTaskNotice] = useState('')
  const [isTaskModalOpen, setIsTaskModalOpen] = useState(false)
  const [selectedTask, setSelectedTask] = useState<Task | null>(null)
  const [editingTask, setEditingTask] = useState<Task | null>(null)
  const [taskToDelete, setTaskToDelete] = useState<number | null>(null)
  const [taskForm, setTaskForm] = useState<TaskFormState>(() =>
    createInitialTaskForm([], roommates[0]?.id),
  )
  const [formError, setFormError] = useState('')
  const [detailsError, setDetailsError] = useState('')
  const [inlineError, setInlineError] = useState('')
  const [openStatusTaskKey, setOpenStatusTaskKey] = useState<string | null>(null)
  const [isSavedTaskModalOpen, setIsSavedTaskModalOpen] = useState(false)
  const [editingSavedTaskId, setEditingSavedTaskId] = useState<number | null>(null)
  const [savedTaskToDelete, setSavedTaskToDelete] = useState<number | null>(null)
  const [savedTaskForm, setSavedTaskForm] = useState<SavedTaskFormState>({
    taskType: 'cleaning',
    targetName: '',
    defaultNote: '',
  })
  const [savedTaskError, setSavedTaskError] = useState('')
  const [isSavingSavedTask, setIsSavingSavedTask] = useState(false)
  const [isDeletingSavedTask, setIsDeletingSavedTask] = useState(false)
  const [activeView, setActiveView] = useState<TasksView>('tasks')
  const [openTasksTab, setOpenTasksTab] = useState<OpenTasksTab>('mine')

  const today = getTodayDate()
  const apartmentTasks = tasks.filter((task) => task.apartment_id === apartmentId)
  const myOpenTasks = apartmentTasks.filter(
    (task) => task.assignee_id === user?.id && isTaskIncomplete(task),
  )
  const otherRoommatesTasks = apartmentTasks.filter(
    (task) => task.assignee_id !== user?.id && isTaskIncomplete(task),
  )
  const overdueTasks = apartmentTasks.filter((task) => isTaskOverdue(task, today))
  const recentlyCompletedTasks = apartmentTasks
    .filter((task) => {
      if (task.status !== 'done') return false
      if (!task.updated_at) return false
      const completedAt = new Date(task.updated_at).getTime()
      const recentThreshold = Date.now() - 3 * 24 * 60 * 60 * 1000
      return completedAt >= recentThreshold
    })
    .sort((leftTask, rightTask) => {
      const leftTime = leftTask.updated_at ? new Date(leftTask.updated_at).getTime() : 0
      const rightTime = rightTask.updated_at ? new Date(rightTask.updated_at).getTime() : 0
      return rightTime - leftTime
    })
  const selectedSavedTask =
    savedTasks.find((item) => item.item_key === taskForm.savedTaskKey) ?? null

  useEffect(() => {
    let cancelled = false

    async function loadSavedTasks() {
      if (!apartmentId) return

      if (!isSupabaseConfigured) {
        setSavedTasks([])
        setIsSavedTasksReady(true)
        return
      }

      try {
        const items = await listHomeItemsViaApi(apartmentId)
        if (cancelled) return
        setSavedTasks(items)
      } catch {
        if (cancelled) return
        setSavedTasks([])
      } finally {
        if (!cancelled) {
          setIsSavedTasksReady(true)
        }
      }
    }

    void loadSavedTasks()

    return () => {
      cancelled = true
    }
  }, [apartmentId])

  useEffect(() => {
    if (isTaskModalOpen || editingTask) return
    if (!savedTasks.length) return
    setTaskForm((currentForm) => {
      const isValidTask = savedTasks.some((item) => item.item_key === currentForm.savedTaskKey)
      if (isValidTask) return currentForm
      return createInitialTaskForm(savedTasks, roommates[0]?.id)
    })
  }, [editingTask, isTaskModalOpen, roommates, savedTasks])

  function updateTaskForm(field: keyof TaskFormState, value: string) {
    setTaskForm((currentForm) => ({ ...currentForm, [field]: value }))
  }

  function selectSavedTask(value: string) {
    const task = savedTasks.find((currentTask) => currentTask.item_key === value)
    setTaskForm((currentForm) => ({
      ...currentForm,
      savedTaskKey: value,
      description: task?.default_note ?? '',
    }))
    setSavedTaskNotice('')
  }

  function openAddTaskModal() {
    setEditingTask(null)
    setTaskForm(createInitialTaskForm(savedTasks, roommates[0]?.id))
    setFormError('')
    setSavedTaskNotice('')
    setIsTaskModalOpen(true)
  }

  function openEditTaskModal(task: Task) {
    const inferred = inferSavedTaskForm(task, savedTasks)
    const matchedTask = savedTasks.find(
      (item) =>
        item.name === inferred.targetName && getTaskTypeByLabel(item.area) === inferred.taskType,
    )

    setSelectedTask(null)
    setEditingTask(task)
    setTaskForm({
      savedTaskKey: matchedTask?.item_key ?? '',
      description: task.description ?? matchedTask?.default_note ?? '',
      assigneeId: String(task.assignee_id ?? roommates[0]?.id ?? ''),
      dueDate: task.due_date ?? '',
      status: task.status,
    })
    setFormError('')
    setSavedTaskNotice('')
    setIsTaskModalOpen(true)
  }

  function closeTaskModal() {
    setIsTaskModalOpen(false)
    setEditingTask(null)
    setTaskForm(createInitialTaskForm(savedTasks, roommates[0]?.id))
    setFormError('')
    setSavedTaskNotice('')
  }

  function openSavedTaskCreate() {
    setEditingSavedTaskId(null)
    setSavedTaskError('')
    setSavedTaskForm({
      taskType: 'cleaning',
      targetName: '',
      defaultNote: taskForm.description,
    })
    setIsSavedTaskModalOpen(true)
  }

  function openSavedTaskEditFor(item: ApartmentHomeItem) {
    setEditingSavedTaskId(item.id)
    setSavedTaskError('')
    setSavedTaskForm({
      taskType: getTaskTypeByLabel(item.area),
      targetName: item.name,
      defaultNote: item.default_note,
    })
    setIsSavedTaskModalOpen(true)
  }

  function closeSavedTaskModal() {
    setIsSavedTaskModalOpen(false)
    setEditingSavedTaskId(null)
    setSavedTaskError('')
    setSavedTaskForm({
      taskType: 'cleaning',
      targetName: '',
      defaultNote: '',
    })
  }

  async function handleDeleteSavedTask() {
    if (!canManageSavedTasks || savedTaskToDelete == null) return

    setSavedTaskError('')
    setIsDeletingSavedTask(true)

    try {
      const deletedItem = savedTasks.find((item) => item.id === savedTaskToDelete) ?? null

      await deleteHomeItemViaApi({
        apartmentId,
        itemId: savedTaskToDelete,
      })

      setSavedTasks((currentTasks) => currentTasks.filter((item) => item.id !== savedTaskToDelete))

      if (deletedItem && taskForm.savedTaskKey === deletedItem.item_key) {
        setTaskForm((currentForm) => ({
          ...currentForm,
          savedTaskKey: '',
          description: '',
        }))
      }

      setSavedTaskNotice('המטלה הקבועה נמחקה מהרשימה.')
      setSavedTaskToDelete(null)
      closeSavedTaskModal()
    } catch (error) {
      setSavedTaskError(error instanceof Error ? error.message : 'מחיקת המטלה הקבועה נכשלה.')
    } finally {
      setIsDeletingSavedTask(false)
    }
  }

  async function handleSaveSavedTask() {
    if (!canManageSavedTasks) return

    if (!savedTaskForm.targetName.trim()) {
      setSavedTaskError('צריך למלא עבור מה המטלה.')
      return
    }

    if (!savedTaskForm.defaultNote.trim()) {
      setSavedTaskError('צריך לכתוב הערות למטלה הקבועה.')
      return
    }

    setSavedTaskError('')
    setIsSavingSavedTask(true)

    try {
      let savedTask: ApartmentHomeItem | null = null

      if (editingSavedTaskId != null) {
        savedTask = await updateHomeItemViaApi({
          apartmentId,
          itemId: editingSavedTaskId,
          area: getTaskTypeLabel(savedTaskForm.taskType),
          name: savedTaskForm.targetName.trim(),
          defaultNote: savedTaskForm.defaultNote.trim(),
        })
        if (savedTask) {
          setSavedTasks((currentTasks) =>
            currentTasks.map((item) => (item.id === savedTask!.id ? savedTask! : item)),
          )
        }
      } else {
        savedTask = await createHomeItemViaApi({
          apartmentId,
          area: getTaskTypeLabel(savedTaskForm.taskType),
          name: savedTaskForm.targetName.trim(),
          defaultNote: savedTaskForm.defaultNote.trim(),
        })
        if (savedTask) {
          setSavedTasks((currentTasks) => [...currentTasks, savedTask!])
        }
      }

      if (savedTask) {
        setTaskForm((currentForm) => ({
          ...currentForm,
          savedTaskKey: savedTask!.item_key,
          description: savedTask!.default_note,
        }))
        setSavedTaskNotice(
          editingSavedTaskId != null ? 'המטלה הקבועה עודכנה.' : 'המטלה הקבועה נוספה לרשימה.',
        )
      }

      closeSavedTaskModal()
    } catch (error) {
      setSavedTaskError(error instanceof Error ? error.message : 'שמירת המטלה הקבועה נכשלה.')
    } finally {
      setIsSavingSavedTask(false)
    }
  }

  async function handleAddTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFormError('')

    if (!selectedSavedTask) {
      setFormError('צריך לבחור מטלה מהרשימה או להוסיף מטלה קבועה חדשה.')
      return
    }

    if (!taskForm.assigneeId) {
      setFormError('צריך לבחור מי אחראי על המטלה.')
      return
    }

    if (!taskForm.dueDate) {
      setFormError('צריך לבחור תאריך יעד.')
      return
    }

    const payload = {
      title: buildTaskTitle(selectedSavedTask),
      description: taskForm.description.trim() || null,
      assignee_id: Number(taskForm.assigneeId),
      due_date: taskForm.dueDate,
      status: editingTask ? taskForm.status : 'open',
    }

    try {
      if (editingTask) {
        const updatedTask = await updateTask(editingTask.id, payload)
        if (updatedTask) setSelectedTask(updatedTask)
      } else {
        await addTask({
          apartment_id: apartmentId,
          created_by: user?.id ?? 0,
          ...payload,
        })
      }
      closeTaskModal()
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'שמירת המטלה נכשלה.')
    }
  }

  async function confirmDeleteTask() {
    if (taskToDelete == null) return
    setDetailsError('')

    try {
      await deleteTask(taskToDelete)
      if (selectedTask?.id === taskToDelete) setSelectedTask(null)
      if (editingTask?.id === taskToDelete) closeTaskModal()
      setTaskToDelete(null)
    } catch (error) {
      setDetailsError(error instanceof Error ? error.message : 'מחיקת המטלה נכשלה.')
      setTaskToDelete(null)
    }
  }

  async function handleInlineStatusChange(task: Task, status: TaskStatus) {
    if (task.status === status) return
    setInlineError('')

    try {
      const updatedTask = await updateTaskStatus(task.id, status)
      if (selectedTask?.id === task.id && updatedTask) setSelectedTask(updatedTask)
    } catch (error) {
      setInlineError(error instanceof Error ? error.message : 'עדכון הסטטוס נכשל.')
    } finally {
      setOpenStatusTaskKey(null)
    }
  }

  function openTaskDetails(task: Task) {
    setDetailsError('')
    setSelectedTask(task)
  }

  function renderStatusMenu(task: Task, menuKey: string) {
    const isOpen = openStatusTaskKey === menuKey

    return (
      <div onClick={(event) => event.stopPropagation()}>
        <InlineStatusMenu
          isOpen={isOpen}
          onOpenChange={(nextValue) => setOpenStatusTaskKey(nextValue ? menuKey : null)}
          trigger={
            <TaskStatusActionChip
              status={task.status}
              onClick={() =>
                setOpenStatusTaskKey((currentKey) => (currentKey === menuKey ? null : menuKey))
              }
            />
          }
        >
          {taskStatusOptions.map((status) => (
            <button
              key={status.value}
              type="button"
              className={`inline-status-menu__option${
                status.value === task.status ? ' inline-status-menu__option--active' : ''
              }`}
              onClick={() => void handleInlineStatusChange(task, status.value)}
            >
              {status.label}
            </button>
          ))}
        </InlineStatusMenu>
      </div>
    )
  }

  return (
    <div className="page tasks-page">
      <div className="page__head tasks-hero">
        {activeView === 'tasks' ? (
          <button
            type="button"
            className="btn btn--primary tasks-hero__action"
            onClick={openAddTaskModal}
          >
            + מטלה חדשה
          </button>
        ) : null}
      </div>

      <div className="tasks-view-tabs" aria-label="תצוגת מודול מטלות">
        <button
          type="button"
          className={`tasks-view-tabs__button${
            activeView === 'tasks' ? ' tasks-view-tabs__button--active' : ''
          }`}
          onClick={() => setActiveView('tasks')}
        >
          מטלות הדירה
        </button>
        <button
          type="button"
          className={`tasks-view-tabs__button${
            activeView === 'saved' ? ' tasks-view-tabs__button--active' : ''
          }`}
          onClick={() => setActiveView('saved')}
        >
          רשימת מטלות
        </button>
      </div>

      {activeView === 'tasks' ? (
        <>
          <section className="tasks-summary" aria-label="סיכום מטלות">
            <Card>
              <p className="tasks-summary__label">המטלות הפתוחות שלך</p>
              <p className="tasks-summary__value">{myOpenTasks.length}</p>
            </Card>
            <Card>
              <p className="tasks-summary__label">מטלות באיחור בדירה</p>
              <p className="tasks-summary__value tasks-summary__value--danger">{overdueTasks.length}</p>
            </Card>
          </section>

          <Card className="status-menu-card">
            <div className="tasks-open-tabs" role="tablist" aria-label="רשימות מטלות פתוחות">
              <button
                type="button"
                role="tab"
                aria-selected={openTasksTab === 'mine'}
                className={`tasks-open-tabs__button${
                  openTasksTab === 'mine' ? ' tasks-open-tabs__button--active' : ''
                }`}
                onClick={() => setOpenTasksTab('mine')}
              >
                המטלות הפתוחות שלך
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={openTasksTab === 'others'}
                className={`tasks-open-tabs__button${
                  openTasksTab === 'others' ? ' tasks-open-tabs__button--active' : ''
                }`}
                onClick={() => setOpenTasksTab('others')}
              >
                מטלות של שאר הדיירים
              </button>
            </div>

            {openTasksTab === 'mine' ? (
              myOpenTasks.length === 0 ? (
                <p className="muted">אין לך מטלות פתוחות כרגע.</p>
              ) : (
                <ul className="task-list task-list--compact">
                  {myOpenTasks.map((task) => (
                    <li
                      key={task.id}
                      className={`task-list__item${
                        isTaskOverdue(task, today) ? ' task-list__item--overdue' : ''
                      }`}
                    >
                      <button
                        type="button"
                        className="task-list__item-button"
                        onClick={() => openTaskDetails(task)}
                      >
                        <span className="task-list__title">{task.title}</span>
                        <div className="task-list__meta">
                          יעד: {task.due_date ? formatTaskDate(task.due_date) : 'לא נקבע'}
                        </div>
                      </button>
                      {renderStatusMenu(task, `mine-${task.id}`)}
                    </li>
                  ))}
                </ul>
              )
            ) : otherRoommatesTasks.length === 0 ? (
              <p className="muted">אין כרגע מטלות פתוחות לשאר הדיירים.</p>
            ) : (
              <ul className="task-list task-list--compact">
                {otherRoommatesTasks.map((task) => (
                  <li
                    key={task.id}
                    className={`task-list__item${
                      isTaskOverdue(task, today) ? ' task-list__item--overdue' : ''
                    }`}
                  >
                    <button
                      type="button"
                      className="task-list__item-button task-list__item-button--with-meta"
                      onClick={() => openTaskDetails(task)}
                    >
                      <span className="task-list__title">{task.title}</span>
                      <div className="task-list__meta">
                        {getUserName(task.assignee_id) ?? 'לא הוגדר'} · יעד:{' '}
                        {task.due_date ? formatTaskDate(task.due_date) : 'לא נקבע'}
                      </div>
                    </button>
                    {renderStatusMenu(task, `others-${task.id}`)}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="מטלות באיחור" className="status-menu-card">
            {overdueTasks.length === 0 ? (
              <p className="muted">אין מטלות באיחור.</p>
            ) : (
              <ul className="task-list task-list--compact">
                {overdueTasks.map((task) => (
                  <li key={task.id} className="task-list__item task-list__item--overdue">
                    <button
                      type="button"
                      className="task-list__item-button task-list__item-button--with-meta"
                      onClick={() => openTaskDetails(task)}
                    >
                      <span className="task-list__title">{task.title}</span>
                      <div className="task-list__meta">
                        {getUserName(task.assignee_id) ?? 'לא הוגדר'} · יעד:{' '}
                        {task.due_date ? formatTaskDate(task.due_date) : 'לא נקבע'}
                      </div>
                    </button>
                    {renderStatusMenu(task, `overdue-${task.id}`)}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="מטלות שהושלמו לאחרונה" className="status-menu-card">
            {inlineError ? <p className="form-message form-message--error">{inlineError}</p> : null}
            {recentlyCompletedTasks.length === 0 ? (
              <p className="muted">אין מטלות שהושלמו ביומיים-שלושה האחרונים.</p>
            ) : (
              <div className="home-updates home-updates--figma">
                {recentlyCompletedTasks.map((task) => (
                  <button
                    key={task.id}
                    type="button"
                    className="home-updates__item home-updates__item--success task-updates__item-button"
                    onClick={() => openTaskDetails(task)}
                  >
                    <div className="home-updates__content">
                      <div className="home-updates__text">{task.title}</div>
                      <div className="home-updates__meta">
                        {getUserName(task.assignee_id) ?? 'לא הוגדר'} · הושלמה:{' '}
                        {task.updated_at ? formatTaskDateTime(task.updated_at) : 'לא זמין'}
                      </div>
                    </div>
                    <span className="home-updates__pill" aria-hidden="true" />
                  </button>
                ))}
              </div>
            )}
          </Card>
        </>
      ) : (
        <Card
          title="רשימת מטלות"
          action={
            canManageSavedTasks ? (
              <button
                type="button"
                className="btn btn--secondary btn--small"
                onClick={openSavedTaskCreate}
              >
                הוסף מטלה
              </button>
            ) : null
          }
        >
          {savedTaskNotice ? (
            <p className="task-form__default-note-message">{savedTaskNotice}</p>
          ) : null}

          {!savedTasks.length ? (
              <p className="muted">אין עדיין מטלות קבועות ברשימה.</p>
          ) : (
            <div className="home-items-table-wrap">
              <table className="home-items-table">
                <thead>
                  <tr>
                    <th>סוג מטלה</th>
                    <th>עבור מה המטלה</th>
                    <th>הערות</th>
                    <th>פעולות</th>
                  </tr>
                </thead>
                <tbody>
                  {savedTasks.map((item) => (
                    <tr key={item.id}>
                      <td data-label="סוג מטלה">{item.area}</td>
                      <td data-label="עבור מה המטלה">{item.name}</td>
                      <td data-label="הערות">{item.default_note}</td>
                      <td data-label="פעולות">
                        <div className="task-saved-list__actions">
                          <button
                            type="button"
                            className="btn btn--secondary btn--small"
                            onClick={() => openSavedTaskEditFor(item)}
                          >
                            עריכה
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {isTaskModalOpen ? (
        <div className="modal-backdrop" role="presentation">
          <section
            className="task-modal card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="task-modal-title"
          >
            <div className="task-modal__head">
              <div>
                <p className="tasks-hero__eyebrow">{editingTask ? 'עריכת מטלה' : 'מטלה חדשה'}</p>
                <h2 id="task-modal-title">{editingTask ? 'עדכון מטלה' : 'פתיחת מטלה'}</h2>
              </div>
              <button type="button" className="btn-text" onClick={closeTaskModal}>
                סגירה
              </button>
            </div>

            <form className="task-form" onSubmit={handleAddTask} noValidate>
              <div className="field">
                <span className="field__label">רשימת מטלות</span>
                <div className="task-form__saved-task-row">
                  <select
                    className="field__input"
                    value={taskForm.savedTaskKey}
                    onChange={(event) => selectSavedTask(event.target.value)}
                    disabled={!isSavedTasksReady}
                  >
                    <option value="">
                      {savedTasks.length ? 'בחרו מטלה מהרשימה' : 'אין עדיין מטלות קבועות'}
                    </option>
                    {savedTasks.map((item) => (
                      <option key={item.item_key} value={item.item_key}>
                        {buildTaskTitle(item)}
                      </option>
                    ))}
                  </select>

                </div>
              </div>

              <label className="field">
                <span className="field__label">הערות</span>
                <textarea
                  className="field__input task-form__textarea"
                  value={taskForm.description}
                  onChange={(event) => updateTaskForm('description', event.target.value)}
                />
              </label>

              {savedTaskNotice ? (
                <p className="task-form__default-note-message">{savedTaskNotice}</p>
              ) : null}

              <div className="task-form__grid">
                <label className="field">
                  <span className="field__label">אחראי</span>
                  <select
                    className="field__input"
                    value={taskForm.assigneeId}
                    onChange={(event) => updateTaskForm('assigneeId', event.target.value)}
                  >
                    {roommates.map((roommate) => (
                      <option key={roommate.id} value={roommate.id}>
                        {roommate.name}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="field">
                  <span className="field__label">תאריך יעד</span>
                  <input
                    className="field__input"
                    type="date"
                    dir="ltr"
                    value={taskForm.dueDate}
                    onChange={(event) => updateTaskForm('dueDate', event.target.value)}
                  />
                </label>
              </div>

              {formError ? <p className="form-message form-message--error">{formError}</p> : null}

              <div className="task-form__actions">
                <button type="button" className="btn btn--secondary" onClick={closeTaskModal}>
                  ביטול
                </button>
                <button type="submit" className="btn btn--primary">
                  {editingTask ? 'שמירת שינויים' : 'שמירת מטלה'}
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}

      {isSavedTaskModalOpen ? (
        <div className="modal-backdrop" role="presentation">
          <section
            className="task-modal card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="saved-task-modal-title"
          >
            <div className="task-modal__head">
              <div>
                <p className="tasks-hero__eyebrow">
                  {editingSavedTaskId != null ? 'עריכת מטלה קבועה' : 'הוספת מטלה קבועה'}
                </p>
                <h2 id="saved-task-modal-title">
                  {editingSavedTaskId != null ? 'עריכת מטלה' : 'מטלה חדשה לרשימה'}
                </h2>
              </div>
              <button type="button" className="btn-text" onClick={closeSavedTaskModal}>
                סגירה
              </button>
            </div>

            <div className="task-form">
              <label className="field">
                <span className="field__label">סוג מטלה</span>
                <select
                  className="field__input"
                  value={savedTaskForm.taskType}
                  onChange={(event) =>
                    setSavedTaskForm((currentForm) => ({
                      ...currentForm,
                      taskType: event.target.value as TaskType,
                    }))
                  }
                >
                  {taskTypeOptions.map((type) => (
                    <option key={type.value} value={type.value}>
                      {type.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="field">
                <span className="field__label">עבור מה המטלה</span>
                <input
                  className="field__input"
                  value={savedTaskForm.targetName}
                  onChange={(event) =>
                    setSavedTaskForm((currentForm) => ({
                      ...currentForm,
                      targetName: event.target.value,
                    }))
                  }
                />
              </label>

              <label className="field">
                <span className="field__label">הוספת הערות</span>
                <textarea
                  className="field__input task-form__textarea"
                  value={savedTaskForm.defaultNote}
                  onChange={(event) =>
                    setSavedTaskForm((currentForm) => ({
                      ...currentForm,
                      defaultNote: event.target.value,
                    }))
                  }
                />
              </label>

              {savedTaskError ? (
                <p className="form-message form-message--error">{savedTaskError}</p>
              ) : null}

              <div className="task-form__actions">
                <button type="button" className="btn btn--secondary" onClick={closeSavedTaskModal}>
                  ביטול
                </button>
                {editingSavedTaskId != null ? (
                  <button
                    type="button"
                    className="btn btn--danger"
                    onClick={() => setSavedTaskToDelete(editingSavedTaskId)}
                    disabled={isSavingSavedTask || isDeletingSavedTask}
                  >
                    {isDeletingSavedTask ? 'מוחק...' : 'מחיקה'}
                  </button>
                ) : null}
                <button
                  type="button"
                  className="btn btn--primary"
                  onClick={() => void handleSaveSavedTask()}
                  disabled={isSavingSavedTask || isDeletingSavedTask}
                >
                  {isSavingSavedTask
                    ? 'שומר...'
                    : editingSavedTaskId != null
                      ? 'שמור שינויים'
                      : 'הוסף לרשימה'}
                </button>
              </div>
            </div>
          </section>
        </div>
      ) : null}

      {selectedTask ? (
        <div className="modal-backdrop" role="presentation">
          <section
            className="task-modal card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="task-details-title"
          >
            <div className="task-modal__head">
              <div>
                <p className="tasks-hero__eyebrow">פרטי מטלה</p>
                <h2 id="task-details-title">{selectedTask.title}</h2>
                <p>יעד: {selectedTask.due_date ? formatTaskDate(selectedTask.due_date) : 'לא נקבע'}</p>
              </div>
              <button type="button" className="btn-text" onClick={() => setSelectedTask(null)}>
                סגירה
              </button>
            </div>

            <div className="expense-detail">
              <div className="expense-detail__facts">
                <div>
                  <span>אחראי</span>
                  <strong>{getUserName(selectedTask.assignee_id) ?? 'לא הוגדר'}</strong>
                </div>
                <div>
                  <span>סטטוס</span>
                  <strong>{taskLabels[selectedTask.status] ?? selectedTask.status}</strong>
                </div>
              </div>

              {selectedTask.description ? (
                <div className="task-detail-note">
                  <span>הערות</span>
                  <p>{selectedTask.description}</p>
                </div>
              ) : null}

              {detailsError ? <p className="form-message form-message--error">{detailsError}</p> : null}

              <div className="expense-form__actions">
                <button
                  type="button"
                  className="btn btn--secondary"
                  onClick={() => openEditTaskModal(selectedTask)}
                >
                  עריכה
                </button>
                <button
                  type="button"
                  className="btn btn--danger"
                  onClick={() => setTaskToDelete(selectedTask.id)}
                >
                  מחיקה
                </button>
              </div>
            </div>
          </section>
        </div>
      ) : null}

      {taskToDelete != null ? (
        <ConfirmDialog
          title="למחוק את המטלה?"
          message="המטלה תוסר מרשימת המטלות ולא תופיע עוד בדירה."
          confirmLabel="מחיקה"
          cancelLabel="ביטול"
          onConfirm={confirmDeleteTask}
          onCancel={() => setTaskToDelete(null)}
        />
      ) : null}
      {savedTaskToDelete != null ? (
        <ConfirmDialog
          title="למחוק את המטלה הקבועה?"
          message="המטלה הקבועה תוסר מהרשימה של הדירה הזו בלבד."
          confirmLabel="מחיקה"
          cancelLabel="ביטול"
          onConfirm={() => void handleDeleteSavedTask()}
          onCancel={() => setSavedTaskToDelete(null)}
        />
      ) : null}
    </div>
  )
}
