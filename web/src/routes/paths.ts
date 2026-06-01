export const appRoutes = {
  login: '/login',
  register: '/register',
  resetPassword: '/reset-password',
  createApartment: '/apartment/new',
  joinApartment: '/invite/:apartmentId',
  onboarding: '/onboarding',
  join: '/join',
  finance: '/finance',
  dashboard: '/',
  expenses: '/expenses',
  payments: '/payments',
  tasks: '/tasks',
  shopping: '/shopping',
  tickets: '/tickets',
  roommates: '/roommates',
  apartmentInfo: '/roommates/apartment-info',
} as const

export function ticketDetailsPath(id: number | string) {
  return `/tickets/${id}`
}
