import { useState } from 'react'

export function useMemoryValue<T>(fallback: T) {
  return useState<T>(fallback)
}
