import path from 'node:path'

const TTY_CHAT_CWD = path.resolve(import.meta.dir, '../tty-chat-agentistics')

export type ChatMessage = { role: 'user' | 'assistant'; content: string }

export const CHAT_MODELS = [
  { id: 'claude-haiku-4-5',   label: 'Haiku 4.5',   badge: 'Fast',     desc: 'Fastest responses, great for quick questions',    inputPer1M: 0.80,  outputPer1M: 4.00  },
  { id: 'claude-sonnet-4-6',  label: 'Sonnet 4.6',  badge: 'Balanced', desc: 'Best balance of speed and intelligence',          inputPer1M: 3.00,  outputPer1M: 15.00 },
  { id: 'claude-opus-4-7',    label: 'Opus 4.7',    badge: 'Powerful', desc: 'Most capable — ideal for complex analysis',       inputPer1M: 15.00, outputPer1M: 75.00 },
] as const

export type ChatModelId = typeof CHAT_MODELS[number]['id']

export async function streamViaClaude(
  message: string,
  history: ChatMessage[],
  model: ChatModelId,
  onChunk: (text: string) => void,
  onTool: (name: string) => void,
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
      ['claude', '--print', '--output-format', 'stream-json', '--verbose', '--model', model],
      { stdout: 'pipe', stderr: 'pipe', stdin: 'pipe', cwd: TTY_CHAT_CWD },
    )
    proc.stdin.write(prompt)
    proc.stdin.end()

    const decoder = new TextDecoder()
    let lineBuffer = ''
    let emittedLength = 0
    let gotResult = false
    const seenTools = new Set<string>()

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
            const msg = event.message as { content?: Array<{ type: string; text?: string; name?: string }> } | undefined
            for (const block of msg?.content ?? []) {
              if (block.type === 'text' && typeof block.text === 'string') {
                const delta = block.text.slice(emittedLength)
                if (delta) { onChunk(delta); emittedLength = block.text.length }
              } else if (block.type === 'tool_use' && typeof block.name === 'string') {
                if (!seenTools.has(block.name)) {
                  seenTools.add(block.name)
                  onTool(block.name)
                }
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

export async function execCommand(
  command: string,
  onChunk: (text: string, isStderr: boolean) => void,
  onDone: (exitCode: number) => void,
  onError: (err: string) => void,
): Promise<void> {
  try {
    const proc = Bun.spawn(['bash', '-c', command], {
      stdout: 'pipe',
      stderr: 'pipe',
      stdin: 'inherit',
    })

    const decoder = new TextDecoder()

    void (async () => {
      for await (const chunk of proc.stdout as unknown as AsyncIterable<Uint8Array>) {
        onChunk(decoder.decode(chunk, { stream: true }), false)
      }
    })()

    void (async () => {
      for await (const chunk of proc.stderr as unknown as AsyncIterable<Uint8Array>) {
        onChunk(decoder.decode(chunk, { stream: true }), true)
      }
    })()

    const code = await proc.exited
    onDone(code)
  } catch (err) {
    onError(err instanceof Error ? err.message : String(err))
  }
}
