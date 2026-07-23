/** Which settings sections a viewer can see. UX-only gate — the server enforces real authz. */
export type SettingsSectionId =
  | 'preferences' | 'sessions' | 'data-sources' | 'harnesses' | 'install' | 'live'
  | 'users' | 'teams' | 'machines' | 'repositories'

export type SettingsGroup = 'personal' | 'governance'

export interface SettingsSection { id: SettingsSectionId; labelEn: string; labelPt: string; group: SettingsGroup }
export interface SettingsViewer { central: boolean; role?: 'owner' | 'member'; isManager?: boolean }

export const SETTINGS_SECTIONS: SettingsSection[] = [
  { id: 'preferences', labelEn: 'Preferences', labelPt: 'Preferências', group: 'personal' },
  { id: 'sessions', labelEn: 'Sessions', labelPt: 'Sessões', group: 'personal' },
  { id: 'data-sources', labelEn: 'Data & sources', labelPt: 'Dados & fontes', group: 'personal' },
  { id: 'harnesses', labelEn: 'Harnesses', labelPt: 'Harnesses', group: 'personal' },
  { id: 'install', labelEn: 'Install', labelPt: 'Instalação', group: 'personal' },
  { id: 'live', labelEn: 'Live', labelPt: 'Ao vivo', group: 'personal' },
  { id: 'users', labelEn: 'Users', labelPt: 'Usuários', group: 'governance' },
  { id: 'teams', labelEn: 'Teams', labelPt: 'Times', group: 'governance' },
  { id: 'machines', labelEn: 'Machines', labelPt: 'Máquinas', group: 'governance' },
  { id: 'repositories', labelEn: 'GitHub Repositories', labelPt: 'Repositórios GitHub', group: 'governance' },
]

export function visibleSettingsSections(v: SettingsViewer): SettingsSection[] {
  return SETTINGS_SECTIONS.filter(s => {
    switch (s.id) {
      case 'live': return !v.central
      case 'users':
      case 'teams':
      case 'machines': return v.central && (v.role === 'owner' || !!v.isManager)
      case 'repositories': return v.central && v.role === 'owner'
      default: return true
    }
  })
}
