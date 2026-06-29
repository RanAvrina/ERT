import { Component, StrictMode, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { ApartmentProvider } from './context/ApartmentContext'
import { AuthProvider } from './context/AuthContext'
import { ExpensesProvider } from './context/ExpensesContext'
import { ShoppingProvider } from './context/ShoppingContext'
import { TasksProvider } from './context/TasksContext'
import { TicketsProvider } from './context/TicketsContext'
import './index.css'
import App from './App.tsx'

interface AppErrorBoundaryState {
  error: Error | null
}

class AppErrorBoundary extends Component<{ children: ReactNode }, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = {
    error: null,
  }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error) {
    console.error('React app crashed during render.', error)
  }

  render() {
    if (!this.state.error) {
      return this.props.children
    }

    return (
      <div className="auth-page">
        <section className="auth-card card" style={{ maxWidth: 720, width: '100%' }}>
          <header className="auth-card__header">
            <h2 className="auth-card__title">שגיאת טעינה מקומית</h2>
            <p className="auth-card__sub">
              האפליקציה קרסה בזמן הטעינה. פתחו את ה-Console בדפדפן כדי לראות את השגיאה המלאה.
            </p>
          </header>
          <div className="form-stack">
            <p className="form-message form-message--error">
              {this.state.error.message || 'Unknown render error.'}
            </p>
          </div>
        </section>
      </div>
    )
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AppErrorBoundary>
        <ApartmentProvider>
          <AuthProvider>
            <ExpensesProvider>
              <TasksProvider>
                <ShoppingProvider>
                  <TicketsProvider>
                    <App />
                  </TicketsProvider>
                </ShoppingProvider>
              </TasksProvider>
            </ExpensesProvider>
          </AuthProvider>
        </ApartmentProvider>
      </AppErrorBoundary>
    </BrowserRouter>
  </StrictMode>,
)
