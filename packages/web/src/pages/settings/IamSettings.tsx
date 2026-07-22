import React from 'react'
import { useOutletContext } from 'react-router-dom'
import { IamTab } from '../../components/IamTab'
import type { AppContext } from '../../lib/app-context'

export default function IamSettings() {
  const { lang } = useOutletContext<AppContext>()
  const pt = lang === 'pt'
  return <IamTab pt={pt} />
}
