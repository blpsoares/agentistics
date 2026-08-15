import { describe, it, expect } from 'bun:test'
import { planTaskDelete, taskDeleteIsNoop } from './task-delete'

const sessions = [
  { id: 'a', task: 'cockpit: aprovar e recuperar' },
  { id: 'b', task: 'cockpit: aprovar e recuperar', endedAt: '2026-08-14T10:00:00.000Z' },
  { id: 'c', task: 'Agentistics' },
  { id: 'd' },
]

describe('planTaskDelete', () => {
  it('clears the label from every row wearing it, and keeps the rows', () => {
    // Deleting a task is a statement about the LABEL, not about the work. A delete that took the
    // sessions with it would be a data-loss verb wearing a tidy-up's name — and people do not
    // remove things they are unsure about, which is how the list got long enough to complain about.
    const plan = planTaskDelete({
      task: 'cockpit: aprovar e recuperar', sessions, finished: [],
    })
    expect(plan.clear).toEqual(['a', 'b'])
    expect(plan.live).toBe(1)          // only `a` is still active
    expect(plan.unfinish).toBe(false)
  })

  it('takes the name out of the FINISHED list too', () => {
    // The name lives in two places. Clearing only the sessions leaves it in `finishedTasks`, where
    // it goes on being a menu entry that names nothing — which is the complaint itself.
    const plan = planTaskDelete({
      task: 'Agentistics', sessions, finished: ['Agentistics', 'outra'],
    })
    expect(plan.clear).toEqual(['c'])
    expect(plan.unfinish).toBe(true)
  })

  it('handles a task whose sessions are all gone — the reason this was asked for', () => {
    // "tem sessoes que nem tem mais essa tarefa": a name left in the finished list with nothing
    // wearing it. Nothing to clear, and still something to remove.
    const plan = planTaskDelete({ task: 'trabalho antigo', sessions, finished: ['trabalho antigo'] })
    expect(plan.clear).toEqual([])
    expect(plan.unfinish).toBe(true)
    expect(taskDeleteIsNoop(plan)).toBe(false)
  })

  it('is a NO-OP for a name that means nothing, rather than an error', () => {
    // A task naming nothing is already in the state being asked for; refusing would be pedantry.
    expect(taskDeleteIsNoop(planTaskDelete({ task: 'nunca existiu', sessions, finished: [] }))).toBe(true)
    expect(taskDeleteIsNoop(planTaskDelete({ task: '   ', sessions, finished: [] }))).toBe(true)
  })

  it('never touches a row filed under a DIFFERENT task', () => {
    const plan = planTaskDelete({ task: 'Agentistics', sessions, finished: [] })
    expect(plan.clear).not.toContain('a')
    expect(plan.clear).not.toContain('d')
  })
})
