import type { Request } from 'express'
import { ApiError } from './api-error.js'

export function getApartmentIdFromParams(request: Request) {
  const apartmentId = Number(request.params.apartmentId)
  if (!Number.isInteger(apartmentId) || apartmentId <= 0) {
    throw new ApiError(400, 'A valid apartment id is required.')
  }

  return apartmentId
}

export function getResourceIdFromParams(request: Request, paramName: string) {
  const value = Number(request.params[paramName])
  if (!Number.isInteger(value) || value <= 0) {
    throw new ApiError(400, `A valid ${paramName} is required.`)
  }

  return value
}
