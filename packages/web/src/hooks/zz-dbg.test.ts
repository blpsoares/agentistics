import { test, mock } from 'bun:test'
import { emptyStatsCache } from '@agentistics/core'
import type { AppData, Filters, SessionMeta, StatsCache } from '@agentistics/core'

mock.module('react', () => ({
  useMemo: <T>(fn: () => T) => fn(),
  useState: <T>(init: T) => [init, () => {}],
  useEffect: () => {},
  useCallback: <T>(fn: T) => fn,
  useRef: <T>(init: T) => ({ current: init }),
}))
const { useDerivedStats } = await import('/home/mithrandir/agentistics/packages/web/src/hooks/useData')

const REPO_A = 'github.com/org/alpha'
const REPO_B = 'github.com/org/beta'

function mkSession(over: any): SessionMeta {
  return {
    project_path: '/home/u/alpha', start_time: '2026-07-01T10:00:00.000Z', end_time: '2026-07-01T11:00:00.000Z',
    duration_minutes: 60, user_message_count: 5, assistant_message_count: 5, tool_counts: { Read: 2 },
    tool_output_tokens: {}, agent_file_reads: {}, languages: [], git_commits: 0, git_pushes: 0,
    input_tokens: 1000, output_tokens: 500, first_prompt: 'hello', user_interruptions: 0,
    user_response_times: [], tool_errors: 0, tool_error_categories: {}, uses_task_agent: false,
    uses_mcp: false, uses_web_search: false, uses_web_fetch: false, lines_added: 0, lines_removed: 0,
    files_modified: 0, message_hours: [], user_message_timestamps: [], ...over,
  } as SessionMeta
}

function sc(): StatsCache {
  const s = emptyStatsCache()
  s.lastComputedDate = '2026-01-05'
  s.dailyActivity = ['2026-01-01','2026-01-02','2026-01-03','2026-01-04','2026-01-05'].map(date => ({ date, sessionCount: 10, messageCount: 100, toolCallCount: 50 })) as any
  return s
}

function mk(withMember: boolean): AppData {
  const extra = (m: string, t: string) => withMember ? { memberId: m, user: 'vini', teamIds: [t] } : {}
  return {
    statsCache: sc(),
    sessions: [
      mkSession({ session_id: 'c1', harness: 'claude', model: 'claude-opus-5', git_remote: REPO_A, project_path: '/home/u/alpha', start_time: '2026-07-01T10:00:00.000Z', ...extra('machine-1','team-1') }),
      mkSession({ session_id: 'c2', harness: 'claude', model: 'claude-sonnet-4-6', git_remote: REPO_B, project_path: '/home/u/beta', start_time: '2026-07-02T10:00:00.000Z', ...extra('machine-2','team-2') }),
      mkSession({ session_id: 'x1', harness: 'codex', model: 'gpt-5.4-mini', git_remote: REPO_A, project_path: '/home/u/alpha', start_time: '2026-07-03T10:00:00.000Z', ...extra('machine-1','team-1') }),
      mkSession({ session_id: 'p1', harness: 'copilot', model: 'gpt-5-mini', git_remote: REPO_B, project_path: '/home/u/beta', start_time: '2026-07-04T10:00:00.000Z', ...extra('machine-2','team-2') }),
    ],
    projects: [], allSessions: [], harnesses: ['claude','codex','copilot'],
  }
}

const f = (o: Partial<Filters> = {}): Filters => ({ dateRange: 'all', customStart: '', customEnd: '', projects: [], models: [], ...o })

test('debug', () => {
  const data = mk(true)
  const seq: [string, Filters][] = [
    ['harness codex', f({ harnesses: ['codex'] })],
    ['model gpt-5.4-mini', f({ models: ['gpt-5.4-mini'] })],
    ['repo A', f({ repos: [REPO_A] })],
    ['repo A (again)', f({ repos: [REPO_A] })],
    ['unfiltered', f()],
    ['repo A (after unfiltered)', f({ repos: [REPO_A] })],
  ]
  for (const [label, filters] of seq) {
    const d = useDerivedStats(data, filters)!
    console.log(`${label.padEnd(28)} allTime=${d.allTimeTotalSessions} totalSessions=${d.totalSessions} longest=${d.longestStreak} dailyActivityLen=${data.statsCache.dailyActivity.length}`)
  }
})
