import { describe, expect, it } from 'bun:test'
import { buildProjectChoices, searchProjects } from './project-search'
import type { SessionMeta } from '@agentistics/core'

const meta = (path: string, remote: string, when: string): SessionMeta => ({
  session_id: `${path}-${when}`,
  project_path: path,
  git_remote: remote,
  start_time: when,
} as SessionMeta)

describe('buildProjectChoices', () => {
  it('makes one choice per directory, newest activity first', () => {
    const choices = buildProjectChoices([
      meta('/home/u/old', '', '2026-01-01T00:00:00.000Z'),
      meta('/home/u/new', '', '2026-08-01T00:00:00.000Z'),
    ])
    expect(choices.map(c => c.path)).toEqual(['/home/u/new', '/home/u/old'])
  })

  it('collapses repeat visits to one choice', () => {
    const choices = buildProjectChoices([
      meta('/home/u/p', '', '2026-01-01T00:00:00.000Z'),
      meta('/home/u/p', '', '2026-08-01T00:00:00.000Z'),
    ])
    expect(choices).toHaveLength(1)
    expect(choices[0]!.lastActiveMs).toBe(Date.parse('2026-08-01T00:00:00.000Z'))
  })

  it('carries the repository short name when the session had a remote', () => {
    const choices = buildProjectChoices([
      meta('/home/u/p', 'git@github.com:org/repo.git', '2026-08-01T00:00:00.000Z'),
    ])
    expect(choices[0]!.repo).toBe('org/repo')
  })

  it('leaves repo empty rather than inventing one', () => {
    expect(buildProjectChoices([meta('/home/u/p', '', '2026-08-01T00:00:00.000Z')])[0]!.repo).toBe('')
  })
})

describe('searchProjects', () => {
  const choices = buildProjectChoices([
    meta('/home/u/agentistics', 'git@github.com:blpsoares/agentistics.git', '2026-08-01T00:00:00.000Z'),
    meta('/home/u/prontuario', '', '2026-07-01T00:00:00.000Z'),
    meta('/srv/embark', 'https://github.com/opvibes/embark', '2026-06-01T00:00:00.000Z'),
  ])

  it('returns everything, newest first, for an empty query', () => {
    expect(searchProjects(choices, '', 10).map(c => c.path))
      .toEqual(['/home/u/agentistics', '/home/u/prontuario', '/srv/embark'])
  })

  it('matches on the directory name', () => {
    expect(searchProjects(choices, 'pront', 10).map(c => c.path)).toEqual(['/home/u/prontuario'])
  })

  it('matches on the repository name too', () => {
    expect(searchProjects(choices, 'opvibes', 10).map(c => c.path)).toEqual(['/srv/embark'])
  })

  it('is case-insensitive', () => {
    expect(searchProjects(choices, 'AGENTIS', 10)).toHaveLength(1)
  })

  it('ranks a basename hit above a mid-path hit', () => {
    const both = buildProjectChoices([
      meta('/home/embark/other', '', '2026-01-01T00:00:00.000Z'),
      meta('/srv/embark', '', '2026-01-01T00:00:00.000Z'),
    ])
    expect(searchProjects(both, 'embark', 10)[0]!.path).toBe('/srv/embark')
  })

  it('honours the limit', () => {
    expect(searchProjects(choices, '', 2)).toHaveLength(2)
  })

  it('returns nothing rather than everything when nothing matches', () => {
    expect(searchProjects(choices, 'zzzzz', 10)).toEqual([])
  })
})
