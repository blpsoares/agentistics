import React, { useEffect } from 'react'
import type { ControlSessions, ControlStatus } from '../types'
import type { CliLang } from '../lang'
import type { ControlStrings } from '../i18n'
import type { TabChrome } from '../ControlCenter'
import { useAppData } from '../../data/useAppData'
import { Hardware } from '../../screens/Hardware'
import { dashboardSource } from '../../dashboard/view'
import { strings } from '../../i18n'

export function HardwareTab({ status, fleet, strings: s, lang, width, height, isActive, nonce, onChrome }: {
  status: ControlStatus | null
  fleet?: ControlSessions | null
  strings: ControlStrings
  lang: CliLang
  width: number
  height: number
  isActive: boolean
  nonce: number
  onChrome: (chrome: TabChrome) => void
}) {
  const t = strings(lang)
  const source = dashboardSource(status?.services)
  const fallbackPort = process.env.PORT || '47291'
  const apiBase = source.kind === 'api' ? source.apiBase : `http://localhost:${fallbackPort}`

  const { data } = useAppData(source.kind === 'api' ? source.apiBase : null, {
    enabled: isActive,
    nonce,
  })

  useEffect(() => {
    if (!isActive) return
    onChrome({ capture: false, hints: [s.keyQuit, s.keyTabs, s.keyRefresh] })
  }, [isActive, onChrome, s])

  return (
    <Hardware
      data={data ?? ({ sessions: [] } as any)}
      fleetSessions={fleet?.sessions}
      apiBase={apiBase}
      s={t}
      width={width}
      height={height}
    />
  )
}
