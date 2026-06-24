import { useState, useEffect } from 'react'

/** Static guidance for install / login shown when a harness is not ready. */
export interface ChatDriverSetup {
  /** Shell command to install the CLI (e.g. 'npm i -g @openai/codex'). */
  installCmd?: string
  /** Shell command to authenticate (e.g. 'codex login'). */
  loginCmd?: string
  /** URL to official docs or the product page. */
  docUrl?: string
  /** Extra human-readable note (e.g. eligibility caveat). */
  note?: string
}

export interface ChatDriverModel {
  id: string
  label: string
  badge?: string
  desc?: string
  inputPer1M?: number
  outputPer1M?: number
}

/** Per-harness status entry returned by GET /api/chat-harnesses. */
export interface HarnessChatStatus {
  id: string
  label: string
  /** CLI binary is found on PATH. */
  installed: boolean
  /** Auth/config file is present (best-effort). */
  authReady: boolean
  /** installed && authReady — driver is usable. */
  ready: boolean
  models: ChatDriverModel[]
  defaultModel: string
  setup: ChatDriverSetup
}

export interface UseChatHarnessesResult {
  harnesses: HarnessChatStatus[]
  loading: boolean
}

/**
 * Fetches GET /api/chat-harnesses and returns status for ALL known harnesses,
 * including those that are not installed or not authenticated.
 */
export function useChatHarnesses(): UseChatHarnessesResult {
  const [harnesses, setHarnesses] = useState<HarnessChatStatus[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetch('/api/chat-harnesses')
      .then(r => r.json() as Promise<HarnessChatStatus[]>)
      .then(data => {
        if (!cancelled) {
          setHarnesses(Array.isArray(data) ? data : [])
          setLoading(false)
        }
      })
      .catch(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [])

  return { harnesses, loading }
}

/** Returns the ids of harnesses that are ready (installed + authed). */
export function getReadyHarnessIds(harnesses: HarnessChatStatus[]): string[] {
  return harnesses.filter(h => h.ready).map(h => h.id)
}
