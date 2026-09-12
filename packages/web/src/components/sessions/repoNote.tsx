/**
 * repoNote — the ONE empty-region shape the repository explorer's views share.
 *
 * It was declared TWICE, byte-identical, in `RepoTreeView` and `RepoSearchView`, each of whose doc
 * comments claimed to be "the one empty-region shape" — and `RepoFileEditor` would have been the
 * third copy. Extracted for the reason `formBits.tsx` gives for the session dialogs: two copies of
 * one shape are two places for it to drift, and a reader meets them inside ONE panel, one click
 * apart.
 *
 * The shape exists so that what differs between states is the SENTENCE and nothing else. A folder
 * still loading, a folder that is genuinely empty, a listing that failed, a query that matched
 * nothing and a file that is binary are five different facts; one shared "nothing here" box would
 * be the confident-nothing this codebase refuses everywhere.
 */

import type { ReactNode } from 'react'

export function RepoNote({ text, icon }: { text: string; icon: ReactNode }) {
  return (
    <div style={{
      flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '20px 18px',
    }}>
      <p style={{
        margin: 0, fontSize: 12, lineHeight: 1.6, textAlign: 'center', color: 'var(--text-tertiary)',
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
      }}>
        {icon}
        {text}
      </p>
    </div>
  )
}
