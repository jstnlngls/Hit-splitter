import { useEffect, useRef, useState } from 'react'
import type { ThemePreference } from '../app/useTheme'
import type { Song } from '../lib/store/songs'
import { Icon } from './Icon'

interface HeaderProps {
  song: Song
  songs: Song[]
  onTitle(title: string): void
  onSelect(id: string): void
  onNew(): void
  onDuplicate(): void
  onDelete(): void
  onImportBackup(file: File): void
  onDownloadBackup: (() => void) | null
  onCopyLyrics(): void
  theme: ThemePreference | null
  onTheme(theme: ThemePreference): void
}

const NEXT_THEME: Record<ThemePreference, ThemePreference> = { system: 'light', light: 'dark', dark: 'system' }

export function Header(props: HeaderProps) {
  const { song, songs, theme } = props
  const [open, setOpen] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const menu = useRef<HTMLDivElement>(null)
  const backupInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (!menu.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  useEffect(() => {
    if (!open) setConfirming(false)
  }, [open])

  const act = (fn: () => void) => () => {
    fn()
    setOpen(false)
  }

  return (
    <div className="header-row">
      <div className="brand" aria-label="Hit Splitter">
        <span className="brand-mark" aria-hidden="true">
          <i />
          <i />
          <i />
          <i />
        </span>
        <span className="brand-name">Hit Splitter</span>
      </div>
      <label className="sr-only" htmlFor="song-title">
        Song title
      </label>
      <input id="song-title" className="song-title" value={song.title} onChange={(e) => props.onTitle(e.target.value)} placeholder="Untitled" />
      <div className="header-actions">
        <div className="menu" ref={menu}>
          <button type="button" className="btn" aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen((o) => !o)}>
            <Icon name="menu" /> Songs
          </button>
          {open && (
            <div className="menu-panel" role="menu">
              {songs.map((s) => (
                <button type="button" role="menuitem" key={s.id} className={s.id === song.id ? 'menu-song is-current' : 'menu-song'} onClick={act(() => props.onSelect(s.id))}>
                  <span>{s.title || 'Untitled'}</span>
                  <small>{new Date(s.updatedAt).toLocaleDateString()}</small>
                </button>
              ))}
              <hr />
              <button type="button" role="menuitem" onClick={act(props.onNew)}>
                <Icon name="plus" /> New song
              </button>
              <button type="button" role="menuitem" onClick={act(props.onDuplicate)}>
                <Icon name="copy" /> Duplicate this song
              </button>
              <button type="button" role="menuitem" onClick={act(props.onCopyLyrics)}>
                <Icon name="file" /> Copy lyrics
              </button>
              {props.onDownloadBackup && (
                <button type="button" role="menuitem" onClick={act(props.onDownloadBackup)}>
                  <Icon name="download" /> Download backup (.json)
                </button>
              )}
              <button type="button" role="menuitem" onClick={() => backupInput.current?.click()}>
                <Icon name="upload" /> Open a backup…
              </button>
              <input
                ref={backupInput}
                id="backup-file"
                type="file"
                accept="application/json,.json"
                className="sr-only"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) props.onImportBackup(file)
                  e.target.value = ''
                  setOpen(false)
                }}
              />
              <hr />
              {confirming ? (
                <div className="confirm">
                  <span>Delete “{song.title || 'Untitled'}” and its highlights? This can’t be undone.</span>
                  <span className="confirm-actions">
                    <button type="button" className="btn btn-small btn-primary" onClick={act(props.onDelete)}>
                      Delete song
                    </button>
                    <button type="button" className="btn btn-small" onClick={() => setConfirming(false)}>
                      Keep it
                    </button>
                  </span>
                </div>
              ) : (
                <button type="button" role="menuitem" onClick={() => setConfirming(true)}>
                  <Icon name="trash" /> Delete this song…
                </button>
              )}
            </div>
          )}
        </div>
        {theme && (
          <button type="button" className="btn btn-ghost btn-icon" onClick={() => props.onTheme(NEXT_THEME[theme])} title={`Theme: ${theme}`} aria-label={`Theme: ${theme}. Switch theme`}>
            <Icon name={theme === 'dark' ? 'moon' : theme === 'light' ? 'sun' : 'contrast'} />
          </button>
        )}
      </div>
    </div>
  )
}
