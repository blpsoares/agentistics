/**
 * History — the sessions this machine has RECORDED, and what each of them cost.
 *
 * It was called `Sessions` while the dashboard was an application of its own. Inside the control
 * center that name is taken, by something genuinely different: the `sessions` tab is the fleet
 * running right now — rows you attach to, approve and kill. This screen is the past, which is
 * exactly what the `history` setting preserves, and the two must not share a word.
 */

import React from 'react'
import { Box } from 'ink'
import type { AppData } from '@agentistics/core'
import { fmt, fmtCost } from '@agentistics/core'
import { sessionRows, type SessionRow } from '../selectors'
import { DataTable, Empty, type Column } from '../components/Primitives'
import { COLORS, HARNESS_COLOR, HARNESS_LABEL } from '../theme'
import { listRows } from '../dashboard/view'
import type { TuiStrings } from '../i18n'

export function History({ data, s, width, height }: {
  data: AppData
  s: TuiStrings
  width: number
  height: number
}) {
  // The table spends a row on its header, so the rows it may draw are one fewer than the height it
  // was given — asking for `height` results and then drawing a header over them is one row of
  // overflow, which Ink composites onto whatever is below.
  const rows = sessionRows(data, { limit: listRows(height) })
  if (rows.length === 0) return <Empty message={s.noSessions} />

  const labelWidth = 24
  const columns: Column<SessionRow>[] = [
    {
      key: 'label',
      header: s.history,
      width: labelWidth,
      // A live session is the one thing worth interrupting the scan for.
      render: r => (r.live ? `● ${r.label || r.id.slice(0, 8)}` : r.label || r.id.slice(0, 8)),
      color: r => (r.live ? COLORS.success : COLORS.text),
    },
    { key: 'harness', header: s.harness, width: 13, render: r => HARNESS_LABEL[r.harness], color: r => HARNESS_COLOR[r.harness] },
    { key: 'project', header: s.project, width: 16, render: r => r.project },
    { key: 'cost', header: s.cost, width: 13, align: 'right', render: r => fmtCost(r.costUSD), color: () => COLORS.accent },
    { key: 'tokens', header: s.tokens, width: 9, align: 'right', render: r => fmt(r.tokens) },
    { key: 'started', header: s.started, width: 12, align: 'right', render: r => r.startTime.slice(0, 10) },
  ]

  return (
    <Box flexDirection="column">
      <DataTable columns={columns} rows={rows} keyOf={r => r.id} width={width} />
    </Box>
  )
}
