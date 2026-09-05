import { reactive } from 'vue'
import {
  createClient,
  type RealtimeChannel,
  type SupabaseClient,
  type User
} from '@supabase/supabase-js'

export type DatabaseStatus = 'disabled' | 'unauthenticated' | 'connecting' | 'connected' | 'error'

export const databaseConnection = reactive<{
  status: DatabaseStatus
  message: string
}>({
  status: 'disabled',
  message: 'Using local storage'
})

export const databaseUser = reactive<{
  id: string | null
  email: string | null
}>({
  id: null,
  email: null
})

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim()
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim()

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey)

interface StateRegistration {
  value: unknown
  serialized: string
  apply: (value: unknown) => void
}

const registrations = new Map<string, StateRegistration>()
const pendingWrites = new Map<string, unknown>()
const writeTimers = new Map<string, ReturnType<typeof setTimeout>>()

let client: SupabaseClient | null = null
let userId: string | null = null
let channel: RealtimeChannel | null = null
let initialization: Promise<void> | null = null

function serialize(value: unknown): string {
  return JSON.stringify(value)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function upsertState(key: string, value: unknown): Promise<void> {
  if (!client || !userId) {
    pendingWrites.set(key, value)
    return
  }

  const { error } = await client
    .from('scheduler_state')
    .upsert(
      { user_id: userId, state_key: key, value },
      { onConflict: 'user_id,state_key' }
    )

  if (error) throw error
}

async function flushPendingWrites(): Promise<void> {
  const writes = [...pendingWrites.entries()]
  pendingWrites.clear()
  await Promise.all(writes.map(([key, value]) => upsertState(key, value)))
}

function applyRemoteValue(key: string, value: unknown): void {
  const registration = registrations.get(key)
  if (!registration) return
  const serialized = serialize(value)
  if (serialized === registration.serialized) return
  registration.value = value
  registration.serialized = serialized
  registration.apply(value)
}

async function connectUser(user: User): Promise<void> {
  if (!client) throw new Error('Supabase client is not initialized')

  databaseConnection.status = 'connecting'
  databaseConnection.message = 'Loading admin data…'
  userId = user.id
  databaseUser.id = user.id
  databaseUser.email = user.email ?? null

  if (channel) await client.removeChannel(channel)

  const localSnapshots = new Map(
    [...registrations].map(([key, registration]) => [key, registration.serialized])
  )
  const { data: rows, error } = await client
    .from('scheduler_state')
    .select('state_key,value')
    .eq('user_id', userId)
  if (error) throw error

  const remote = new Map((rows ?? []).map((row) => [row.state_key as string, row.value]))
  for (const [key, registration] of registrations) {
    if (remote.has(key)) {
      if (registration.serialized === localSnapshots.get(key)) {
        applyRemoteValue(key, remote.get(key))
      } else {
        pendingWrites.set(key, registration.value)
      }
    } else {
      pendingWrites.set(key, registration.value)
    }
  }

  await flushPendingWrites()

  channel = client
    .channel(`scheduler-state-${userId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'scheduler_state',
        filter: `user_id=eq.${userId}`
      },
      (payload) => {
        const row = payload.new as { state_key?: string; value?: unknown }
        if (row.state_key) applyRemoteValue(row.state_key, row.value)
      }
    )
    .subscribe()

  databaseConnection.status = 'connected'
  databaseConnection.message = databaseUser.email
    ? `Connected as ${databaseUser.email}`
    : 'Supabase connected'
}

/**
 * Register one local state key for database hydration and realtime updates.
 * The current local value is uploaded only when no remote row exists.
 */
export function registerDatabaseState<T>(
  key: string,
  currentValue: T,
  apply: (value: T) => void
): () => void {
  const registration: StateRegistration = {
    value: currentValue,
    serialized: serialize(currentValue),
    apply: (value) => apply(value as T)
  }
  registrations.set(key, registration)

  if (databaseConnection.status === 'connected' && client && userId) {
    const serializedAtRequest = registration.serialized
    void client
      .from('scheduler_state')
      .select('value')
      .eq('user_id', userId)
      .eq('state_key', key)
      .maybeSingle()
      .then(({ data, error }) => {
        if (error) {
          databaseConnection.status = 'error'
          databaseConnection.message = error.message
        } else if (data) {
          if (registration.serialized === serializedAtRequest) {
            applyRemoteValue(key, data.value)
          } else {
            void upsertState(key, registration.value)
          }
        } else {
          void upsertState(key, registration.value)
        }
      })
  }

  return () => registrations.delete(key)
}

/** Queue a debounced cloud write; localStorage remains the immediate cache. */
export function saveDatabaseState<T>(key: string, value: T): void {
  if (!isSupabaseConfigured) return
  const registration = registrations.get(key)
  if (registration) {
    registration.value = value
    registration.serialized = serialize(value)
  }
  pendingWrites.set(key, value)

  const existing = writeTimers.get(key)
  if (existing) clearTimeout(existing)
  writeTimers.set(key, setTimeout(() => {
    writeTimers.delete(key)
    const latest = pendingWrites.get(key)
    if (latest === undefined) return
    pendingWrites.delete(key)
    void upsertState(key, latest).catch((error: unknown) => {
      pendingWrites.set(key, latest)
      databaseConnection.status = 'error'
      databaseConnection.message = `Supabase write failed: ${errorMessage(error)}`
    })
  }, 300))
}

/**
 * Restores an authenticated admin session. The app remains locked when no
 * email/password session exists.
 */
export function initializeDatabase(): Promise<void> {
  if (initialization) return initialization
  if (!isSupabaseConfigured) {
    databaseConnection.status = 'disabled'
    databaseConnection.message = 'Supabase not configured — using local storage'
    return Promise.resolve()
  }

  initialization = (async () => {
    databaseConnection.status = 'connecting'
    databaseConnection.message = 'Connecting to Supabase…'

    try {
      client = createClient(supabaseUrl!, supabaseAnonKey!, {
        auth: { persistSession: true, autoRefreshToken: true }
      })

      const { data: sessionData, error: sessionError } = await client.auth.getSession()
      if (sessionError) throw sessionError

      const user = sessionData.session?.user ?? null
      if (!user || user.is_anonymous) {
        if (user?.is_anonymous) await client.auth.signOut()
        userId = null
        databaseUser.id = null
        databaseUser.email = null
        databaseConnection.status = 'unauthenticated'
        databaseConnection.message = 'Admin sign-in required'
        return
      }

      await connectUser(user)
    } catch (error) {
      if (userId) {
        databaseConnection.status = 'error'
        databaseConnection.message = `Supabase unavailable — local changes are safe (${errorMessage(error)})`
      } else {
        databaseConnection.status = 'unauthenticated'
        databaseConnection.message = `Sign-in unavailable (${errorMessage(error)})`
      }
    }
  })()

  return initialization
}

export async function signInAdmin(email: string, password: string): Promise<void> {
  await initializeDatabase()
  if (!client) throw new Error('Supabase is not configured')

  databaseConnection.status = 'connecting'
  databaseConnection.message = 'Signing in…'
  const { data, error } = await client.auth.signInWithPassword({ email, password })
  if (error) {
    databaseConnection.status = 'unauthenticated'
    databaseConnection.message = 'Admin sign-in required'
    throw error
  }
  if (!data.user) throw new Error('Supabase did not return an authenticated user')

  try {
    await connectUser(data.user)
  } catch (error) {
    databaseConnection.status = 'error'
    databaseConnection.message = `Supabase unavailable (${errorMessage(error)})`
    throw error
  }
}

export async function signOutAdmin(): Promise<void> {
  for (const timer of writeTimers.values()) clearTimeout(timer)
  writeTimers.clear()
  pendingWrites.clear()
  if (client && channel) await client.removeChannel(channel)
  channel = null
  if (client) await client.auth.signOut()
  userId = null
  databaseUser.id = null
  databaseUser.email = null
  Object.keys(localStorage)
    .filter((key) => key.startsWith('shift-scheduler:v1:'))
    .forEach((key) => localStorage.removeItem(key))
  window.location.assign('/')
}
