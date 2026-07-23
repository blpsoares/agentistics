import { test, expect } from 'bun:test'
import { visibleSettingsSections, SETTINGS_SECTIONS } from './settingsSections'

const ids = (v: Parameters<typeof visibleSettingsSections>[0]) => visibleSettingsSections(v).map(s => s.id)

test('solo/member: personal sections + live, no governance', () => {
  expect(ids({ central: false })).toEqual(['preferences', 'sessions', 'data-sources', 'harnesses', 'install', 'connection', 'live'])
})

test('central owner: personal (no live) + all governance sections', () => {
  expect(ids({ central: true, role: 'owner' })).toEqual(['preferences', 'sessions', 'data-sources', 'harnesses', 'install', 'users', 'teams', 'machines', 'repositories'])
})

test('central manager: personal + governance (users/teams/machines)', () => {
  expect(ids({ central: true, role: 'member', isManager: true })).toEqual(['preferences', 'sessions', 'data-sources', 'harnesses', 'install', 'users', 'teams', 'machines'])
})

test('central plain user: personal only, no governance', () => {
  expect(ids({ central: true, role: 'member', isManager: false })).toEqual(['preferences', 'sessions', 'data-sources', 'harnesses', 'install'])
})

test('every section has a group', () => {
  for (const section of SETTINGS_SECTIONS) {
    expect(section.group).toBeDefined()
    expect(['personal', 'governance']).toContain(section.group)
  }
})
