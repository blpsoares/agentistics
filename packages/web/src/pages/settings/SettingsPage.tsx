import React from 'react'
import { Outlet, useOutletContext } from 'react-router-dom'
import type { AppContext } from '../../lib/app-context'

/**
 * Shell for /settings/* — the aside carries the section nav; this just frames the body.
 * It MUST forward the AppLayout outlet context: React Router's useOutletContext reads the
 * nearest <Outlet context>, so a bare <Outlet/> here would hand child pages `undefined`
 * (and crash them). Re-provide the same context the layout gave us.
 */
export default function SettingsPage() {
  const ctx = useOutletContext<AppContext>()
  return (
    <div style={{ maxWidth: 900 }}>
      <Outlet context={ctx} />
    </div>
  )
}
