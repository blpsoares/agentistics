import { describe, it, expect } from 'bun:test'
import { formatToolName, fmtTime, extractNavLinks, stripNavLinks } from './chatUtils'

describe('formatToolName', () => {
  it('returns mapped label for known tools', () => {
    expect(formatToolName('mcp__agentistics__agentistics_summary')).toBe('Reading metrics')
    expect(formatToolName('mcp__agentistics__agentistics_projects')).toBe('Fetching projects')
    expect(formatToolName('mcp__agentistics__agentistics_costs')).toBe('Analyzing costs')
  })

  it('falls back to humanized name for unknown tools', () => {
    expect(formatToolName('mcp__foo__some_unknown_tool')).toBe('some unknown tool')
    expect(formatToolName('my_tool_name')).toBe('my tool name')
  })

  it('strips mcp__ prefix before lookup', () => {
    expect(formatToolName('mcp__agentistics__agentistics_build_layout')).toBe('Building layout')
  })
})

describe('fmtTime', () => {
  it('returns a non-empty time string for any valid timestamp', () => {
    const result = fmtTime(Date.now())
    expect(typeof result).toBe('string')
    expect(result.length).toBeGreaterThan(0)
  })

  it('formats the same timestamp consistently', () => {
    const ts = new Date('2024-01-15T14:30:00Z').getTime()
    const a = fmtTime(ts)
    const b = fmtTime(ts)
    expect(a).toBe(b)
  })
})

describe('extractNavLinks', () => {
  it('extracts a single nav link', () => {
    const links = extractNavLinks('Check it out [→ Ver projetos](/projects)')
    expect(links).toHaveLength(1)
    const [first] = links
    expect(first?.label).toBe('Ver projetos')
    expect(first?.path).toBe('/projects')
  })

  it('strips the → prefix from the label', () => {
    const links = extractNavLinks('[→ Dashboard](/)')
    const [first] = links
    expect(first?.label).toBe('Dashboard')
  })

  it('extracts multiple nav links', () => {
    const links = extractNavLinks('[→ Custos](/costs) and [→ Projetos](/projects)')
    expect(links).toHaveLength(2)
    const [first, second] = links
    expect(first?.path).toBe('/costs')
    expect(second?.path).toBe('/projects')
  })

  it('returns empty array when no links present', () => {
    expect(extractNavLinks('No links here.')).toHaveLength(0)
  })

  it('ignores external links (non-/ paths)', () => {
    const links = extractNavLinks('[Google](https://google.com)')
    expect(links).toHaveLength(0)
  })
})

describe('stripNavLinks', () => {
  it('removes nav link markdown from text', () => {
    const result = stripNavLinks('Here is the answer. [→ Ver projetos](/projects)')
    expect(result).toBe('Here is the answer.')
  })

  it('removes all nav links when multiple are present', () => {
    const result = stripNavLinks('[→ A](/a) text [→ B](/b)')
    expect(result).toBe('text')
  })

  it('leaves plain text unchanged', () => {
    const text = 'No links here.'
    expect(stripNavLinks(text)).toBe(text)
  })
})
