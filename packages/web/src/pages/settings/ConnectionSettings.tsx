import { useOutletContext } from 'react-router-dom'
import type { AppContext } from '../../lib/app-context'
import { CentralAdminPanel } from '../../components/team/CentralAdminPanel'
import { ConnectionsPanel } from '../../components/team/ConnectionsPanel'
import { SectionHeader } from './primitives'

/**
 * ConnectionSettings — the route shell for /settings/connection. `TeamSettings.tsx` (920 lines,
 * three components sharing one prop bag) is gone (Task 10); this file only picks which of the two
 * real panels applies.
 *
 * `ctx.isCentral` is typed `boolean` in `AppContext` (App.tsx blocks the whole app until
 * `/api/team/session` resolves, so by the time this route mounts the value is always settled) —
 * the `null` branch below exists anyway because it is this component's documented CONTRACT (the
 * same one the deleted `TeamSettings` honoured): a settings surface must never flicker between the
 * central-admin and member identities while that session request is still in flight, however it
 * gets here.
 */
export default function ConnectionSettings() {
  const ctx = useOutletContext<AppContext>()
  const lang: 'pt' | 'en' = ctx.lang === 'pt' ? 'pt' : 'en'
  const pt = lang === 'pt'
  const isCentral: boolean | null = ctx.isCentral

  return (
    <div>
      <SectionHeader label={pt ? 'Conexão com a central' : 'Central connection'} />

      {isCentral === null ? (
        <div style={{ minHeight: 80 }} />
      ) : isCentral ? (
        <CentralAdminPanel lang={lang} presence={ctx.data.presence} />
      ) : (
        <ConnectionsPanel sessions={ctx.data.sessions} projects={ctx.data.projects} modelUsage={ctx.data.statsCache.modelUsage} lang={lang} />
      )}
    </div>
  )
}
