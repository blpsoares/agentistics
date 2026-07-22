import { test, expect } from 'bun:test'
import { visibleSettingsSections } from './settingsSections'

const ids = (v: Parameters<typeof visibleSettingsSections>[0]) => visibleSettingsSections(v).map(s => s.id)

test('solo/member: personal sections + live, no central-only', () => {
  expect(ids({ central: false })).toEqual(['preferences', 'sessions', 'data-sources', 'harnesses', 'install', 'live'])
})

test('central owner: personal (no live) + all central sections', () => {
  expect(ids({ central: true, role: 'owner' })).toEqual(['preferences', 'sessions', 'data-sources', 'harnesses', 'install', 'iam', 'team', 'repositories'])
})

test('central manager: personal + iam only', () => {
  expect(ids({ central: true, role: 'member', isManager: true })).toEqual(['preferences', 'sessions', 'data-sources', 'harnesses', 'install', 'iam'])
})

test('central plain user: personal only, no iam/team/repos', () => {
  expect(ids({ central: true, role: 'member', isManager: false })).toEqual(['preferences', 'sessions', 'data-sources', 'harnesses', 'install'])
})
