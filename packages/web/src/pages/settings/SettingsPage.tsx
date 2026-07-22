import React from 'react'
import { Outlet } from 'react-router-dom'

/** Shell for /settings/* — the aside carries the section nav; this just frames the body. */
export default function SettingsPage() {
  return (
    <div style={{ maxWidth: 900 }}>
      <Outlet />
    </div>
  )
}
