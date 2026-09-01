import { describe, expect, it } from 'bun:test'
import { loopbackAsLocalhost } from './config'

describe('loopbackAsLocalhost', () => {
  it('rewrites the numeric loopback, which a webview does not port-map', () => {
    // A frame pointed at `127.0.0.1` inside a webview reaches the CLIENT machine's loopback, which
    // in a WSL or Remote-SSH window is a different computer with nothing listening — a blank frame
    // and no error anywhere.
    expect(loopbackAsLocalhost('http://127.0.0.1:47292')).toBe('http://localhost:47292')
    expect(loopbackAsLocalhost('http://127.0.0.1:47292/')).toBe('http://localhost:47292')
    expect(loopbackAsLocalhost('http://[::1]:47292')).toBe('http://localhost:47292')
  })

  it('leaves any other host alone', () => {
    // Someone who pointed this at a real machine meant that machine.
    expect(loopbackAsLocalhost('http://dev-box.lan:47292')).toBe('http://dev-box.lan:47292')
    expect(loopbackAsLocalhost('https://metrics.example')).toBe('https://metrics.example')
    expect(loopbackAsLocalhost('http://localhost:47292')).toBe('http://localhost:47292')
  })

  it('is total — junk comes back untouched rather than throwing', () => {
    expect(loopbackAsLocalhost('not a url')).toBe('not a url')
    expect(loopbackAsLocalhost('')).toBe('')
  })
})
