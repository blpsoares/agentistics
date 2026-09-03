/**
 * dictation.ts — PURE: can this browser take dictation, and what does the button say when it cannot?
 *
 * The Web Speech API is the only way to do this without shipping a model or sending audio to a
 * server, and it is NOT universally available: Firefox does not implement it, and every browser
 * that does requires a secure context — so `http://` over a LAN, which is exactly how a member
 * machine's dashboard is usually reached, has no microphone at all.
 *
 * That makes this a capability question, and the rule is the one `HARNESS_CAPABILITIES` states: an
 * absent feature is said in WORDS, never rendered as a control that silently does nothing. A mic
 * button that fails on click is indistinguishable from a broken one.
 *
 * Note what this deliberately does NOT do: no audio is uploaded anywhere by this product. The
 * recognition runs in the browser, and what reaches the session is the TEXT the user then chooses
 * to send — the same text they could have typed.
 */

export type DictationState = 'ready' | 'no-api' | 'insecure'

export interface DictationSupport {
  state: DictationState
  /** Already-worded reason, or null when dictation is available. */
  reason: string | null
}

/**
 * `win` is threaded in rather than read from the global so the decision is testable — there is no
 * `window` in the test runner, and a rule that can only be exercised by opening a browser is a rule
 * nothing checks.
 */
export function dictationSupport(
  win: { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown; isSecureContext?: boolean } | undefined,
  lang: 'en' | 'pt',
): DictationSupport {
  const pt = lang === 'pt'
  const hasApi = !!win && (typeof win.SpeechRecognition !== 'undefined' || typeof win.webkitSpeechRecognition !== 'undefined')
  if (!hasApi) {
    return {
      state: 'no-api',
      reason: pt
        ? 'Este navegador não faz ditado. Chrome e Edge fazem.'
        : 'This browser does not do dictation. Chrome and Edge do.',
    }
  }
  // Checked SECOND, and only when the API exists: a browser without the API is not going to gain
  // it over HTTPS, so naming the protocol there would send someone to fix the wrong thing.
  if (win?.isSecureContext === false) {
    return {
      state: 'insecure',
      reason: pt
        ? 'O microfone exige HTTPS ou localhost. Esta página está em HTTP.'
        : 'The microphone needs HTTPS or localhost. This page is on plain HTTP.',
    }
  }
  return { state: 'ready', reason: null }
}

/** The BCP-47 tag the recogniser listens in — the UI language, because that is what the user types
 *  in. Not a guess at the machine's locale, which is often English on a Brazilian laptop. */
export function dictationLocale(lang: 'en' | 'pt'): string {
  return lang === 'pt' ? 'pt-BR' : 'en-US'
}
