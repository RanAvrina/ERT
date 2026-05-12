/* eslint-disable react-refresh/only-export-components */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import {
  useAccountsStore,
  useAuthSessionStore,
} from '../data/repositories/authRepository'
import {
  getCurrentAuthUser,
  sendPasswordResetEmail as sendSupabasePasswordResetEmail,
  signInWithPassword as signInWithSupabasePassword,
  signOutAuth,
  signUpWithPassword,
  subscribeToAuthChanges,
} from '../data/supabase/authRepository'
import {
  ensureAccountViaApi,
  readBootstrapViaApi,
} from '../data/server/authApi'
import { isSupabaseConfigured } from '../lib/supabase/env'
import { appRoutes } from '../routes/paths'
import { useApartment } from './ApartmentContext'
import type { AccountIdentity, AuthResult } from '../types/auth'
import type { User } from '../types/models'

interface AccountCreationResult {
  ok: boolean
  error: string
  account?: AccountIdentity
}

interface LoginInput {
  email: string
  password: string
  allowDetachedAccount?: boolean
}

interface RegisterInput {
  name: string
  phone: string
  email: string
  password: string
  role?: User['role']
  attachToApartment?: boolean
  signInAfterRegister?: boolean
}

interface AuthState {
  user: User | null
  isAuthReady: boolean
  login: (input: LoginInput) => Promise<AuthResult>
  register: (input: RegisterInput) => Promise<AuthResult>
  createAccountIdentity: (input: RegisterInput) => Promise<AccountCreationResult>
  sendPasswordResetEmail: (email: string) => Promise<{ ok: boolean; error: string }>
  updateSessionUser: (user: User) => void
  logout: () => void
}

const AuthContext = createContext<AuthState | null>(null)

function normalizeEmail(email: string) {
  return email.trim().toLowerCase()
}

function buildDetachedUser(account: AccountIdentity, role: User['role'] = 'tenant'): User {
  return {
    id: account.id,
    apartment_id: 0,
    name: account.name,
    email: account.email,
    role,
    status: 'active',
    joined_at: new Date().toISOString().slice(0, 10),
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const {
    current,
    addUserAccount,
    addLandlord,
    activateApartment,
    clearActiveApartment,
  } = useApartment()
  const [accounts, setAccounts] = useAccountsStore()
  const [user, setUser] = useAuthSessionStore()
  const [isAuthReady, setIsAuthReady] = useState(!isSupabaseConfigured)
  const authSyncVersionRef = useRef(0)

  const users = useMemo(
    () =>
      current
        ? [
            ...current.roommates,
            ...(current.landlordUser ? [current.landlordUser] : []),
          ]
        : [],
    [current],
  )

  useEffect(() => {
    if (isSupabaseConfigured || !current?.credentialsByEmail) return

    const apartmentUsers = [
      current.adminUser,
      ...current.roommates,
      ...(current.landlordUser ? [current.landlordUser] : []),
    ]

    setAccounts((existingAccounts) => {
      let changed = false
      const nextAccounts = [...existingAccounts]

      Object.entries(current.credentialsByEmail).forEach(([email, password]) => {
        const normalizedEmail = normalizeEmail(email)
        const exists = nextAccounts.some(
          (account) => normalizeEmail(account.email) === normalizedEmail,
        )

        if (exists) return

        const matchedUser = apartmentUsers.find(
          (candidate) => normalizeEmail(candidate.email) === normalizedEmail,
        )

        nextAccounts.unshift({
          id: matchedUser?.id ?? Date.now() + nextAccounts.length,
          name: matchedUser?.name ?? normalizedEmail,
          email: normalizedEmail,
          phone: '',
          password,
        })
        changed = true
      })

      return changed ? nextAccounts : existingAccounts
    })
  }, [current, setAccounts])

  const persistUser = useCallback(
    (nextUser: User | null) => {
      setUser(nextUser)
    },
    [setUser],
  )

  useEffect(() => {
    if (!isSupabaseConfigured) return

    let cancelled = false

    async function syncFromSupabaseSession(emailFromSession?: string | null) {
      const syncVersion = ++authSyncVersionRef.current
      const isLatestSync = () => !cancelled && authSyncVersionRef.current === syncVersion

      try {
        const authUser = emailFromSession
          ? { email: emailFromSession }
          : await getCurrentAuthUser()

        const normalizedEmail = authUser?.email ? normalizeEmail(authUser.email) : ''
        if (!normalizedEmail) {
          if (isLatestSync()) {
            persistUser(null)
            clearActiveApartment()
            setIsAuthReady(true)
          }
          return
        }

        const snapshot = await readBootstrapViaApi()
        const account =
          snapshot.account &&
          normalizeEmail(snapshot.account.email) === normalizedEmail
            ? snapshot.account
            : null

        if (!account) {
          if (isLatestSync()) {
            persistUser(null)
            clearActiveApartment()
            setIsAuthReady(true)
          }
          return
        }

        if (!snapshot.membership || !snapshot.apartmentState) {
          if (isLatestSync()) {
            clearActiveApartment()
            persistUser(buildDetachedUser(account))
            setIsAuthReady(true)
          }
          return
        }

        const apartmentState = await activateApartment(
          snapshot.apartmentState.apartment.id,
          snapshot.apartmentState,
        )

        const nextUser =
          apartmentState?.roommates.find((member) => member.id === account.id) ??
          (apartmentState?.landlordUser?.id === account.id
            ? apartmentState.landlordUser
            : null)

        if (isLatestSync()) {
          persistUser(nextUser ?? buildDetachedUser(account, snapshot.membership.role))
          setIsAuthReady(true)
        }
      } catch {
        if (isLatestSync()) {
          persistUser(null)
          clearActiveApartment()
          setIsAuthReady(true)
        }
      }
    }

    void syncFromSupabaseSession()

    const unsubscribe = subscribeToAuthChanges((_event, sessionUser) => {
      void syncFromSupabaseSession(sessionUser?.email ?? null)
    })

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [activateApartment, clearActiveApartment, persistUser])

  const createAccountIdentity = useCallback(
    async ({ name, phone, email, password }: RegisterInput): Promise<AccountCreationResult> => {
      const normalizedEmail = normalizeEmail(email)

      if (!name.trim()) {
        return { ok: false, error: 'צריך למלא שם מלא.' }
      }

      if (!phone.trim()) {
        return { ok: false, error: 'נדרש מספר טלפון.' }
      }

      if (!normalizedEmail) {
        return { ok: false, error: 'נדרשת כתובת אימייל.' }
      }

      if (password.trim().length < 6) {
        return { ok: false, error: 'הסיסמה צריכה לכלול לפחות 6 תווים.' }
      }

      const existingLocalAccount = !isSupabaseConfigured
        ? accounts.find((account) => normalizeEmail(account.email) === normalizedEmail)
        : null

      if (existingLocalAccount) {
        return {
          ok: false,
          error: 'כבר קיים חשבון עם כתובת המייל הזו.',
        }
      }

      let nextAccount: AccountIdentity

      try {
        if (isSupabaseConfigured) {
          await signUpWithPassword({
            email: normalizedEmail,
            password,
            name: name.trim(),
            phone: phone.trim(),
          })

          nextAccount = await ensureAccountViaApi({
            fullName: name.trim(),
            phone: phone.trim(),
          })
        } else {
          nextAccount = {
            id: Date.now(),
            name: name.trim(),
            email: normalizedEmail,
            phone: phone.trim(),
            password,
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : ''
        return {
          ok: false,
          error:
            message.includes('already') ||
            message.includes('duplicate') ||
            message.includes('unique')
              ? 'כבר קיים חשבון עם כתובת המייל הזו.'
              : message || 'לא הצלחנו ליצור את החשבון.',
        }
      }

      setAccounts((currentAccounts) => {
        const exists = currentAccounts.some((account) => account.id === nextAccount.id)
        return exists ? currentAccounts : [nextAccount, ...currentAccounts]
      })

      return { ok: true, error: '', account: nextAccount }
    },
    [accounts, setAccounts],
  )

  const login = useCallback(
    async ({
      email,
      password,
      allowDetachedAccount = false,
    }: LoginInput): Promise<AuthResult> => {
      const normalizedEmail = normalizeEmail(email)

      if (!normalizedEmail) {
        return { ok: false, error: 'צריך להזין כתובת אימייל.' }
      }

      if (!password.trim()) {
        return { ok: false, error: 'צריך להזין סיסמה.' }
      }

      try {
        if (isSupabaseConfigured) {
          await signInWithSupabasePassword({ email: normalizedEmail, password })

          const snapshot = await readBootstrapViaApi()
          const account = snapshot.account

          if (!account) {
            return {
              ok: false,
              error: 'החשבון אומת, אבל לא הצלחנו לטעון את פרופיל המשתמש.',
            }
          }

          if (!snapshot.membership || !snapshot.apartmentState) {
            if (!allowDetachedAccount) {
              return {
                ok: false,
                error:
                  'החשבון קיים, אבל עדיין לא משויך לדירה. צריך להיכנס דרך קישור הזמנה.',
              }
            }

            const detachedUser = buildDetachedUser(account)
            persistUser(detachedUser)
            clearActiveApartment()
            return { ok: true, error: '', user: detachedUser }
          }

          const apartmentState = await activateApartment(
            snapshot.apartmentState.apartment.id,
            snapshot.apartmentState,
          )
          const nextUser =
            apartmentState?.roommates.find((member) => member.id === account.id) ??
            (apartmentState?.landlordUser?.id === account.id
              ? apartmentState.landlordUser
              : null)

          if (!nextUser) {
            return {
              ok: false,
              error: 'לא הצלחנו לטעון את פרטי הדירה של החשבון הזה.',
            }
          }

          persistUser(nextUser)
          return { ok: true, error: '', user: nextUser }
        }

        const localMatchedMembership = users.find(
          (candidate) => normalizeEmail(candidate.email) === normalizedEmail,
        )
        const matchedAccount = accounts.find(
          (account) => normalizeEmail(account.email) === normalizedEmail,
        )

        if (!matchedAccount) {
          return { ok: false, error: 'לא מצאנו חשבון עם כתובת המייל הזו.' }
        }

        if (matchedAccount.password !== password) {
          return { ok: false, error: 'כתובת האימייל או הסיסמה לא נכונות.' }
        }

        if (!localMatchedMembership && !allowDetachedAccount) {
          return {
            ok: false,
            error: 'החשבון קיים, אבל עדיין לא משויך לדירה. צריך להיכנס דרך קישור הזמנה.',
          }
        }

        const nextUser =
          localMatchedMembership ??
          ({
            id: matchedAccount.id,
            apartment_id: current?.apartment.id ?? 0,
            name: matchedAccount.name,
            email: matchedAccount.email,
            role: 'tenant',
            status: 'active',
            joined_at: new Date().toISOString().slice(0, 10),
          } satisfies User)

        persistUser(nextUser)
        return { ok: true, error: '', user: nextUser }
      } catch (error) {
        return {
          ok: false,
          error:
            error instanceof Error && error.message
              ? error.message
              : 'לא הצלחנו להתחבר לחשבון.',
        }
      }
    },
    [accounts, activateApartment, clearActiveApartment, current, persistUser, users],
  )

  const register = useCallback(
    async ({
      name,
      phone,
      email,
      password,
      role,
      attachToApartment = false,
      signInAfterRegister = attachToApartment,
    }: RegisterInput): Promise<AuthResult> => {
      const accountResult = await createAccountIdentity({
        name,
        phone,
        email,
        password,
        role,
      })
      if (!accountResult.ok || !accountResult.account) {
        return {
          ok: false,
          error: accountResult.error || 'לא הצלחנו ליצור את החשבון.',
        }
      }

      const account = accountResult.account

      if (!attachToApartment) {
        const detachedUser = buildDetachedUser(account, role ?? 'tenant')

        if (signInAfterRegister) {
          persistUser(detachedUser)
        }

        return { ok: true, error: '', user: detachedUser }
      }

      const createdUser =
        role === 'landlord'
          ? await addLandlord({ userId: account.id, name, email, phone, password })
          : await addUserAccount({ userId: account.id, name, email, phone, password })

      const nextUser =
        createdUser ??
        ({
          id: account.id,
          apartment_id: current?.apartment.id ?? 0,
          name: name.trim(),
          email: normalizeEmail(email),
          role: role ?? 'tenant',
          status: 'active',
          joined_at: new Date().toISOString().slice(0, 10),
        } satisfies User)

      if (signInAfterRegister) {
        persistUser(nextUser)
      }

      return { ok: true, error: '', user: nextUser }
    },
    [addLandlord, addUserAccount, createAccountIdentity, current, persistUser],
  )

  const sendPasswordResetEmail = useCallback(async (email: string) => {
    if (!email.trim()) {
      return { ok: false, error: 'צריך להזין כתובת אימייל.' }
    }

    if (!isSupabaseConfigured) {
      return { ok: true, error: '' }
    }

    try {
      const redirectTo =
        typeof window !== 'undefined'
          ? `${window.location.origin}${appRoutes.resetPassword}`
          : appRoutes.resetPassword

      await sendSupabasePasswordResetEmail(email, redirectTo)
      return { ok: true, error: '' }
    } catch {
      return { ok: true, error: '' }
    }
  }, [])

  const logout = useCallback(() => {
    persistUser(null)
    clearActiveApartment()
    if (isSupabaseConfigured) {
      void signOutAuth()
    }
  }, [clearActiveApartment, persistUser])

  const updateSessionUser = useCallback(
    (nextUser: User) => {
      persistUser(nextUser)
    },
    [persistUser],
  )

  const value = useMemo(
    () => ({
      user,
      isAuthReady,
      login,
      register,
      createAccountIdentity,
      sendPasswordResetEmail,
      updateSessionUser,
      logout,
    }),
    [
      user,
      isAuthReady,
      login,
      register,
      createAccountIdentity,
      sendPasswordResetEmail,
      updateSessionUser,
      logout,
    ],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
