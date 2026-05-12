import { useEffect, useState } from 'react'
import { persistenceAdapter } from '.'

export function usePersistedValue<T>(key: string, fallback: T) {
  const [value, setValue] = useState<T>(() => persistenceAdapter.read(key, fallback))

  useEffect(() => {
    persistenceAdapter.write(key, value)
  }, [key, value])

  return [value, setValue] as const
}
