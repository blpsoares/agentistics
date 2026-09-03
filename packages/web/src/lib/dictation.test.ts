import { describe, it, expect } from 'bun:test'
import { dictationSupport, dictationLocale } from './dictation'

describe('dictationSupport', () => {
  it('is ready when the API exists in a secure context', () => {
    expect(dictationSupport({ SpeechRecognition: class {}, isSecureContext: true }, 'en'))
      .toEqual({ state: 'ready', reason: null })
    expect(dictationSupport({ webkitSpeechRecognition: class {}, isSecureContext: true }, 'en').state)
      .toBe('ready')
  })

  it('says so IN WORDS when the browser has no such API', () => {
    // A mic button that fails on click is indistinguishable from a broken one.
    const s = dictationSupport({ isSecureContext: true }, 'en')
    expect(s.state).toBe('no-api')
    expect(s.reason).toMatch(/does not do dictation/)
  })

  it('names HTTPS only when the API is actually there', () => {
    // A browser without the API will not gain it over HTTPS; naming the protocol there sends
    // someone to fix the wrong thing.
    expect(dictationSupport({ isSecureContext: false }, 'en').state).toBe('no-api')
    expect(dictationSupport({ SpeechRecognition: class {}, isSecureContext: false }, 'en').state).toBe('insecure')
  })

  it('treats an ABSENT isSecureContext as secure — only an explicit false blocks', () => {
    // An older browser that does not expose the flag but does expose the API still works; refusing
    // there would withhold a feature that functions.
    expect(dictationSupport({ SpeechRecognition: class {} }, 'en').state).toBe('ready')
  })

  it('survives having no window at all', () => {
    expect(dictationSupport(undefined, 'en').state).toBe('no-api')
  })

  it('every refusal has real text in both languages', () => {
    for (const lang of ['en', 'pt'] as const) {
      for (const win of [undefined, { SpeechRecognition: class {}, isSecureContext: false }]) {
        const s = dictationSupport(win, lang)
        expect(s.reason!.length).toBeGreaterThan(10)
      }
    }
    expect(dictationSupport(undefined, 'pt').reason).not.toBe(dictationSupport(undefined, 'en').reason)
  })
})

describe('dictationLocale', () => {
  it('listens in the UI language, not a guess at the machine locale', () => {
    // A Brazilian laptop is often set to English; what matters is the language being typed.
    expect(dictationLocale('pt')).toBe('pt-BR')
    expect(dictationLocale('en')).toBe('en-US')
  })
})
