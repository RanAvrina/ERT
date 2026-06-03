interface ConfirmDialogProps {
  title: string
  message: string
  confirmLabel: string
  cancelLabel: string
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <div
      className="modal-backdrop modal-backdrop--dialog"
      role="presentation"
      onClick={onCancel}
    >
      <section
        className="confirm-dialog card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="confirm-dialog__head">
          <span className="confirm-dialog__mark confirm-dialog__mark--danger" aria-hidden="true">
            !
          </span>
          <button type="button" className="btn-text confirm-dialog__close" onClick={onCancel}>
            סגירה
          </button>
        </div>
        <div className="confirm-dialog__body">
          <h2 id="confirm-dialog-title">{title}</h2>
          <p>{message}</p>
        </div>
        <div className="confirm-dialog__actions">
          <button type="button" className="btn btn--secondary" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button type="button" className="btn btn--danger" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </section>
    </div>
  )
}
