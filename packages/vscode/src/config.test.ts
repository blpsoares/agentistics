import { describe, expect, it } from 'bun:test'
import { dashboardFor, resolveEndpoints } from './config'

describe('resolveEndpoints', () => {
  it('defaults to the local server and derives the dashboard from it', () => {
    expect(resolveEndpoints({})).toEqual({
      api: 'http://127.0.0.1:47291',
      dashboard: 'http://127.0.0.1:47292',
    })
  })

  it('derives the dashboard from a MOVED api rather than from a second hardcoded port', () => {
    // Someone who moves the server has already said where it is; making them update a second
    // setting to match is how the two get out of step.
    expect(resolveEndpoints({ apiUrl: 'http://127.0.0.1:9100' }).dashboard)
      .toBe('http://127.0.0.1:9101')
    expect(resolveEndpoints({ apiUrl: 'http://dev-box.lan:47291' }).dashboard)
      .toBe('http://dev-box.lan:47292')
  })

  it('lets an explicit dashboard win', () => {
    const out = resolveEndpoints({ apiUrl: 'http://127.0.0.1:9100', dashboardUrl: 'https://metrics.example/' })
    expect(out.dashboard).toBe('https://metrics.example')
  })

  it('trims trailing slashes so callers can concatenate a path', () => {
    expect(resolveEndpoints({ apiUrl: 'http://127.0.0.1:47291/' }).api).toBe('http://127.0.0.1:47291')
  })

  it('reports an unreadable setting instead of silently correcting it', () => {
    // A working panel reading a machine the user did not name is worse than a visible complaint.
    const out = resolveEndpoints({ apiUrl: 'not a url' })
    expect(out.api).toBe('http://127.0.0.1:47291')
    expect(out.invalid).toBe('not a url')
  })

  it('refuses a scheme no fetch can follow', () => {
    expect(resolveEndpoints({ apiUrl: 'file:///tmp/x' }).invalid).toBe('file:///tmp/x')
  })

  it('leaves a portless address alone rather than inventing a neighbour port', () => {
    // Behind a proxy on 443 there is no port to add one to, and `:444` would be a guess about
    // somebody else's deployment.
    expect(dashboardFor(new URL('https://agentistics.example/'))).toBe('https://agentistics.example')
  })
})
