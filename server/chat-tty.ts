import path from 'node:path'

const TTY_CHAT_CWD = path.resolve(import.meta.dir, '../tty-chat-agentistics')

export type ChatMessage = { role: 'user' | 'assistant'; content: string }

export async function streamViaClaude(
  message: string,
  history: ChatMessage[],
  onChunk: (text: string) => void,
  onDone: () => void,
  onError: (err: string) => void,
): Promise<void> {
  const recent = history.filter(h => h.content.trim()).slice(-8)
  let prompt = ''
  for (const h of recent) {
    prompt += `${h.role === 'user' ? 'User' : 'Assistant'}: ${h.content}\n\n`
  }
  prompt += message.length > 0 && recent.length > 0 ? `User: ${message}` : message

  try {
    const proc = Bun.spawn(
      ['claude', '--print', '--output-format', 'stream-json', '--verbose'],
      { stdout: 'pipe', stderr: 'pipe', stdin: 'pipe', cwd: TTY_CHAT_CWD },
    )
    proc.stdin.write(prompt)
    proc.stdin.end()

    const decoder = new TextDecoder()
    let lineBuffer = ''
    let emittedLength = 0
    let gotResult = false

    for await (const raw of proc.stdout as unknown as AsyncIterable<Uint8Array>) {
      lineBuffer += decoder.decode(raw, { stream: true })
      const lines = lineBuffer.split('\n')
      lineBuffer = lines.pop() ?? ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) continue
        try {
          const event = JSON.parse(trimmed) as Record<string, unknown>

          if (event.type === 'assistant') {
            const msg = event.message as { content?: Array<{ type: string; text?: string }> } | undefined
            for (const block of msg?.content ?? []) {
              if (block.type === 'text' && typeof block.text === 'string') {
                const delta = block.text.slice(emittedLength)
                if (delta) { onChunk(delta); emittedLength = block.text.length }
              }
            }
          } else if (event.type === 'result') {
            gotResult = true
            const ev = event as { subtype?: string; error?: unknown }
            if (ev.subtype === 'error') {
              onError(String(ev.error ?? 'claude CLI error'))
              return
            }
          }
        } catch { /* ignore malformed lines */ }
      }
    }

    const exit = await proc.exited
    if (exit !== 0 && !gotResult) {
      const errText = await new Response(proc.stderr).text()
      onError(`claude CLI exited with code ${exit}: ${errText.slice(0, 300)}`)
      return
    }
    onDone()
  } catch (err) {
    onError(`claude not found or failed to start: ${err instanceof Error ? err.message : String(err)}`)
  }
}
