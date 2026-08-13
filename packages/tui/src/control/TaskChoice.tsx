/**
 * TaskChoice.tsx — pick an existing task, or type a new one.
 *
 * Shared by the sessions list (filing a session that already exists) and by the NEW-SESSION wizard,
 * because they are the same question asked at two moments and answering it differently in each is
 * how two lists of tasks start to disagree. It lives here rather than beside either caller: the
 * wizard is imported by the list, so a component owned by the list and used by the wizard is a
 * cycle.
 */

import React, { useEffect, useMemo, useState } from 'react'
import { Box, Text, useInput } from 'ink'
import type { ControlHost } from './types'
import type { ControlStrings } from './i18n'
import { truncate } from '../components/Primitives'
import { COLORS } from '../theme'

/**
 * Filing a session under a task: pick one that exists, or type a new one.
 *
 * A pick rather than a spelling test. A task is a free string, so typing "auth-refactor" a second
 * time as "auth refactor" makes two tasks that look like one and group like two — offering what
 * already exists is what prevents that, and typing still creates a new one when that is what you
 * mean. The list narrows as you type, so a machine with twenty tasks is still one field away.
 */
export function TaskChoice({ host, strings: s, current, width, onCancel, onPick }: {
  host: ControlHost
  strings: ControlStrings
  current: string
  width: number
  onCancel: () => void
  onPick: (value: string) => void
}) {
  const [tasks, setTasks] = useState<string[] | null>(null)
  const [typed, setTyped] = useState('')
  const [index, setIndex] = useState(0)

  useEffect(() => {
    const read = host.sessionTasks
    if (!read) { setTasks([]); return }
    let alive = true
    void read.call(host).then(list => { if (alive) setTasks(list) })
    return () => { alive = false }
  }, [host])

  const matching = useMemo(() => {
    const q = typed.trim().toLowerCase()
    const all = tasks ?? []
    return q ? all.filter(t => t.toLowerCase().includes(q)) : all
  }, [tasks, typed])

  // `''` clears the task, and is offered as a row so removing one is not a hidden gesture.
  const rows = useMemo(() => ['', ...matching], [matching])
  const at = Math.min(index, Math.max(0, rows.length - 1))

  useInput((input, key) => {
    if (key.escape) return onCancel()
    // What is TYPED wins over what is highlighted the moment there is any: that is how a new task
    // gets created, and it must not require clearing the list first.
    if (key.return) return onPick(typed.trim() || rows[at] || '')
    if (key.backspace || key.delete) { setTyped(v => v.slice(0, -1)); setIndex(0); return }
    if (key.upArrow) return setIndex(Math.max(0, at - 1))
    if (key.downArrow) return setIndex(Math.min(rows.length - 1, at + 1))
    if (key.ctrl || key.meta || key.tab) return
    const printable = [...input].filter(ch => ch >= ' ' && ch !== '\x7f').join('')
    if (printable) { setTyped(v => v + printable); setIndex(0) }
  })

  return (
    <Box flexDirection="column" width={width}>
      <Text bold>{truncate(s.sessionsTaskPrompt, width)}</Text>
      <Text dimColor>{truncate(s.taskHint, width)}</Text>
      <Text>
        <Text dimColor>{'› '}</Text>
        {typed ? <Text>{truncate(typed, Math.max(1, width - 2))}</Text> : <Text dimColor>…</Text>}
      </Text>
      {tasks === null ? (
        <Text dimColor>{s.sessionsLoading}</Text>
      ) : (
        rows.slice(0, 6).map((task, i) => {
          const active = !typed && i === at
          const label = task === '' ? s.taskNone : task
          return (
            <Text key={task || '_none'} wrap="truncate" dimColor={Boolean(typed)}>
              <Text color={active ? COLORS.accent : undefined}>{active ? '❯ ' : '  '}</Text>
              <Text color={active ? COLORS.accent : undefined} bold={active}>
                {truncate(label, Math.max(1, width - 4))}
              </Text>
              {task && task === current ? <Text dimColor>{`  ${s.taskCurrent}`}</Text> : null}
            </Text>
          )
        })
      )}
    </Box>
  )
}
