import { useCallback, useEffect, useState } from 'react'
import { createSong, loadSongs, saveSongs, type Song } from '../lib/store/songs'

export function useSongs() {
  const [state, setState] = useState(loadSongs)
  const [saveFailed, setSaveFailed] = useState(false)
  const { songs, currentId } = state
  const song = songs.find((s) => s.id === currentId) ?? songs[0]

  useEffect(() => {
    const timer = setTimeout(() => setSaveFailed(!saveSongs(songs, currentId)), 400)
    return () => clearTimeout(timer)
  }, [songs, currentId])

  const updateSong = useCallback((id: string, update: (song: Song) => Song) => {
    setState((st) => ({
      ...st,
      songs: st.songs.map((s) => {
        if (s.id !== id) return s
        const next = update(s)
        return next === s ? s : { ...next, updatedAt: Date.now() }
      }),
    }))
  }, [])

  const selectSong = useCallback((id: string) => setState((st) => ({ ...st, currentId: id })), [])

  const addSong = useCallback((next: Song) => setState((st) => ({ songs: [next, ...st.songs], currentId: next.id })), [])

  const removeSong = useCallback((id: string) => {
    setState((st) => {
      const rest = st.songs.filter((s) => s.id !== id)
      if (!rest.length) rest.push(createSong())
      return { songs: rest, currentId: st.currentId === id ? rest[0].id : st.currentId }
    })
  }, [])

  return { songs, song, updateSong, selectSong, addSong, removeSong, saveFailed }
}
