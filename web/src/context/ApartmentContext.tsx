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
import type { Apartment, User } from '../types/models'
import type {
  AddLandlordInput,
  AddRoommateInput,
  AddUserAccountInput,
  ApartmentState,
  CreateApartmentInput,
} from '../types/apartmentState'
import type { InviteRole } from '../utils/invite'
import {
  useApartmentsRegistryStore,
  useApartmentStateStore,
} from '../data/repositories/apartmentRepository'
import { isSupabaseConfigured } from '../lib/supabase/env'
import {
  createApartmentViaApi,
  loadApartmentStateViaApi,
} from '../data/server/apartmentsApi'
import { acceptInviteViaApi } from '../data/server/invitesApi'
import {
  createRoommateMembershipViaApi,
  removeRoommateViaApi,
} from '../data/server/roommatesApi'

interface ApartmentContextValue {
  current: ApartmentState | null
  getApartmentById: (apartmentId: number) => ApartmentState | null
  activateApartment: (
    apartmentId: number,
    preloadedState?: ApartmentState | null,
  ) => Promise<ApartmentState | null>
  clearActiveApartment: () => void
  createApartment: (input: CreateApartmentInput) => Promise<ApartmentState>
  addRoommate: (input: AddRoommateInput) => ApartmentState | null
  removeRoommate: (roommateId: number) => Promise<ApartmentState | null>
  addUserAccount: (input: AddUserAccountInput) => Promise<User | null>
  addLandlord: (input: AddLandlordInput) => Promise<User | null>
  completeInviteJoin: (input: CompleteInviteJoinInput) => Promise<CompleteInviteJoinResult>
}

interface CompleteInviteJoinInput {
  apartmentId: number
  role: InviteRole
  user: User
  token?: string | null
}

interface CompleteInviteJoinResult {
  ok: boolean
  user: User | null
  error: string
}

interface ExistingMembership {
  apartmentId: number
  apartmentName: string
  role: User['role']
  user: User
}

const ApartmentContext = createContext<ApartmentContextValue | null>(null)
const APARTMENT_DATA_CHANGED_EVENT = 'assistant:data-changed'

function findExistingMembership(
  registry: Record<number, ApartmentState>,
  user: User,
): ExistingMembership | null {
  const normalizedEmail = user.email.trim().toLowerCase()

  for (const apartmentState of Object.values(registry)) {
    const candidates: User[] = [
      apartmentState.adminUser,
      ...apartmentState.roommates,
      ...(apartmentState.landlordUser ? [apartmentState.landlordUser] : []),
    ]

    const match = candidates.find(
      (candidate) =>
        candidate.id === user.id ||
        candidate.email.trim().toLowerCase() === normalizedEmail,
    )

    if (match) {
      return {
        apartmentId: apartmentState.apartment.id,
        apartmentName: apartmentState.apartment.name,
        role: match.role,
        user: match,
      }
    }
  }

  return null
}

export function ApartmentProvider({ children }: { children: ReactNode }) {
  const [current, setCurrent] = useApartmentStateStore()
  const [apartmentsRegistry, setApartmentsRegistry] = useApartmentsRegistryStore()
  const apartmentsRegistryRef = useRef(apartmentsRegistry)

  useEffect(() => {
    apartmentsRegistryRef.current = apartmentsRegistry
  }, [apartmentsRegistry])

  const persistApartmentState = useCallback(
    (nextState: ApartmentState) => {
      setCurrent(nextState)
      setApartmentsRegistry((currentRegistry) => ({
        ...currentRegistry,
        [nextState.apartment.id]: nextState,
      }))
      return nextState
    },
    [setApartmentsRegistry, setCurrent],
  )

  const getApartmentById = useCallback(
    (apartmentId: number) => apartmentsRegistryRef.current[apartmentId] ?? null,
    [],
  )

  const activateApartment = useCallback(
    async (apartmentId: number, preloadedState?: ApartmentState | null) => {
      if (!isSupabaseConfigured) {
        return apartmentsRegistryRef.current[apartmentId] ?? null
      }

      const nextState = preloadedState ?? (await loadApartmentStateViaApi(apartmentId))
      return persistApartmentState(nextState)
    },
    [persistApartmentState],
  )

  const clearActiveApartment = useCallback(() => {
    setCurrent(null)
  }, [setCurrent])

  useEffect(() => {
    if (!current) return

    setApartmentsRegistry((currentRegistry) => {
      const existingState = currentRegistry[current.apartment.id]
      if (existingState) return currentRegistry

      return {
        ...currentRegistry,
        [current.apartment.id]: current,
      }
    })
  }, [current, setApartmentsRegistry])

  const createApartment = useCallback(
    async (input: CreateApartmentInput) => {
      if (isSupabaseConfigured) {
        const response = await createApartmentViaApi(input.apartmentName)
        let nextState: ApartmentState | null = null

        // The apartment creation request can succeed before the new membership/state
        // is immediately readable. Retry briefly instead of surfacing a false failure.
        for (let attempt = 0; attempt < 4; attempt += 1) {
          try {
            nextState = await loadApartmentStateViaApi(response.apartment.id)
            break
          } catch (error) {
            if (attempt === 3) {
              console.warn('Apartment was created but state loading failed immediately.', error)
              break
            }

            await new Promise((resolve) => window.setTimeout(resolve, 350 * (attempt + 1)))
          }
        }

        if (!nextState) {
          const adminId = input.adminUserId ?? Date.now()
          const fallbackAdmin: User = {
            id: adminId,
            apartment_id: response.apartment.id,
            name: input.adminName.trim(),
            email: input.adminEmail.trim().toLowerCase(),
            role: 'admin',
            status: 'active',
            joined_at: new Date().toISOString().slice(0, 10),
          }

          nextState = {
            apartment: {
              id: response.apartment.id,
              name: response.apartment.name,
              is_active: response.apartment.isActive,
            },
            adminUser: fallbackAdmin,
            adminContact: { phone: input.adminPhone.trim() },
            roommates: [fallbackAdmin],
            roommateContacts: {
              [fallbackAdmin.id]: { phone: input.adminPhone.trim() },
            },
            landlordUser: null,
            landlordContact: null,
            credentialsByEmail: input.adminPassword
              ? {
                  [fallbackAdmin.email]: input.adminPassword,
                }
              : {},
          }
        } else {
          nextState.adminContact = { phone: input.adminPhone.trim() }
          nextState.roommateContacts = {
            ...nextState.roommateContacts,
            [nextState.adminUser.id]: { phone: input.adminPhone.trim() },
          }
          nextState.credentialsByEmail = input.adminPassword
            ? {
                [input.adminEmail.trim().toLowerCase()]: input.adminPassword,
              }
            : {}
        }

        return persistApartmentState(nextState)
      }

      const nextApartment: Apartment = {
        id: Date.now(),
        name: input.apartmentName.trim(),
        is_active: true,
      }

      const nextAdmin: User = {
        id: input.adminUserId ?? Date.now() + 1,
        apartment_id: nextApartment.id,
        name: input.adminName.trim(),
        email: input.adminEmail.trim().toLowerCase(),
        role: 'admin',
        status: 'active',
        joined_at: new Date().toISOString().slice(0, 10),
      }

      const nextState: ApartmentState = {
        apartment: nextApartment,
        adminUser: nextAdmin,
        adminContact: { phone: input.adminPhone.trim() },
        roommates: [nextAdmin],
        roommateContacts: {
          [nextAdmin.id]: { phone: input.adminPhone.trim() },
        },
        landlordUser: null,
        landlordContact: null,
        credentialsByEmail: {
          [nextAdmin.email]: input.adminPassword ?? '',
        },
      }

      return persistApartmentState(nextState)
    },
    [persistApartmentState],
  )

  const addRoommate = useCallback(
    (input: AddRoommateInput) => {
      if (!current) return null
      const nextId = Date.now()
      const nextUser: User = {
        id: nextId,
        apartment_id: current.apartment.id,
        name: input.name.trim(),
        email: input.email.trim().toLowerCase(),
        role: 'tenant',
        status: 'active',
        joined_at: new Date().toISOString().slice(0, 10),
      }

      return persistApartmentState({
        ...current,
        roommates: [nextUser, ...current.roommates],
        roommateContacts: {
          ...current.roommateContacts,
          [nextId]: { phone: input.phone.trim() },
        },
        credentialsByEmail: current.credentialsByEmail ?? {},
      })
    },
    [current, persistApartmentState],
  )

  const removeRoommate = useCallback(
    async (roommateId: number) => {
      if (!current) return null
      if (roommateId === current.adminUser.id) return current

      if (isSupabaseConfigured) {
        await removeRoommateViaApi(current.apartment.id, roommateId)
        const nextState = await activateApartment(current.apartment.id)
        window.dispatchEvent(
          new CustomEvent(APARTMENT_DATA_CHANGED_EVENT, {
            detail: { apartmentId: current.apartment.id },
          }),
        )
        return nextState
      }

      return persistApartmentState({
        ...current,
        roommates: current.roommates.map((roommate) =>
          roommate.id === roommateId
            ? { ...roommate, status: 'inactive' }
            : roommate,
        ),
      })
    },
    [activateApartment, current, persistApartmentState],
  )

  const addUserAccount = useCallback(
    async (input: AddUserAccountInput) => {
      if (!current) return null

      if (isSupabaseConfigured) {
        const accountId = input.userId ?? Date.now()
        await createRoommateMembershipViaApi({
          apartmentId: current.apartment.id,
          accountId,
          role: input.role === 'landlord' ? 'landlord' : 'tenant',
        })

        const nextState = await activateApartment(current.apartment.id)
        return nextState?.roommates.find((roommate) => roommate.id === accountId) ?? null
      }

      const nextId = input.userId ?? Date.now()
      const nextUser: User = {
        id: nextId,
        apartment_id: current.apartment.id,
        name: input.name.trim(),
        email: input.email.trim().toLowerCase(),
        role: input.role ?? 'tenant',
        status: 'active',
        joined_at: new Date().toISOString().slice(0, 10),
      }

      persistApartmentState({
        ...current,
        roommates: [nextUser, ...current.roommates],
        roommateContacts: {
          ...current.roommateContacts,
          [nextId]: { phone: input.phone.trim() },
        },
        credentialsByEmail: input.password
          ? {
              ...(current.credentialsByEmail ?? {}),
              [nextUser.email]: input.password,
            }
          : current.credentialsByEmail ?? {},
      })

      return nextUser
    },
    [activateApartment, current, persistApartmentState],
  )

  const addLandlord = useCallback(
    async (input: AddLandlordInput) => {
      if (!current) return null

      if (isSupabaseConfigured) {
        const accountId = input.userId ?? Date.now()
        await createRoommateMembershipViaApi({
          apartmentId: current.apartment.id,
          accountId,
          role: 'landlord',
        })

        const nextState = await activateApartment(current.apartment.id)
        return nextState?.landlordUser ?? null
      }

      const nextId = input.userId ?? Date.now()
      const nextUser: User = {
        id: nextId,
        apartment_id: current.apartment.id,
        name: input.name.trim(),
        email: input.email.trim().toLowerCase(),
        role: 'landlord',
        status: 'active',
        joined_at: new Date().toISOString().slice(0, 10),
      }

      persistApartmentState({
        ...current,
        landlordUser: nextUser,
        landlordContact: { phone: input.phone.trim() },
        credentialsByEmail: input.password
          ? {
              ...(current.credentialsByEmail ?? {}),
              [nextUser.email]: input.password,
            }
          : current.credentialsByEmail ?? {},
      })

      return nextUser
    },
    [activateApartment, current, persistApartmentState],
  )

  const completeInviteJoin = useCallback(
    async ({
      apartmentId,
      role,
      user,
      token,
    }: CompleteInviteJoinInput): Promise<CompleteInviteJoinResult> => {
      if (isSupabaseConfigured) {
        try {
          if (token) {
            await acceptInviteViaApi(token)
          } else {
            await createRoommateMembershipViaApi({
              apartmentId,
              accountId: user.id,
              role: role === 'landlord' ? 'landlord' : 'tenant',
            })
          }

          const nextState = await activateApartment(apartmentId)
          const joinedUser =
            nextState?.roommates.find((roommate) => roommate.id === user.id) ??
            (nextState?.landlordUser?.id === user.id
              ? nextState.landlordUser
              : null)

          if (!nextState || !joinedUser) {
            return {
              ok: false,
              user: null,
              error: 'לא הצלחנו להשלים את השיוך לדירה.',
            }
          }

          return { ok: true, user: joinedUser, error: '' }
        } catch (error) {
          return {
            ok: false,
            user: null,
            error:
              error instanceof Error && error.message
                ? error.message
                : 'לא הצלחנו להשלים את השיוך לדירה.',
          }
        }
      }

      const targetApartmentState = apartmentsRegistry[apartmentId] ?? null

      if (!targetApartmentState) {
        return {
          ok: false,
          user: null,
          error: 'לא נמצאה דירה זמינה להצטרפות מהקישור הזה.',
        }
      }

      const normalizedEmail = user.email.trim().toLowerCase()
      const existingMembership = findExistingMembership(apartmentsRegistry, user)

      if (
        existingMembership &&
        existingMembership.apartmentId !== targetApartmentState.apartment.id
      ) {
        return {
          ok: false,
          user: null,
          error: 'החשבון כבר משויך לדירה אחרת. אי אפשר לצרף אותו לדירה נוספת.',
        }
      }

      if (
        existingMembership &&
        existingMembership.apartmentId === targetApartmentState.apartment.id &&
        existingMembership.role !== role
      ) {
        const roleLabel =
          existingMembership.role === 'admin'
            ? 'מנהל דירה'
            : existingMembership.role === 'landlord'
              ? 'בעל דירה'
              : 'דייר'

        return {
          ok: false,
          user: null,
          error: `החשבון כבר משויך לדירה הזו בתפקיד ${roleLabel}. אי אפשר לשנות אותו דרך קישור הזמנה אחר.`,
        }
      }

      if (role === 'landlord') {
        if (
          targetApartmentState.landlordUser &&
          targetApartmentState.landlordUser.email.toLowerCase() !== normalizedEmail
        ) {
          return {
            ok: false,
            user: null,
            error:
              'כבר משויך בעל דירה אחר לדירה הזו. צריך להסיר או לעדכן אותו לפני שליחת הזמנה חדשה.',
          }
        }

        const nextLandlord: User = {
          ...(existingMembership?.user ?? user),
          apartment_id: targetApartmentState.apartment.id,
          email: normalizedEmail,
          role: 'landlord',
          status: 'active',
        }

        const nextState: ApartmentState = {
          ...targetApartmentState,
          landlordUser: nextLandlord,
          landlordContact:
            targetApartmentState.landlordUser?.email.toLowerCase() === normalizedEmail
              ? targetApartmentState.landlordContact
              : targetApartmentState.landlordContact ?? { phone: '' },
          roommates: targetApartmentState.roommates.filter(
            (roommate) => roommate.email.toLowerCase() !== normalizedEmail,
          ),
        }

        persistApartmentState(nextState)
        return { ok: true, user: nextLandlord, error: '' }
      }

      const existingRoommate = targetApartmentState.roommates.find(
        (roommate) => roommate.email.toLowerCase() === normalizedEmail,
      )

      const nextTenant: User = {
        ...(existingRoommate ?? existingMembership?.user ?? user),
        apartment_id: targetApartmentState.apartment.id,
        email: normalizedEmail,
        role: 'tenant',
        status: 'active',
      }

      const nextState: ApartmentState = {
        ...targetApartmentState,
        roommates: existingRoommate
          ? targetApartmentState.roommates.map((roommate) =>
              roommate.id === existingRoommate.id ? nextTenant : roommate,
            )
          : [nextTenant, ...targetApartmentState.roommates],
        roommateContacts: {
          ...targetApartmentState.roommateContacts,
          [nextTenant.id]:
            targetApartmentState.roommateContacts[nextTenant.id] ?? { phone: '' },
        },
      }

      persistApartmentState(nextState)
      return { ok: true, user: nextTenant, error: '' }
    },
    [activateApartment, apartmentsRegistry, persistApartmentState],
  )

  const value = useMemo(
    () => ({
      current,
      getApartmentById,
      activateApartment,
      clearActiveApartment,
      createApartment,
      addRoommate,
      removeRoommate,
      addUserAccount,
      addLandlord,
      completeInviteJoin,
    }),
    [
      current,
      getApartmentById,
      activateApartment,
      clearActiveApartment,
      createApartment,
      addRoommate,
      removeRoommate,
      addUserAccount,
      addLandlord,
      completeInviteJoin,
    ],
  )

  return <ApartmentContext.Provider value={value}>{children}</ApartmentContext.Provider>
}

export function useApartment() {
  const ctx = useContext(ApartmentContext)
  if (!ctx) throw new Error('useApartment must be used within ApartmentProvider')
  return ctx
}
