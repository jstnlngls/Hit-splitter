import { useCallback, useEffect, useRef, useState } from 'react'
import { Player, type Mix, type PlayEvent } from '../lib/audio/player'
import { barAt, barSeconds, barStartTime, type Timeline } from '../lib/playback/timeline'

export interface PlayheadState {
  bar: number
  /** 0..1 through the bar. */
  progress: number
}

export interface PlayOptions {
  fromBar: number
  toBar: number
  loop: boolean
  /** Bars of lead-in before `fromBar`. */
  countIn: number
  events: (fromBar: number, toBar: number) => PlayEvent[]
  track: AudioBuffer | null
  mix: Mix
}

export function usePlayback(timeline: Timeline) {
  const player = useRef<Player | null>(null)
  const [playing, setPlaying] = useState(false)
  const [playhead, setPlayhead] = useState<PlayheadState | null>(null)
  const timelineRef = useRef(timeline)
  timelineRef.current = timeline

  const getPlayer = () => {
    if (!player.current) {
      player.current = new Player()
      player.current.onEnded = () => {
        setPlaying(false)
        setPlayhead(null)
      }
    }
    return player.current
  }

  // Follow the audio clock while playing.
  useEffect(() => {
    if (!playing) return
    let frame = 0
    let last = ''
    const loop = () => {
      const time = player.current?.position()
      if (time != null) {
        const { bar, progress } = barAt(timelineRef.current, time)
        const key = `${bar}:${Math.floor(progress * 64)}`
        if (key !== last) {
          last = key
          setPlayhead({ bar, progress })
        }
      }
      frame = requestAnimationFrame(loop)
    }
    frame = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(frame)
  }, [playing])

  useEffect(() => () => player.current?.stop(), [])

  const stop = useCallback(() => {
    player.current?.stop()
    setPlaying(false)
    setPlayhead(null)
  }, [])

  const play = useCallback(async (options: PlayOptions) => {
    const t = timelineRef.current
    const lead = options.countIn * barSeconds(t.bpm)
    // Negative times are fine: the player delays the track until its first sample.
    const from = barStartTime(t, options.fromBar) - lead
    const to = barStartTime(t, options.toBar)
    const events = options.events(options.fromBar - options.countIn, options.toBar)
    try {
      await getPlayer().start({
        from,
        to,
        loop: options.loop,
        loopStart: options.loop ? barStartTime(t, options.fromBar) : undefined,
        events,
        track: options.track,
        mix: options.mix,
      })
      setPlaying(true)
    } catch {
      setPlaying(false)
    }
  }, [])

  const setMix = useCallback((mix: Mix) => player.current?.setMix(mix), [])

  return { playing, playhead, play, stop, setMix }
}
