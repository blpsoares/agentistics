import React from 'react'
import { Box } from 'ink'
import type { AppData } from '@agentistics/core'
import { fmt, fmtCost, formatModel } from '@agentistics/core'
import { modelRows, type ModelRow } from '../selectors'
import { DataTable, Empty, BarRow, Section, type Column } from '../components/Primitives'
import { COLORS } from '../theme'
import { costsPlan } from '../dashboard/view'
import type { TuiStrings } from '../i18n'

export function Costs({ data, s, width, height }: {
  data: AppData
  s: TuiStrings
  width: number
  height: number
}) {
  const rows = modelRows(data)
  if (rows.length === 0) return <Empty message={s.empty} />

  const total = rows.reduce((n, r) => n + r.costUSD, 0)
  const nameWidth = 24
  const barWidth = Math.max(8, Math.min(24, width - 46))

  const columns: Column<ModelRow>[] = [
    { key: 'model', header: s.model, width: nameWidth, render: r => formatModel(r.model) || r.model },
    { key: 'cost', header: s.cost, width: 14, align: 'right', render: r => fmtCost(r.costUSD), color: () => COLORS.accent },
    { key: 'tokens', header: s.tokens, width: 10, align: 'right', render: r => fmt(r.tokens) },
    { key: 'share', header: s.share, width: 8, align: 'right', render: r => total > 0 ? `${Math.round((r.costUSD / total) * 100)}%` : '0%' },
  ]

  // The table is the screen and the share panel re-states its top five as bars, so the panel is what
  // gives way — whole, never partially. See `costsPlan`.
  const plan = costsPlan(height, rows.length)

  return (
    <Box flexDirection="column">
      <DataTable columns={columns} rows={rows.slice(0, plan.table)} keyOf={r => r.model} width={width} />
      {plan.share > 0 && (
        <Section title={s.share}>
          {rows.slice(0, plan.share).map(r => (
            <BarRow
              key={r.model}
              label={formatModel(r.model) || r.model}
              pct={total > 0 ? r.costUSD / total : 0}
              value={fmtCost(r.costUSD)}
              color={COLORS.accent}
              labelWidth={Math.min(22, Math.max(12, nameWidth))}
              barWidth={barWidth}
            />
          ))}
        </Section>
      )}
    </Box>
  )
}
