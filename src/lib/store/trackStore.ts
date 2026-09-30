import type { AudioFeatures } from '../audio/analysis'

/** Imported audio lives in IndexedDB so it survives reloads; everything else is in localStorage. */

export interface StoredTrack {
  blob: Blob
  features: AudioFeatures | null
}

const DB_NAME = 'hit-splitter'
const STORE = 'tracks'

let dbPromise: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
  dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  }).catch((error) => {
    dbPromise = null
    throw error
  })
  return dbPromise
}

async function run<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await openDb()
  return new Promise<T>((resolve, reject) => {
    const request = action(db.transaction(STORE, mode).objectStore(STORE))
    request.onsuccess = () => resolve(request.result as T)
    request.onerror = () => reject(request.error)
  })
}

export async function saveTrack(songId: string, track: StoredTrack): Promise<boolean> {
  try {
    await run('readwrite', (store) => store.put(track, songId))
    return true
  } catch {
    return false
  }
}

export async function loadTrack(songId: string): Promise<StoredTrack | null> {
  try {
    return (await run<StoredTrack | undefined>('readonly', (store) => store.get(songId))) ?? null
  } catch {
    return null
  }
}

export async function deleteTrack(songId: string): Promise<void> {
  try {
    await run('readwrite', (store) => store.delete(songId))
  } catch {
    // Nothing stored or storage unavailable: nothing to remove.
  }
}
