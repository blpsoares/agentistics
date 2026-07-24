import { useOutletContext } from 'react-router-dom'
import type { AppContext } from '../../lib/app-context'
import { TeamRepos } from '../../components/TeamRepos'

export default function ReposSettingsPage() {
  const ctx = useOutletContext<AppContext>()
  return <TeamRepos lang={ctx.lang === 'pt' ? 'pt' : 'en'} />
}
