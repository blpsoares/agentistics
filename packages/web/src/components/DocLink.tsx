import React from 'react'
import { BookOpen } from 'lucide-react'

/** Small "read the docs" icon link. Opens in a new tab; stops click propagation so it works
 *  even when nested inside a clickable header/row. */
export function DocLink({ href, title, size = 13 }: { href: string; title: string; size?: number }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      title={title}
      aria-label={title}
      onClick={e => e.stopPropagation()}
      style={{ display: 'inline-flex', alignItems: 'center', color: 'var(--text-tertiary)', textDecoration: 'none', flexShrink: 0 }}
      onMouseEnter={e => { (e.currentTarget as HTMLAnchorElement).style.color = 'var(--anthropic-orange)' }}
      onMouseLeave={e => { (e.currentTarget as HTMLAnchorElement).style.color = 'var(--text-tertiary)' }}
    >
      <BookOpen size={size} />
    </a>
  )
}
