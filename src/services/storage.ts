// src/services/storage.ts
import { registerDatabaseState, saveDatabaseState } from './database'

const PREFIX = 'shift-scheduler:v1:'

export function loadState<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(PREFIX + key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

export function saveState<T>(key: string, value: T): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value))
  } catch {
    /* quota exceeded — ignore in v1 */
  }
  saveDatabaseState(key, value)
}

/** Hydrate a store from Supabase and keep receiving realtime updates. */
export function syncState<T>(key: string, currentValue: T, apply: (value: T) => void): () => void {
  return registerDatabaseState(key, currentValue, (value) => {
    try {
      localStorage.setItem(PREFIX + key, JSON.stringify(value))
    } catch {
      /* local cache is optional when Supabase is connected */
    }
    apply(value)
  })
}

export function clearAll(): void {
  Object.keys(localStorage)
    .filter((k) => k.startsWith(PREFIX))
    .forEach((k) => localStorage.removeItem(k))
}