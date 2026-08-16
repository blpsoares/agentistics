/**
 * What the three list screens draw once they page.
 *
 * The bug being held down is one a unit test of the arithmetic cannot see: a screen that slices to
 * whatever the terminal affords and says nothing about the rest ANSWERS with its window. So these
 * assert the sentence under the table as much as the rows in it.
 */

import React from 'react'
import { describe, test, expect } from 'bun:test'
import { render } from 'ink-testing-library'
import type { AppData, SessionMeta } from '@agentistics/core'
import { emptyStatsCache } from '@agentistics/core'
import { History } from './History'
import { Projects } from './Projects'
import { Costs } from './Costs'
import { PAGE_SIZE } from '../dashboard/view'
import { strings } from '../i18n'

const s = strings('en')

function session(i: number, over: Partial<SessionMeta> = {}): SessionMeta {
  return {
    session_id: `s${String(i).padStart(3, '0')}`,
    project_path: `/home/u/proj${i % 40}`,
    start_time: `2026-07-${String(1 + (i % 28)).padStart(2, '0')}T10:00:00Z`,
    first_prompt: `session ${i}`,
    model: `model-${i % 40}`,
    duration_minutes: 5, user_message_count: 1, assistant_message_count: 1,
    tool_counts: {}, tool_output_tokens: {}, agent_file_reads: {}, languages: [],
    git_commits: 0, git_pushes: 0, input_tokens: 10, output_tokens: 5,
    user_interruptions: 0, user_response_times: [], tool_errors: 0,
    tool_error_categories: {}, uses_task_agent: false, uses_mcp: false,
    uses_web_search: false, uses_web_fetch: false, lines_added: 0, lines_removed: 0,
    files_modified: 0, message_hours: [], user_message_timestamps: [],
    harness: 'codex',
    ...over,
  } as SessionMeta
}

function appData(count: number): AppData {
  return {
    statsCache: emptyStatsCache(),
    sessions: Array.from({ length: count }, (_, i) => session(i)),
    projects: [], allSessions: [], harnesses: ['codex'],
  } as unknown as AppData
}

const frameOf = (el: React.ReactElement) =>
  (render(el).lastFrame() ?? '').replace(/\x1b\[[0-9;]*m/g, '')

describe('History paging', () => {
  test('draws one page and states the place and the TOTAL, not the window', () => {
    const frame = frameOf(<History data={appData(355)} s={s} width={100} height={20} page={0} />)
    expect(frame).toContain('page 1 of 24')
    expect(frame).toContain('1-15 of 355')
    // header + 15 rows + the pager line
    expect(frame.split('\n').filter(l => l.trim()).length).toBe(2 + PAGE_SIZE)
  })

  test('a later page names its own slice', () => {
    const frame = frameOf(<History data={appData(355)} s={s} width={100} height={20} page={3} />)
    expect(frame).toContain('page 4 of 24')
    expect(frame).toContain('46-60 of 355')
  })

  test('the last page is short and still says the total', () => {
    const frame = frameOf(<History data={appData(355)} s={s} width={100} height={20} page={23} />)
    expect(frame).toContain('page 24 of 24')
    expect(frame).toContain('346-355 of 355')
  })

  test('a page past the end is clamped rather than rendered blank', () => {
    const frame = frameOf(<History data={appData(20)} s={s} width={100} height={20} page={99} />)
    expect(frame).toContain('page 2 of 2')
    expect(frame).toContain('16-20 of 20')
  })

  test('a list that fits draws no pager at all', () => {
    const frame = frameOf(<History data={appData(4)} s={s} width={100} height={20} page={0} />)
    expect(frame).not.toContain('page 1 of 1')
    expect(frame).not.toContain(s.pagerHint)
  })

  test('an empty list says so rather than paging nothing', () => {
    expect(frameOf(<History data={appData(0)} s={s} width={100} height={20} page={0} />))
      .toContain(s.noSessions)
  })

  test('the page is a window on the FILTERED list — the screen is handed what the filter left', () => {
    // `applyHarnessFilter` runs upstream, so a screen given 20 rows can never reach a 21st.
    expect(frameOf(<History data={appData(20)} s={s} width={100} height={20} page={0} />))
      .toContain('1-15 of 20')
  })
})

describe('Projects paging', () => {
  test('pages its own list and counts every project', () => {
    // 40 distinct project paths across the sessions above.
    const frame = frameOf(<Projects data={appData(200)} s={s} width={100} height={20} page={1} />)
    expect(frame).toContain('page 2 of 3')
    expect(frame).toContain('16-30 of 40')
  })
})

describe('Costs paging', () => {
  test('pages the model table while the share panel keeps ranking the whole list', () => {
    const frame = frameOf(<Costs data={appData(200)} s={s} width={100} height={30} page={1} />)
    expect(frame).toContain('of 40')
    // The share panel is a view of the top five OVERALL, so it does not move with the page.
    expect(frame).toContain(s.share)
  })
})
