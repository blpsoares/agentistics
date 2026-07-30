import React from 'react'
import { describe, test, expect } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { RowSwitch, StatusDot } from './primitives'

describe('RowSwitch', () => {
  test('the row itself is a <button role="switch"> with aria-checked reflecting `on`', () => {
    const onHtml = renderToStaticMarkup(<RowSwitch on onToggle={() => {}} label="Acme/repo" />)
    expect(onHtml).toMatch(/^<button\b/)
    expect(onHtml).toContain('role="switch"')
    expect(onHtml).toContain('aria-checked="true"')

    const offHtml = renderToStaticMarkup(<RowSwitch on={false} onToggle={() => {}} label="Acme/repo" />)
    expect(offHtml).toContain('aria-checked="false"')
  })

  test('carries an aria-label so the row is announced without relying on visible text alone', () => {
    const html = renderToStaticMarkup(<RowSwitch on onToggle={() => {}} label="Acme/repo" />)
    expect(html).toContain('aria-label="Acme/repo"')
  })

  test('renders exactly one <button> — the switch pill is a plain span, never a nested button', () => {
    const html = renderToStaticMarkup(<RowSwitch on onToggle={() => {}} label="Acme/repo" sub="12 sessions" />)
    const buttonCount = (html.match(/<button\b/g) ?? []).length
    expect(buttonCount).toBe(1)
  })

  test('dimmed renders the label struck through, not only recolored', () => {
    const html = renderToStaticMarkup(<RowSwitch on={false} onToggle={() => {}} label="Acme/repo" dimmed />)
    expect(html).toContain('line-through')
  })

  test('disabled sets the disabled attribute', () => {
    const html = renderToStaticMarkup(<RowSwitch on onToggle={() => {}} label="Acme/repo" disabled />)
    expect(html).toContain('disabled')
  })
})

describe('StatusDot', () => {
  test('renders a decorative dot with no text content of its own', () => {
    const html = renderToStaticMarkup(<StatusDot state="ok" />)
    expect(html).toContain('aria-hidden')
    // No visible text — the caller is responsible for stating the status in words.
    expect(html.replace(/<[^>]+>/g, '').trim()).toBe('')
  })

  test('each state maps to a distinct color', () => {
    const colorsOf = (html: string) => html.match(/background:\s*([^;"]+)/)?.[1]
    const ok = colorsOf(renderToStaticMarkup(<StatusDot state="ok" />))
    const warn = colorsOf(renderToStaticMarkup(<StatusDot state="warn" />))
    const error = colorsOf(renderToStaticMarkup(<StatusDot state="error" />))
    const unknown = colorsOf(renderToStaticMarkup(<StatusDot state="unknown" />))
    const set = new Set([ok, warn, error, unknown])
    expect(set.size).toBe(4)
  })
})
