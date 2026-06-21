import { useEffect } from 'react'
import { useParams, useNavigate, useOutletContext } from 'react-router-dom'
import type { HarnessId } from '@agentistics/core'
import type { AppContext } from '../lib/app-context'
import HomePage from './HomePage'

const VALID_HARNESS_IDS: HarnessId[] = ['claude', 'codex', 'gemini', 'copilot']

export default function HarnessPage() {
  const { harness } = useParams<{ harness: string }>()
  const navigate = useNavigate()
  const ctx = useOutletContext<AppContext>()

  const validHarness = VALID_HARNESS_IDS.includes(harness as HarnessId)
    ? (harness as HarnessId)
    : null

  useEffect(() => {
    if (!validHarness) {
      navigate('/', { replace: true })
      return
    }
    ctx.setFilters(f => ({ ...f, harness: validHarness }))
    return () => ctx.setFilters(f => ({ ...f, harness: undefined }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [validHarness])

  return <HomePage />
}
