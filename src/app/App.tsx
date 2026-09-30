import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Editor, type EditorHandle } from '../components/Editor'
import { Favorites } from '../components/Favorites'
import { FlowView } from '../components/FlowView'
import { Header } from '../components/Header'
import { Icon } from '../components/Icon'
import { RhymeView } from '../components/RhymeView'
import { TrackView } from '../components/TrackView'
import { Transport, type PlayToggles } from '../components/Transport'
import type { Mix } from '../lib/audio/player'
import { BUILT_IN_FLOWS, flowsFromTrack } from '../lib/flow/templates'
import { barSeconds, barStartTime, buildEvents, DEFAULT_DRUMS, type Timeline } from '../lib/playback/timeline'
import { diffText, mapRange, remapLineRecord } from '../lib/store/edits'
import { HIGHLIGHT_KINDS } from '../lib/store/highlights'
import { createSong, exportSong, importSong, newId, type Highlight, type LineSetting, type Song } from '../lib/store/songs'
import { deleteTrack } from '../lib/store/trackStore'
import { useBarViews, useLexicon, useLyricsAnalysis } from './useAnalysis'
import { usePlayback } from './usePlayback'
import { useThemePreference } from './useTheme'
import { useSongs } from './useSongs'
import { useTrack } from './useTrack'

type Pane = 'flow' | 'rhymes' | 'track'
type View = 'write' | Pane

/** The published preview runs inside a viewer that owns the theme and blocks downloads. */
const STANDALONE = import.meta.env.VITE_TARGET !== 'artifact'

const PANES: { id: Pane; label: string }[] = [
  { id: 'flow', label: 'Flow' },
  { id: 'rhymes', label: 'Rhymes' },
  { id: 'track', label: 'Track' },
]

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))

/** Offset of the end of a line in the text. */
const lineEnd = (text: string, line: number) => {
  const lines = text.split('\n')
  let offset = 0
  for (let i = 0; i < line && i < lines.length; i++) offset += lines[i].length + 1
  return offset + (lines[line]?.length ?? 0)
}

export function App() {
  const { songs, song, updateSong, selectSong, addSong, removeSong, saveFailed } = useSongs()
  const { lexicon, failed: dictionaryFailed } = useLexicon()
  const [theme, setTheme] = useThemePreference(STANDALONE)
  const [view, setView] = useState<View>('write')
  const [pane, setPane] = useState<Pane>('flow')
  const [activeLine, setActiveLine] = useState(1)
  const [showRhymes, setShowRhymes] = useState(true)
  const [toggles, setToggles] = useState<PlayToggles>({ beat: true, voice: true, click: false, loop: false, follow: true })
  const [toast, setToast] = useState<string | null>(null)
  const editor = useRef<EditorHandle>(null)
  const lyricsRef = useRef(song.lyrics)
  useEffect(() => {
    lyricsRef.current = song.lyrics
  }, [song.lyrics])

  const analysis = useLyricsAnalysis(song.lyrics, lexicon, 4)
  const trackFlows = useMemo(() => (song.track ? flowsFromTrack(song.track.patterns) : []), [song.track])
  const flows = useMemo(() => [...BUILT_IN_FLOWS, ...trackFlows], [trackFlows])
  const barViews = useBarViews(analysis, song, flows)
  const track = useTrack(song, updateSong)

  const timeline: Timeline = useMemo(
    () => ({ bpm: song.bpm, firstDownbeat: song.track?.firstDownbeat ?? 0, startBar: song.track ? song.startBar : 1 }),
    [song.bpm, song.track, song.startBar],
  )
  const { playing, playhead, play, stop, setMix } = usePlayback(timeline)

  const mix: Mix = useMemo(
    () => ({ track: toggles.beat ? 0.9 : 0, drums: toggles.beat ? 0.75 : 0, click: toggles.click ? 0.7 : 0, voice: toggles.voice ? 0.7 : 0 }),
    [toggles],
  )
  useEffect(() => setMix(mix), [mix, setMix])
  useEffect(() => stop(), [song.id, stop])

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), 2600)
    return () => clearTimeout(timer)
  }, [toast])

  const { lyrics } = analysis
  const activeBar = lyrics.lineToBar[activeLine] ?? -1

  // ---- Lyrics, highlights, per-line settings ----

  const onText = useCallback(
    (next: string) =>
      updateSong(song.id, (s) => {
        const edit = diffText(s.lyrics, next)
        if (!edit) return s
        return {
          ...s,
          lyrics: next,
          highlights: s.highlights.map((h) => mapRange(h, edit)).filter((h): h is Highlight => h !== null),
          lineSettings: remapLineRecord(s.lineSettings, s.lyrics, next),
        }
      }),
    [song.id, updateSong],
  )

  const onHighlights = useCallback((list: Highlight[]) => updateSong(song.id, (s) => ({ ...s, highlights: list })), [song.id, updateSong])

  const setLineSetting = useCallback(
    (line: number, change: (setting: LineSetting) => LineSetting) =>
      updateSong(song.id, (s) => {
        const next = change({ ...s.lineSettings[line] })
        const settings = { ...s.lineSettings }
        if (next.flow === undefined && !next.shift) delete settings[line]
        else settings[line] = next
        return { ...s, lineSettings: settings }
      }),
    [song.id, updateSong],
  )

  const onLineFlow = useCallback(
    (line: number, flow: string | null | undefined) =>
      setLineSetting(line, (setting) => {
        const { flow: _previous, ...rest } = setting
        return flow === undefined ? rest : { ...rest, flow }
      }),
    [setLineSetting],
  )

  const onLineShift = useCallback(
    (line: number, shift: number) => setLineSetting(line, (setting) => ({ ...setting, shift: Math.max(-8, Math.min(12, shift)) })),
    [setLineSetting],
  )

  const selectLine = useCallback((line: number) => {
    setActiveLine(line)
    // On phones, focusing the editor would pop up the keyboard over the view.
    if (matchMedia('(min-width: 1000px)').matches) {
      const end = lineEnd(lyricsRef.current, line)
      editor.current?.select(end, end)
    }
  }, [])

  // ---- Playback ----

  const startPlayback = useCallback(
    (fromBar: number, loop: boolean) => {
      const total = lyrics.bars.length
      const toBar = loop ? fromBar + 1 : Math.max(total, fromBar + 1)
      const drums = track.buffer ? null : (song.track?.patterns.drumPattern ?? DEFAULT_DRUMS)
      const bars = barViews.map((v) => ({ grid: v.grid, placement: v.placement }))
      void play({
        fromBar,
        toBar,
        loop,
        countIn: loop ? 0 : 1,
        events: (a, b) => buildEvents(timeline, bars, lyrics, analysis.rhymes, a, b, { drums, metronome: true, voice: true }),
        track: track.buffer,
        mix,
      })
    },
    [lyrics, barViews, timeline, analysis.rhymes, track.buffer, song.track, play, mix],
  )

  const firstBarFrom = (line: number) => {
    for (let l = line; l < lyrics.lineToBar.length; l++) if (lyrics.lineToBar[l] >= 0) return lyrics.lineToBar[l]
    return 0
  }

  const togglePlay = () => {
    if (playing) return stop()
    if (!lyrics.bars.length && !song.track) {
      setToast('Write a line first — play sings it over the beat.')
      return
    }
    startPlayback(firstBarFrom(activeLine), toggles.loop)
  }

  const togglePlayRef = useRef(togglePlay)
  useEffect(() => {
    togglePlayRef.current = togglePlay
  })

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !isTyping(e.target)) {
        e.preventDefault()
        togglePlayRef.current()
      } else if (e.key === 'Escape' && playing) {
        stop()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [playing, stop])

  const positionLabel = playhead
    ? playhead.bar < 0
      ? 'Count-in…'
      : `Bar ${playhead.bar + 1} · beat ${Math.min(4, Math.floor(playhead.progress * 4) + 1)}`
    : activeBar >= 0
      ? `Bar ${activeBar + 1} of ${lyrics.bars.length}`
      : `${lyrics.bars.length} bars`

  const playTime = playhead && song.track ? barStartTime(timeline, playhead.bar) + playhead.progress * barSeconds(timeline.bpm) : null

  // ---- Songs ----

  const updateCurrent = (change: (s: Song) => Song) => updateSong(song.id, change)

  const downloadBackup = () => {
    const blob = new Blob([exportSong(song)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${(song.title || 'lyrics').replace(/[^\w\- ]+/g, '').trim() || 'lyrics'}.hit-splitter.json`
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  const copyLyrics = () => {
    if (!navigator.clipboard) {
      setToast('Copying isn’t available here. Select the lyrics and copy them yourself.')
      return
    }
    navigator.clipboard.writeText(song.lyrics).then(
      () => setToast('Lyrics copied'),
      () => setToast('Copying was blocked here. Select the lyrics and copy them yourself.'),
    )
  }

  const guessed = useMemo(() => [...new Set(lyrics.words.filter((w) => w.source === 'guess').map((w) => w.norm))], [lyrics])

  const paneContent = (id: Pane) => {
    if (id === 'flow') {
      return (
        <>
          <div className="flow-legend" style={{ marginBottom: 10 }}>
            <span className="legend-chip">
              <span className="swatch" style={{ background: 'var(--beat-1)' }} />
              <span className="swatch" style={{ background: 'var(--beat-2)' }} />
              <span className="swatch" style={{ background: 'var(--beat-3)' }} />
              <span className="swatch" style={{ background: 'var(--beat-4)' }} />
              beats 1–4
            </span>
            <span className="legend-chip">● stressed syllable</span>
            <span className="legend-chip">
              <span className="swatch" style={{ background: 'var(--cell-room)', borderStyle: 'dashed' }} /> open slot in the flow
            </span>
            <span className="legend-chip">color = rhyme sound</span>
          </div>
          <FlowView
            analysis={analysis}
            barViews={barViews}
            highlights={song.highlights}
            flows={flows}
            activeLine={activeLine}
            playhead={playhead}
            follow={toggles.follow}
            onSelectLine={selectLine}
            onLineFlow={onLineFlow}
            onLineShift={onLineShift}
          />
        </>
      )
    }
    if (id === 'rhymes') return <RhymeView analysis={analysis} activeLine={activeLine} onSelectLine={selectLine} />
    return (
      <TrackView
        song={song}
        status={track.status}
        lyricBars={lyrics.bars.length}
        activeLine={activeLine}
        trackFlows={trackFlows}
        playTime={playTime}
        onImport={(file) => {
          stop()
          void track.importFile(file)
        }}
        onRemove={() => {
          stop()
          track.removeTrack()
        }}
        onTempo={(bpm, refine) => {
          stop()
          track.setTempo(bpm, refine)
        }}
        onShiftDownbeat={(beats) => {
          stop()
          track.shiftDownbeat(beats)
        }}
        onStartBar={(bar) => updateCurrent((s) => ({ ...s, startBar: bar }))}
        onSongFlow={(flow) => updateCurrent((s) => ({ ...s, flow }))}
        onLineFlow={(flow) => {
          if (activeBar < 0) setToast('Put the cursor on a lyric line first.')
          else onLineFlow(activeLine, flow)
        }}
        onPlayFrom={(bar) => startPlayback(bar, false)}
      />
    )
  }

  return (
    <>
      <header className="app-header">
        <Header
          song={song}
          songs={songs}
          onTitle={(title) => updateCurrent((s) => ({ ...s, title }))}
          onSelect={selectSong}
          onNew={() => addSong(createSong('Untitled', '[Verse 1]\n'))}
          onDuplicate={() => addSong({ ...song, id: newId(), title: `${song.title} (copy)`, track: null, createdAt: Date.now(), updatedAt: Date.now() })}
          onDelete={() => {
            stop()
            void deleteTrack(song.id)
            removeSong(song.id)
          }}
          onImportBackup={async (file) => {
            const imported = importSong(await file.text())
            if (imported) {
              addSong({ ...imported, track: null })
              setToast(`Opened “${imported.title}”`)
            } else setToast('That file isn’t a Hit Splitter backup.')
          }}
          onDownloadBackup={STANDALONE ? downloadBackup : null}
          onCopyLyrics={copyLyrics}
          theme={STANDALONE ? theme : null}
          onTheme={setTheme}
        />
        <Transport
          playing={playing}
          onPlay={togglePlay}
          position={positionLabel}
          bpm={song.bpm}
          onBpm={(bpm) => (song.track ? track.setTempo(bpm, false) : updateCurrent((s) => ({ ...s, bpm })))}
          grid={song.grid}
          onGrid={(grid) => updateCurrent((s) => ({ ...s, grid }))}
          flow={song.flow}
          flows={flows}
          onFlow={(flow) => updateCurrent((s) => ({ ...s, flow }))}
          toggles={toggles}
          onToggle={(key) => setToggles((t) => ({ ...t, [key]: !t[key] }))}
          hasTrack={song.track !== null}
        />
      </header>

      <main className="workspace" data-view={view}>
        <section className="pane pane-left" aria-label="Lyrics">
          <div className="pane-head">
            <h2 className="pane-title">Rhyme book</h2>
            <div className="hl-toolbar" role="toolbar" aria-label="Highlighters">
              {HIGHLIGHT_KINDS.map(({ kind, label, key }) => (
                <button type="button" key={kind} className="btn btn-small swatch-btn" onMouseDown={(e) => e.preventDefault()} onClick={() => editor.current?.highlight(kind)} title={`Highlight the selection or current line (Alt+${key})`}>
                  <span className={`swatch swatch-${kind}`} /> {label}
                </button>
              ))}
              <button type="button" className="btn btn-small btn-ghost" onMouseDown={(e) => e.preventDefault()} onClick={() => editor.current?.highlight(null)} title="Erase highlights in the selection (Alt+0)">
                Erase
              </button>
            </div>
          </div>
          <div className="pane-scroll">
            <div className="editor-wrap">
              <Editor
                ref={editor}
                text={song.lyrics}
                onText={onText}
                highlights={song.highlights}
                onHighlights={onHighlights}
                analysis={analysis}
                barViews={barViews}
                activeLine={activeLine}
                onCaretLine={setActiveLine}
                showRhymes={showRhymes}
              />
            </div>
            <div className="editor-foot">
              <label className="toggle">
                <input id="show-rhymes" type="checkbox" checked={showRhymes} onChange={(e) => setShowRhymes(e.target.checked)} />
                Underline rhymes
              </label>
              <span>One line = one bar. [Verse] and [Hook] start sections. (Parentheses) are ad-libs.</span>
            </div>
            <div className="pane-body">
              <h3 className="section-label">Highlights</h3>
              <Favorites
                text={song.lyrics}
                lineToBar={lyrics.lineToBar}
                highlights={song.highlights}
                onJump={(start, end) => {
                  setView('write')
                  requestAnimationFrame(() => editor.current?.select(start, end))
                }}
                onRemove={(id) => onHighlights(song.highlights.filter((h) => h.id !== id))}
              />
            </div>
          </div>
        </section>

        <section className="pane pane-right" aria-label="Rhythm and rhymes">
          <div className="pane-head">
            <div className="tabs" role="tablist">
              {PANES.map((p) => (
                <button type="button" role="tab" key={p.id} className="tab" aria-selected={pane === p.id} onClick={() => setPane(p.id)}>
                  {p.label}
                </button>
              ))}
            </div>
          </div>
          <div className="pane-scroll">
            <div className="pane-body">{paneContent(view === 'write' ? pane : view)}</div>
          </div>
        </section>
      </main>

      <footer className="status-bar">
        <span>
          {lexicon
            ? `Dictionary: ${lexicon.size.toLocaleString()} words`
            : dictionaryFailed
              ? 'Dictionary unavailable — syllables are estimated from spelling'
              : 'Loading the pronunciation dictionary…'}
        </span>
        {guessed.length > 0 && <span title="Not in the dictionary; syllables and sounds are estimated from spelling">Estimated: {guessed.slice(0, 8).join(', ')}{guessed.length > 8 ? '…' : ''}</span>}
        <span>{saveFailed ? 'This browser isn’t saving your work — copy your lyrics somewhere safe' : 'Saved in this browser'}</span>
      </footer>

      <nav className="mobile-tabs" aria-label="Views">
        {(['write', 'flow', 'rhymes', 'track'] as View[]).map((v) => (
          <button type="button" key={v} className="tab" aria-selected={view === v} onClick={() => setView(v)}>
            {v === 'write' ? 'Write' : PANES.find((p) => p.id === v)!.label}
          </button>
        ))}
        <button type="button" className="play-btn" onClick={togglePlay} aria-label={playing ? 'Stop' : 'Play from the current line'}>
          <Icon name={playing ? 'stop' : 'play'} />
        </button>
      </nav>

      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </>
  )
}
