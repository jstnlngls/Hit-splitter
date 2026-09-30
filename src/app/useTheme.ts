import { useEffect, useState } from 'react'

export type ThemePreference = 'system' | 'light' | 'dark'

const KEY = 'hit-splitter.theme.v1'

/** The writer's theme choice, applied as data-theme on <html> (system = no attribute). */
export function useThemePreference(enabled: boolean) {
  const [preference, setPreference] = useState<ThemePreference>(() => {
    try {
      const saved = localStorage.getItem(KEY)
      return saved === 'light' || saved === 'dark' ? saved : 'system'
    } catch {
      return 'system'
    }
  })
  useEffect(() => {
    if (!enabled) return
    const root = document.documentElement
    if (preference === 'system') delete root.dataset.theme
    else root.dataset.theme = preference
    try {
      localStorage.setItem(KEY, preference)
    } catch {
      // Storage blocked: the choice lasts for this visit.
    }
  }, [preference, enabled])
  return [preference, setPreference] as const
}

/** Changes whenever the effective theme may have changed, so canvases can repaint. */
export function useThemeVersion(): number {
  const [version, setVersion] = useState(0)
  useEffect(() => {
    const bump = () => setVersion((v) => v + 1)
    const query = matchMedia('(prefers-color-scheme: dark)')
    query.addEventListener('change', bump)
    const observer = new MutationObserver(bump)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => {
      query.removeEventListener('change', bump)
      observer.disconnect()
    }
  }, [])
  return version
}
