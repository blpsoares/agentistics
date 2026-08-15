/**
 * task-delete.ts — PURE. Removing a task, and what that means for the sessions filed under it.
 *
 * ## Why deleting a task is not deleting anything else
 *
 * A task is a free string on a session — a label somebody typed to group work. Reported: the task
 * list had grown to dozens of entries, many naming work that is over and some whose sessions no
 * longer exist at all, and there was no way to remove one. `finishTask` marks a task DONE, which
 * hides its sessions behind a switch; that is a statement about the WORK. Deleting is a statement
 * about the LABEL, and the two are not the same request.
 *
 * **So the sessions survive.** Deleting the task clears the label from every row wearing it and
 * leaves the rows exactly where they were, still reopenable, still named, still carrying their
 * notes. A delete that took the sessions with it would be a data-loss verb wearing a tidy-up's
 * name — and the reason this list got long in the first place is that people do not remove things
 * they are not sure about.
 *
 * ## The two lists it has to touch, and why forgetting one is the bug
 *
 * A task's name lives in TWO places: on each session (`ManagedSession.task`) and in the finished
 * list (`preferences.finishedTasks`). Clearing only the sessions leaves the name in the finished
 * list, where it goes on being an entry in a menu that now names nothing — the exact shape of the
 * complaint. Clearing only the finished list leaves every session still filed under it, so the task
 * reappears the moment the list is rebuilt from the sessions.
 */

/** One session, reduced to what this decision needs. */
export interface TaskSession {
  id: string
  task?: string
  endedAt?: string
}

export interface TaskDeletePlan {
  /** Rows whose `task` must be cleared. Never removed — see the header. */
  clear: string[]
  /** True when the name must also come out of `finishedTasks`. */
  unfinish: boolean
  /** How many of the cleared rows were still ACTIVE, so the confirmation can say it. */
  live: number
}

/**
 * Decide — PURE.
 *
 * An empty or unmatched name yields an empty plan rather than an error: a task that names nothing
 * is already in the state the user asked for, and refusing would be pedantry about a no-op.
 */
export function planTaskDelete(o: {
  task: string
  sessions: readonly TaskSession[]
  finished: readonly string[]
}): TaskDeletePlan {
  const task = o.task.trim()
  if (!task) return { clear: [], unfinish: false, live: 0 }

  const wearing = o.sessions.filter(s => s.task === task)
  return {
    clear: wearing.map(s => s.id),
    unfinish: o.finished.includes(task),
    // A row with no `endedAt` is one that has not been retired — the sessions someone would be
    // surprised to see change. Counted so the question can say how many rather than asking for a
    // blanket yes.
    live: wearing.filter(s => !s.endedAt).length,
  }
}

/** Whether the plan would change anything at all — the caller says so instead of reporting success. */
export function taskDeleteIsNoop(plan: TaskDeletePlan): boolean {
  return plan.clear.length === 0 && !plan.unfinish
}
