/**
 * useAppData — one AppData snapshot kept fresh by the server's SSE stream.
 *
 * The old TUI ran its own chokidar watcher plus a user-configured repaint interval. The server
 * already pushes on `/api/events` (the same stream the browser dashboard listens to), so the
 * terminal now updates at the same instant the web UI does, and the interval question is gone.
 *
 * A poll is kept ONLY as the fallback for a server too old to serve the stream, or a stream that
 * cannot be established — never as the primary path.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { AppData } from '@agentistics/core'

export type ConnectionState = 'connecting' | 'live' | 'polling' | 'offline'

const POLL_FALLBACK_MS = 10_000

export interface AppDataResult {
  data: AppData | null
  error: string | null
  connection: ConnectionState
  refresh: () => void
}

export function useAppData(apiBase: string): AppDataResult {
  const [data, setData] = useState<AppData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [connection, setConnection] = useState<ConnectionState>('connecting')
  const alive = useRef(true)

  const fetchOnce = useCallback(async () => {
    try {
      const res = await fetch(`${apiBase}/api/data`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = (await res.json()) as AppData
      if (!alive.current) return
      setData(json)
      setError(null)
    } catch (e) {
      if (!alive.current) return
      setError(e instanceof Error ? e.message : String(e))
      setConnection('offline')
    }
  }, [apiBase])

  useEffect(() => {
    alive.current = true
    void fetchOnce()
    return () => { alive.current = false }
  }, [fetchOnce])

  // SSE subscription, with a poll fallback if the stream never opens.
  useEffect(() => {
    let poll: ReturnType<typeof setInterval> | undefined
    const controller = new AbortController()

    const startPolling = () => {
      if (poll) return
      setConnection(prev => (prev === 'offline' ? prev : 'polling'))
      poll = setInterval(() => { void fetchOnce() }, POLL_FALLBACK_MS)
    }

    const run = async () => {
      try {
        const res = await fetch(`${apiBase}/api/events`, {
          headers: { accept: 'text/event-stream' },
          signal: controller.signal,
        })
        if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)
        setConnection('live')

        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        while (alive.current) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          // Any event at all means the dataset moved; refetch the snapshot.
          if (buffer.includes('\n\n')) {
            buffer = ''
            void fetchOnce()
          }
        }
        if (alive.current) startPolling()
      } catch {
        if (alive.current) startPolling()
      }
    }

    void run()
    return () => {
      controller.abort()
      if (poll) clearInterval(poll)
    }
  }, [apiBase, fetchOnce])

  return { data, error, connection, refresh: () => { void fetchOnce() } }
}
