import React from 'react'
import { useOutletContext } from 'react-router-dom'
import { FileCode, Clock, FolderOpen } from 'lucide-react'
import type { AppContext } from '../lib/app-context'
import { useIsMobile } from '../hooks/useIsMobile'
import { Section } from '../components/Section'
import { ProjectsList } from '../components/ProjectsList'
import { TagCloud } from '../components/TagCloud'
import { RecentSessions } from '../components/RecentSessions'

export default function ProjectsPage() {
  const ctx = useOutletContext<AppContext>()
  const { derived, filters, setFilters, lang, setSelectedSession } = ctx
  const isMobile = useIsMobile()

  return (
    <>
      <PageHeader
        icon={<FolderOpen size={16} />}
        title={lang === 'pt' ? 'Projetos & código' : 'Projects & code'}
        subtitle={lang === 'pt'
          ? 'Em quais projetos você trabalhou, em quais linguagens, e as sessões mais recentes.'
          : 'Which projects you worked on, in which languages, and your most recent sessions.'}
      />

      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '3fr 2fr', gap: 16, alignItems: 'stretch' }}>
        <Section flashId="projects" style={{ height: '100%' }} title={<><FileCode size={14} /> {lang === 'pt' ? 'Principais projetos' : 'Top projects'}</>}
          action={filters.projects.length > 0 ? (
            <button onClick={() => setFilters(f => ({ ...f, projects: [] }))} style={{ fontSize: 11, color: 'var(--text-tertiary)', background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>
              {lang === 'pt' ? 'Limpar' : 'Clear'}
            </button>
          ) : null}
        >
          <ProjectsList projectStats={derived.projectStats} onFilter={path => setFilters(f => ({ ...f, projects: [path] }))} />
        </Section>
        <Section title={<><FileCode size={14} /> {lang === 'pt' ? 'Linguagens' : 'Languages'}</>} style={{ height: '100%' }}>
          <TagCloud data={derived.langCounts} color="var(--accent-blue)" />
        </Section>
      </div>

      <Section flashId="sessions-list" title={<><Clock size={14} /> {lang === 'pt' ? 'Sessões recentes' : 'Recent sessions'}</>}>
        <RecentSessions sessions={derived.filteredSessions} lang={lang} onSelect={setSelectedSession} />
      </Section>
    </>
  )
}

function PageHeader({ icon, title, subtitle }: { icon: React.ReactNode; title: string; subtitle: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 4 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 18, fontWeight: 700, color: 'var(--text-primary)' }}>
        <span style={{ color: 'var(--anthropic-orange)' }}>{icon}</span>
        {title}
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-tertiary)', lineHeight: 1.5 }}>{subtitle}</div>
    </div>
  )
}
