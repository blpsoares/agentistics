/**
 * Chat settings — the switch that decides whether this machine serves the chat at all.
 *
 * It is off until someone turns it on. Chat spawns an assistant CLI on this host, which is the most
 * powerful thing the server does; before it was opt-in, a machine installed for its metrics also
 * shipped a shell nobody had chosen.
 *
 * The switch can only NARROW what the exposure profile already permits (`chat-gate.ts`). When the
 * profile has revoked `localChat` the row says so and stays disabled — offering a toggle that the
 * server would refuse is the affordance this whole capability model exists to remove.
 */
import { useCallback, useEffect, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import type { AppContext } from '../../lib/app-context'
import { SectionHeader, Divider, PrefRow, Toggle } from './primitives'

export default function ChatSettings() {
  const ctx = useOutletContext<AppContext>()
  const pt = ctx.lang === 'pt'

  const [enabled, setEnabled] = useState<boolean | null>(null)
  const [capable, setCapable] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    void (async () => {
      const [prefs, session] = await Promise.all([
        fetch('/api/preferences')
          .then(r => (r.ok ? r.json() : {}) as Promise<{ chatEnabled?: boolean }>)
          .catch(() => ({}) as { chatEnabled?: boolean }),
        fetch('/api/team/session')
          .then(r => (r.ok ? r.json() : {}) as Promise<{ capabilities?: { localChat?: boolean } }>)
          .catch(() => ({}) as { capabilities?: { localChat?: boolean } }),
      ])
      setEnabled(prefs.chatEnabled === true)
      // Undefined on an older server, which had no capability model — treat as permitted, the same
      // reading the rest of the app uses.
      setCapable(session.capabilities?.localChat !== false)
    })()
  }, [])

  const toggle = useCallback(async () => {
    if (enabled === null || !capable) return
    const next = !enabled
    setSaving(true)
    setEnabled(next)
    try {
      await fetch('/api/preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatEnabled: next }),
      })
    } catch {
      setEnabled(!next)  // put the switch back where it was; nothing was saved
    } finally {
      setSaving(false)
    }
  }, [enabled, capable])

  return (
    <>
      <SectionHeader label={pt ? 'Chat nesta máquina' : 'Chat on this machine'} />

      <PrefRow
        label={pt ? 'Habilitar o chat' : 'Enable chat'}
        sub={capable
          ? (pt
            ? 'Desligado por padrão. Ligar permite que o painel execute a CLI de um assistente nesta máquina.'
            : 'Off by default. Turning it on lets the dashboard run an assistant CLI on this machine.')
          : (pt
            ? 'Indisponível: o perfil de exposição desta instância não permite executar nada no host.'
            : 'Unavailable: this instance’s exposure profile does not allow running anything on the host.')}
      >
        <Toggle
          on={enabled === true}
          onToggle={() => { void toggle() }}
          disabled={!capable || enabled === null || saving}
        />
      </PrefRow>

      <Divider />

      <div style={{ fontSize: 12, color: 'var(--text-tertiary)', lineHeight: 1.6 }}>
        {pt
          ? 'O servidor é quem decide: com o chat desligado, /api/chat-tty e /api/chat-harnesses respondem 403. Esconder o botão não fecharia a porta.'
          : 'The server is what decides: with chat off, /api/chat-tty and /api/chat-harnesses answer 403. Hiding the button would not close the door.'}
      </div>
    </>
  )
}
