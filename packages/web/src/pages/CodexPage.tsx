import { useEffect } from 'react'
import { useOutletContext } from 'react-router-dom'
import type { AppContext } from '../lib/app-context'
import HomePage from './HomePage'

export default function CodexPage() {
  const ctx = useOutletContext<AppContext>()
  useEffect(() => {
    ctx.setFilters(f => ({ ...f, harness: 'codex' }))
    return () => ctx.setFilters(f => ({ ...f, harness: undefined }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return <HomePage />
}
