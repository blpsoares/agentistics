// ── Chat notification sounds ─────────────────────────────────────────────────
// All sounds are synthesized via Web Audio API — no audio files needed.

export interface ChatSound {
  id: string
  label: { en: string; pt: string }
  play(ctx: AudioContext): void
}

export const CHAT_SOUNDS: ChatSound[] = [
  {
    id: 'ping',
    label: { en: 'Ping', pt: 'Ping' },
    play(ctx) {
      // Short high sine wave — the original default
      ctx.resume().then(() => {
        const now = ctx.currentTime
        const playTone = (freq: number, start: number, dur: number) => {
          const osc = ctx.createOscillator()
          const gain = ctx.createGain()
          osc.connect(gain)
          gain.connect(ctx.destination)
          osc.type = 'sine'
          osc.frequency.value = freq
          gain.gain.setValueAtTime(0, start)
          gain.gain.linearRampToValueAtTime(0.18, start + 0.02)
          gain.gain.exponentialRampToValueAtTime(0.001, start + dur)
          osc.start(start)
          osc.stop(start + dur)
        }
        playTone(880,  now,        0.25)
        playTone(1100, now + 0.12, 0.25)
      }).catch(() => { /* ignore */ })
    },
  },
  {
    id: 'chime',
    label: { en: 'Chime', pt: 'Chime' },
    play(ctx) {
      // Two-tone ascending ding
      ctx.resume().then(() => {
        const now = ctx.currentTime
        const playTone = (freq: number, start: number, dur: number, vol = 0.2) => {
          const osc = ctx.createOscillator()
          const gain = ctx.createGain()
          osc.connect(gain)
          gain.connect(ctx.destination)
          osc.type = 'sine'
          osc.frequency.value = freq
          gain.gain.setValueAtTime(0, start)
          gain.gain.linearRampToValueAtTime(vol, start + 0.01)
          gain.gain.exponentialRampToValueAtTime(0.001, start + dur)
          osc.start(start)
          osc.stop(start + dur)
        }
        // Ascending: C5 → E5 → G5
        playTone(523.25, now,        0.3,  0.15)
        playTone(659.25, now + 0.14, 0.3,  0.18)
        playTone(783.99, now + 0.28, 0.45, 0.22)
      }).catch(() => { /* ignore */ })
    },
  },
  {
    id: 'soft',
    label: { en: 'Soft', pt: 'Suave' },
    play(ctx) {
      // Gentle low-frequency warm tone
      ctx.resume().then(() => {
        const now = ctx.currentTime
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()
        osc.connect(gain)
        gain.connect(ctx.destination)
        osc.type = 'sine'
        osc.frequency.value = 330
        gain.gain.setValueAtTime(0, now)
        gain.gain.linearRampToValueAtTime(0.15, now + 0.05)
        gain.gain.linearRampToValueAtTime(0.12, now + 0.2)
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.7)
        osc.start(now)
        osc.stop(now + 0.7)
      }).catch(() => { /* ignore */ })
    },
  },
  {
    id: 'bell',
    label: { en: 'Bell', pt: 'Sino' },
    play(ctx) {
      // Decaying bell-like tone using two oscillators (fundamental + overtone)
      ctx.resume().then(() => {
        const now = ctx.currentTime
        const playPartial = (freq: number, vol: number, decay: number) => {
          const osc = ctx.createOscillator()
          const gain = ctx.createGain()
          osc.connect(gain)
          gain.connect(ctx.destination)
          osc.type = 'sine'
          osc.frequency.value = freq
          gain.gain.setValueAtTime(vol, now)
          gain.gain.exponentialRampToValueAtTime(0.001, now + decay)
          osc.start(now)
          osc.stop(now + decay)
        }
        playPartial(660,  0.22, 1.2)   // fundamental
        playPartial(1320, 0.10, 0.6)   // octave overtone
        playPartial(1980, 0.05, 0.3)   // second overtone
      }).catch(() => { /* ignore */ })
    },
  },
  {
    id: 'pop',
    label: { en: 'Pop', pt: 'Pop' },
    play(ctx) {
      // Short click/pop sound via noise burst
      ctx.resume().then(() => {
        const now = ctx.currentTime
        const bufSize = ctx.sampleRate * 0.05
        const buffer = ctx.createBuffer(1, bufSize, ctx.sampleRate)
        const data = buffer.getChannelData(0)
        for (let i = 0; i < bufSize; i++) {
          data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / bufSize, 6)
        }
        const source = ctx.createBufferSource()
        source.buffer = buffer
        const gain = ctx.createGain()
        source.connect(gain)
        gain.connect(ctx.destination)
        gain.gain.setValueAtTime(0.35, now)
        source.start(now)
      }).catch(() => { /* ignore */ })
    },
  },
]

export const DEFAULT_CHAT_SOUND_ID = 'ping'

export function findChatSound(id: string): ChatSound {
  return CHAT_SOUNDS.find(s => s.id === id) ?? CHAT_SOUNDS[0]!
}
