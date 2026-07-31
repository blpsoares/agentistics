import { describe, test, expect } from 'bun:test'
import { COPY } from './copy'

describe('SharedReposEditView — locked no-repository row subtitle', () => {
  test('has a dedicated copy entry for locked no-repo rows that does not end in an empty name', () => {
    // A locked "No repository" row should display an appropriate subtitle.
    // It must not be a template with an empty {repo} placeholder, and should not be
    // the generic mixedRepoWarn which describes multi-repo folders.
    expect(COPY).toHaveProperty('lockedNoRepoWarn')

    const lockedNoRepoSubtitle = COPY.lockedNoRepoWarn
    expect(lockedNoRepoSubtitle.en.length).toBeGreaterThan(0)
    expect(lockedNoRepoSubtitle.pt.length).toBeGreaterThan(0)

    // Should not contain templates that interpolate repo/repoKey values
    expect(lockedNoRepoSubtitle.en).not.toContain('{repo}')
    expect(lockedNoRepoSubtitle.pt).not.toContain('{repo}')

    // Should not end with an empty string or placeholder
    expect(lockedNoRepoSubtitle.en.trim()).not.toMatch(/:\s*$|"\s*$/)
    expect(lockedNoRepoSubtitle.pt.trim()).not.toMatch(/:\s*$|"\s*$/)
  })
})
