import React from 'react'
import { Box } from 'ink'
import type { AppData } from '@agentistics/core'
import { fmt, fmtCost } from '@agentistics/core'
import { projectRows, type ProjectRow } from '../selectors'
import { DataTable, Empty, type Column } from '../components/Primitives'
import { COLORS } from '../theme'
import type { TuiStrings } from '../i18n'

export function Projects({ data, s, width, height }: {
  data: AppData
  s: TuiStrings
  width: number
  height: number
}) {
  const rows = projectRows(data)
  if (rows.length === 0) return <Empty message={s.noProjects} />

  // fitColumns gives the name column whatever the numeric columns leave over.
  const nameWidth = 24
  const columns: Column<ProjectRow>[] = [
    { key: 'name', header: s.project, width: nameWidth, render: r => r.name, color: () => COLORS.text },
    { key: 'cost', header: s.cost, width: 14, align: 'right', render: r => fmtCost(r.costUSD), color: () => COLORS.accent },
    { key: 'tokens', header: s.tokens, width: 10, align: 'right', render: r => fmt(r.tokens) },
    { key: 'sessions', header: s.sessionsCount, width: 10, align: 'right', render: r => String(r.sessions) },
    { key: 'last', header: s.lastActivity, width: 12, align: 'right', render: r => r.lastActivity.slice(0, 10) },
  ]

  return (
    <Box flexDirection="column">
      <DataTable
        columns={columns}
        rows={rows.slice(0, Math.max(1, height))}
        keyOf={r => r.path}
        width={width}
      />
    </Box>
  )
}
