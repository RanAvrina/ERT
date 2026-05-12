import { useMemo, useState, type FormEvent } from 'react'
import { Card } from '../../components/Card'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { TaskStatusChip } from '../../components/StatusChip'
import { useApartment } from '../../context/ApartmentContext'
import { useAuth } from '../../context/AuthContext'
import {
  getTodayDate,
  isTaskIncomplete,
  isTaskOverdue,
  useTasks,
} from '../../context/TasksContext'
import type { Task, TaskStatus } from '../../types/models'

interface TaskFormState {
  title: string
  assigneeId: string
  dueDate: string
  status: TaskStatus
}

const taskStatusOptions: { value: TaskStatus; label: string }[] = [
  { value: 'open', label: 'פתוחה' },
  { value: 'in_progress', label: 'בביצוע' },
  { value: 'done', label: 'בוצעה' },
  { value: 'cancelled', label: 'בוטלה' },
]

function createInitialTaskForm(defaultAssigneeId?: number): TaskFormState {
  return {
    title: '',
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

function buildFormFromTask(task: Task): TaskFormState {
  return {
    title: task.title,
    assigneeId: String(task.assignee_id ?? ''),
    dueDate: task.due_date ?? '',
    status: task.status,
  }
}

export function TasksPage() {
  const { user } = useAuth()
  const { current } = useApartment()
  const apartmentId = current?.apartment.id ?? 0
  const roommates = useMemo(
    () => (current?.roommates ?? []).filter((roommate) => roommate.status === 'active'),
    [current],
  )
  const getUserName = (userId: number | null) =>
    roommates.find((roommate) => roommate.id === userId)?.name
  const { tasks, addTask, updateTask, deleteTask } = useTasks()
  const [isTaskModalOpen, setIsTaskModalOpen] = useState(false)
  const [selectedTask, setSelectedTask] = useState<Task | null>(null)
  const [editingTask, setEditingTask] = useState<Task | null>(null)
  const [taskToDelete, setTaskToDelete] = useState<number | null>(null)
  const [taskForm, setTaskForm] = useState<TaskFormState>(() =>
    createInitialTaskForm(roommates[0]?.id),
  )
  const [formError, setFormError] = useState('')
  const [detailsError, setDetailsError] = useState('')

  const today = getTodayDate()
  const apartmentTasks = tasks.filter((task) => task.apartment_id === apartmentId)
  const myOpenTasks = apartmentTasks.filter(
    (task) => task.assignee_id === user?.id && isTaskIncomplete(task),
  )
  const overdueTasks = apartmentTasks.filter((task) => isTaskOverdue(task, today))

  function updateTaskForm(field: keyof TaskFormState, value: string) {
    setTaskForm((currentForm) => ({ ...currentForm, [field]: value }))
  }

  function openAddTaskModal() {
    setEditingTask(null)
    setTaskForm(createInitialTaskForm(roommates[0]?.id))
    setFormError('')
    setIsTaskModalOpen(true)
  }

  function openEditTaskModal(task: Task) {
    setSelectedTask(null)
    setEditingTask(task)
    setTaskForm(buildFormFromTask(task))
    setFormError('')
    setIsTaskModalOpen(true)
  }

  function closeTaskModal() {
    setIsTaskModalOpen(false)
    setEditingTask(null)
    setTaskForm(createInitialTaskForm(roommates[0]?.id))
    setFormError('')
  }

  async function handleAddTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFormError('')

    if (!taskForm.title.trim()) {
      setFormError('צריך לתת למטלה שם קצר וברור.')
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

    try {
      if (editingTask) {
        const updatedTask = await updateTask(editingTask.id, {
          title: taskForm.title.trim(),
          assignee_id: Number(taskForm.assigneeId),
          due_date: taskForm.dueDate,
          status: taskForm.status,
        })
        if (updatedTask) setSelectedTask(updatedTask)
      } else {
        await addTask({
          apartment_id: apartmentId,
          title: taskForm.title.trim(),
          assignee_id: Number(taskForm.assigneeId),
          due_date: taskForm.dueDate,
          status: taskForm.status,
          created_by: user?.id ?? 0,
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

  return (
    <div className="page tasks-page">
      <div className="page__head tasks-hero">
        <button
          type="button"
          className="btn btn--primary tasks-hero__action"
          onClick={openAddTaskModal}
        >
          + מטלה חדשה
        </button>
      </div>

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

      <Card title="המטלות הפתוחות שלך">
        {myOpenTasks.length === 0 ? (
          <p className="muted">אין לך מטלות פתוחות כרגע.</p>
        ) : (
          <ul className="task-list task-list--compact">
            {myOpenTasks.map((task) => (
              <li key={task.id} className="task-list__item">
                <span className="task-list__title">{task.title}</span>
                <TaskStatusChip status={task.status} />
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="מטלות באיחור">
        {overdueTasks.length === 0 ? (
          <p className="muted">אין מטלות באיחור.</p>
        ) : (
          <ul className="task-list task-list--compact">
            {overdueTasks.map((task) => (
              <li key={task.id} className="task-list__item">
                <div>
                  <span className="task-list__title">{task.title}</span>
                  <div className="task-list__meta">
                    {getUserName(task.assignee_id) ?? 'לא הוגדר'} · יעד:{' '}
                    {task.due_date ? formatTaskDate(task.due_date) : 'לא נקבע'}
                  </div>
                </div>
                <TaskStatusChip status={task.status} />
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="מטלות הדירה">
        <ul className="task-list task-list--cards">
          {apartmentTasks.map((task) => (
            <li key={task.id} className="task-list__item task-item-card">
              <button
                type="button"
                className="expense-item-card__button"
                onClick={() => setSelectedTask(task)}
              >
                <div className="task-item-card__main">
                  <div className="task-list__title">{task.title}</div>
                  <div className="task-list__meta">
                    <span>אחראי: {getUserName(task.assignee_id) ?? 'לא הוגדר'}</span>
                    <span>יעד: {task.due_date ? formatTaskDate(task.due_date) : 'לא נקבע'}</span>
                  </div>
                </div>
                <div className="task-item-card__status">
                  <TaskStatusChip status={task.status} />
                </div>
              </button>
            </li>
          ))}
        </ul>
      </Card>

      {isTaskModalOpen ? (
        <div className="modal-backdrop" role="presentation">
          <section className="task-modal card" role="dialog" aria-modal="true" aria-labelledby="add-task-title">
            <div className="task-modal__head">
              <div>
                <p className="tasks-hero__eyebrow">{editingTask ? 'עריכת מטלה' : 'מטלה חדשה'}</p>
                <h2 id="add-task-title">{editingTask ? 'עדכון מטלה' : 'מה צריך לעשות?'}</h2>
              </div>
              <button type="button" className="btn-text" onClick={closeTaskModal}>
                סגירה
              </button>
            </div>

            <form className="task-form" onSubmit={handleAddTask} noValidate>
              <label className="field">
                <span className="field__label">שם המטלה</span>
                <input className="field__input" value={taskForm.title} onChange={(event) => updateTaskForm('title', event.target.value)} />
              </label>

              <div className="task-form__grid">
                <label className="field">
                  <span className="field__label">אחראי</span>
                  <select className="field__input" value={taskForm.assigneeId} onChange={(event) => updateTaskForm('assigneeId', event.target.value)}>
                    {roommates.map((roommate) => (
                      <option key={roommate.id} value={roommate.id}>
                        {roommate.name}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="field">
                  <span className="field__label">תאריך יעד</span>
                  <input className="field__input" type="date" dir="ltr" value={taskForm.dueDate} onChange={(event) => updateTaskForm('dueDate', event.target.value)} />
                </label>
              </div>

              <label className="field">
                <span className="field__label">סטטוס</span>
                <select className="field__input" value={taskForm.status} onChange={(event) => updateTaskForm('status', event.target.value as TaskStatus)}>
                  {taskStatusOptions.map((status) => (
                    <option key={status.value} value={status.value}>
                      {status.label}
                    </option>
                  ))}
                </select>
              </label>

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

      {selectedTask ? (
        <div className="modal-backdrop" role="presentation">
          <section className="task-modal card" role="dialog" aria-modal="true" aria-labelledby="task-details-title">
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
                  <strong>{taskStatusOptions.find((option) => option.value === selectedTask.status)?.label ?? selectedTask.status}</strong>
                </div>
              </div>

              {detailsError ? <p className="form-message form-message--error">{detailsError}</p> : null}

              <div className="expense-form__actions">
                <button type="button" className="btn btn--secondary" onClick={() => openEditTaskModal(selectedTask)}>
                  עריכה
                </button>
                <button type="button" className="btn btn--danger" onClick={() => setTaskToDelete(selectedTask.id)}>
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
    </div>
  )
}
