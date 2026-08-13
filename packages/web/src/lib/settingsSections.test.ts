import { test, expect } from 'bun:test'
import { visibleSettingsSections, SETTINGS_SECTIONS } from './settingsSections'

const ids = (v: Parameters<typeof visibleSettingsSections>[0]) => visibleSettingsSections(v).map(s => s.id)

test('solo/member: personal sections + live, no governance', () => {
  expect(ids({ central: false })).toEqual(['preferences', 'sessions', 'data-sources', 'harnesses', 'pricing', 'billing', 'install', 'connection', 'live', 'chat'])
})

test('central owner: personal (no live) + all governance sections', () => {
  expect(ids({ central: true, role: 'owner' })).toEqual(['preferences', 'sessions', 'data-sources', 'harnesses', 'pricing', 'install', 'users', 'teams', 'machines', 'repositories'])
})

test('central manager: personal + governance (users/teams/machines)', () => {
  expect(ids({ central: true, role: 'member', isManager: true })).toEqual(['preferences', 'sessions', 'data-sources', 'harnesses', 'pricing', 'install', 'users', 'teams', 'machines'])
})

test('central plain user: personal + machines (to view/manage their own), no users/teams', () => {
  expect(ids({ central: true, role: 'member', isManager: false })).toEqual(['preferences', 'sessions', 'data-sources', 'harnesses', 'pricing', 'install', 'machines'])
})

test('every section has a group', () => {
  for (const section of SETTINGS_SECTIONS) {
    expect(section.group).toBeDefined()
    expect(['personal', 'governance']).toContain(section.group)
  }
})

test('billing is a machine section — a central cannot price a fleet from one timeline', () => {
  expect(ids({ central: false })).toContain('billing')
  expect(ids({ central: true, role: 'owner' })).not.toContain('billing')
  expect(ids({ central: true, role: 'member', isManager: true })).not.toContain('billing')
})

test('chat is a machine section — a central serves no local chat to configure', () => {
  expect(ids({ central: false })).toContain('chat')
  expect(ids({ central: true, role: 'owner' })).not.toContain('chat')
})
