import { describe, expect, test } from 'bun:test'
import {
  SKILL_NAME,
  SKILL_VERSION,
  isManagedSkill,
  managedSkillVersion,
  skillMarkdown,
  skillMarker,
} from './claude-skill'

const doc = (harnesses: string[] = ['claude', 'codex', 'gemini']) => skillMarkdown({ harnesses })

describe('skillMarkdown', () => {
  test('opens with frontmatter Claude Code can index', () => {
    const md = doc()
    expect(md.startsWith('---\n')).toBe(true)
    const front = md.slice(4, md.indexOf('\n---', 4))
    expect(front).toContain(`name: ${SKILL_NAME}`)
    expect(front).toContain('description: ')
    // The description is what decides whether the skill is ever loaded, so it must name the
    // situation, not the tool.
    expect(front.toLowerCase()).toContain('parallel')
  })

  test('names only the harnesses this machine can actually start', () => {
    const md = doc(['claude', 'kimi'])
    expect(md).toContain('**claude, kimi**')
    expect(md).not.toContain('--session "gemini')
  })

  test('teaches the batch contract, not a command that does not exist', () => {
    const md = doc()
    expect(md).toContain('agentop session batch --task')
    expect(md).toContain('--json')
    expect(md).toContain('agentop session open "<task>"')
    expect(md).toContain('agentop session list --json')
  })

  test('states the consent rule the whole feature rests on', () => {
    const md = doc()
    expect(md).toContain('**Never start a session without the user\'s explicit go-ahead.**')
  })
})

describe('ownership', () => {
  test('a document we wrote is ours to rewrite, and says which version wrote it', () => {
    const md = doc()
    expect(isManagedSkill(md)).toBe(true)
    expect(managedSkillVersion(md)).toBe(SKILL_VERSION)
  })

  test('a file whose marker was deleted is nobody\'s but the user\'s', () => {
    const edited = doc().replace(skillMarker(), '')
    expect(isManagedSkill(edited)).toBe(false)
    expect(managedSkillVersion(edited)).toBeNull()
  })

  test('a file written by another version is recognised as ours, at that version', () => {
    const older = skillMarkdown({ harnesses: ['claude'], version: SKILL_VERSION - 1 })
    expect(isManagedSkill(older)).toBe(true)
    expect(managedSkillVersion(older)).toBe(SKILL_VERSION - 1)
  })

  test('the marker tells the reader how to opt out', () => {
    expect(skillMarker()).toContain('Delete this line')
  })
})
