import { audioContext } from './decode'
import { click, hat, kick, snare, voice, type VoiceNote } from './synth'

export type PlayEvent =
  | { time: number; type: 'kick' | 'snare' | 'hat'; level: number }
  | { time: number; type: 'click'; accent: boolean }
  | ({ time: number; type: 'voice' } & VoiceNote)

export interface Mix {
  track: number
  drums: number
  click: number
  voice: number
}

export interface PlayRequest {
  /** Timeline seconds to start from. The timeline is the track's own clock. */
  from: number
  /** Where to stop, or where to jump back to `loopStart` when looping. */
  to: number
  loopStart?: number
  loop: boolean
  /** All events, sorted by time. */
  events: PlayEvent[]
  track: AudioBuffer | null
  mix: Mix
}

const LOOKAHEAD = 0.15
const TICK_MS = 25

/**
 * A lookahead scheduler over Web Audio: a timer queues events a little ahead
 * of the audio clock so timing stays sample-accurate even when the page is busy.
 */
export class Player {
  private request: PlayRequest | null = null
  private timer: ReturnType<typeof setInterval> | null = null
  /** Audio-clock time and timeline position each loop pass started at. */
  private passes: { at: number; from: number }[] = []
  private cursor = 0
  private eventIndex = 0
  private sources: AudioBufferSourceNode[] = []
  private buses: { track: GainNode; drums: GainNode; click: GainNode; voice: GainNode } | null = null
  private endTimer: ReturnType<typeof setTimeout> | null = null
  onEnded: (() => void) | null = null

  get playing() {
    return this.request !== null
  }

  private ensureBuses(ctx: AudioContext) {
    if (this.buses) return this.buses
    const master = ctx.createDynamicsCompressor()
    master.threshold.value = -10
    master.connect(ctx.destination)
    const bus = () => {
      const g = ctx.createGain()
      g.connect(master)
      return g
    }
    this.buses = { track: bus(), drums: bus(), click: bus(), voice: bus() }
    return this.buses
  }

  setMix(mix: Mix) {
    if (!this.buses) return
    const ctx = audioContext()
    for (const key of ['track', 'drums', 'click', 'voice'] as const) {
      this.buses[key].gain.setTargetAtTime(mix[key], ctx.currentTime, 0.02)
    }
    if (this.request) this.request.mix = mix
  }

  async start(request: PlayRequest) {
    this.stop()
    const ctx = audioContext()
    if (ctx.state !== 'running') await ctx.resume()
    const buses = this.ensureBuses(ctx)
    this.request = request
    this.setMix(request.mix)
    const at = ctx.currentTime + 0.06
    this.passes = [{ at, from: request.from }]
    this.cursor = request.from
    this.eventIndex = request.events.findIndex((e) => e.time >= request.from)
    if (this.eventIndex < 0) this.eventIndex = request.events.length
    this.startTrack(ctx, buses.track, at, request.from)
    this.timer = setInterval(() => this.tick(), TICK_MS)
    this.tick()
  }

  stop() {
    if (this.timer) clearInterval(this.timer)
    if (this.endTimer) clearTimeout(this.endTimer)
    this.timer = null
    this.endTimer = null
    for (const source of this.sources) {
      try {
        source.stop()
      } catch {
        // Already stopped.
      }
    }
    this.sources = []
    this.request = null
    this.passes = []
  }

  /** The timeline position being heard right now, or null when stopped. */
  position(): number | null {
    if (!this.request) return null
    const now = audioContext().currentTime
    let pass = this.passes[0]
    for (const p of this.passes) if (p.at <= now) pass = p
    return pass.from + Math.max(0, now - pass.at)
  }

  private startTrack(ctx: AudioContext, bus: AudioNode, at: number, from: number) {
    const buffer = this.request?.track
    if (!buffer) return
    const offset = Math.max(0, from)
    const delay = from < 0 ? -from : 0
    if (offset >= buffer.duration) return
    const source = ctx.createBufferSource()
    source.buffer = buffer
    source.connect(bus)
    source.start(at + delay, offset)
    this.sources.push(source)
  }

  private tick() {
    const request = this.request
    if (!request) return
    const ctx = audioContext()
    const buses = this.buses!
    const pass = this.passes[this.passes.length - 1]
    const horizon = pass.from + (ctx.currentTime + LOOKAHEAD - pass.at)

    const scheduleUntil = Math.min(horizon, request.to)
    const events = request.events
    while (this.eventIndex < events.length && events[this.eventIndex].time < scheduleUntil) {
      const event = events[this.eventIndex++]
      if (event.time < this.cursor) continue
      const when = pass.at + (event.time - pass.from)
      if (when < ctx.currentTime - 0.01) continue
      this.play(ctx, buses, event, when)
    }
    this.cursor = scheduleUntil

    if (horizon >= request.to) {
      const boundary = pass.at + (request.to - pass.from)
      if (request.loop) {
        const loopStart = request.loopStart ?? request.from
        for (const source of this.sources) source.stop(boundary)
        this.sources = []
        this.passes.push({ at: boundary, from: loopStart })
        if (this.passes.length > 4) this.passes.shift()
        this.cursor = loopStart
        this.eventIndex = events.findIndex((e) => e.time >= loopStart)
        if (this.eventIndex < 0) this.eventIndex = events.length
        this.startTrack(ctx, buses.track, boundary, loopStart)
      } else if (!this.endTimer) {
        if (this.timer) clearInterval(this.timer)
        this.timer = null
        this.endTimer = setTimeout(() => {
          this.stop()
          this.onEnded?.()
        }, Math.max(0, (boundary - ctx.currentTime) * 1000))
      }
    }
  }

  private play(ctx: AudioContext, buses: NonNullable<Player['buses']>, event: PlayEvent, when: number) {
    switch (event.type) {
      case 'kick':
        return kick(ctx, buses.drums, when, event.level)
      case 'snare':
        return snare(ctx, buses.drums, when, event.level)
      case 'hat':
        return hat(ctx, buses.drums, when, event.level)
      case 'click':
        return click(ctx, buses.click, when, event.accent)
      case 'voice':
        return voice(ctx, buses.voice, when, event)
    }
  }
}
