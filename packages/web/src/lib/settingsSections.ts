/** Which settings sections a viewer can see. UX-only gate — the server enforces real authz. */
export type SettingsSectionId =
  | 'preferences' | 'sessions' | 'data-sources' | 'harnesses' | 'install' | 'live' | 'iam' | 'team' | 'repositories'

export interface SettingsSection { id: SettingsSectionId; labelEn: string; labelPt: string }
export interface SettingsViewer { central: boolean; role?: 'owner' | 'member'; isManager?: boolean }

export const SETTINGS_SECTIONS: SettingsSection[] = [
  { id: 'preferences', labelEn: 'Preferences', labelPt: 'Preferências' },
  { id: 'sessions', labelEn: 'Sessions', labelPt: 'Sessões' },
  { id: 'data-sources', labelEn: 'Data & sources', labelPt: 'Dados & fontes' },
  { id: 'harnesses', labelEn: 'Harnesses', labelPt: 'Harnesses' },
  { id: 'install', labelEn: 'Install', labelPt: 'Instalação' },
  { id: 'live', labelEn: 'Live', labelPt: 'Ao vivo' },
  { id: 'iam', labelEn: 'IAM', labelPt: 'IAM' },
  { id: 'team', labelEn: 'Team', labelPt: 'Equipe' },
  { id: 'repositories', labelEn: 'GitHub Repositories', labelPt: 'Repositórios GitHub' },
]

export function visibleSettingsSections(v: SettingsViewer): SettingsSection[] {
  return SETTINGS_SECTIONS.filter(s => {
    switch (s.id) {
      case 'live': return !v.central                       // solo/member only
      case 'iam': return v.central && (v.role === 'owner' || !!v.isManager)
      case 'team':
      case 'repositories': return v.central && v.role === 'owner'
      default: return true                                  // personal sections everywhere
    }
  })
}
