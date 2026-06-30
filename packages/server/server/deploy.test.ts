/**
 * deploy.test.ts — unit tests for generateEnvFile() and autostartSnippet().
 *
 * Pure functions, no filesystem access, no mocking needed.
 */

import { describe, it, expect } from 'bun:test'
import { generateEnvFile, autostartSnippet } from './deploy'

// ---------------------------------------------------------------------------
// generateEnvFile
// ---------------------------------------------------------------------------

describe('generateEnvFile', () => {
  it('includes the supplied password and session secret', () => {
    const out = generateEnvFile({
      password: 'supersecretpassword',
      sessionSecret: 'abc123sessionkey',
      mongoUrl: 'mongodb://mongo:27017/?replicaSet=rs0',
    })
    expect(out).toContain('AGENTISTICS_TEAM_PASSWORD=supersecretpassword')
    expect(out).toContain('AGENTISTICS_TEAM_SESSION_SECRET=abc123sessionkey')
  })

  it('includes MONGO_URL as provided', () => {
    const out = generateEnvFile({
      password: 'pw',
      sessionSecret: 'sec',
      mongoUrl: 'mongodb://mongo:27017/?replicaSet=rs0',
    })
    expect(out).toContain('MONGO_URL=mongodb://mongo:27017/?replicaSet=rs0')
  })

  it('sets AGENTISTICS_TEAM_CENTRAL=1', () => {
    const out = generateEnvFile({
      password: 'pw',
      sessionSecret: 'sec',
      mongoUrl: 'mongodb://mongo:27017',
    })
    expect(out).toContain('AGENTISTICS_TEAM_CENTRAL=1')
  })

  it('uses default mongoDb and teamOrg when omitted', () => {
    const out = generateEnvFile({
      password: 'pw',
      sessionSecret: 'sec',
      mongoUrl: 'mongodb://mongo:27017',
    })
    expect(out).toContain('MONGO_DB=agentistics')
    expect(out).toContain('AGENTISTICS_TEAM_ORG=default')
  })

  it('uses custom mongoDb and teamOrg when provided', () => {
    const out = generateEnvFile({
      password: 'pw',
      sessionSecret: 'sec',
      mongoUrl: 'mongodb://mongo:27017',
      mongoDb: 'mydb',
      teamOrg: 'acme',
    })
    expect(out).toContain('MONGO_DB=mydb')
    expect(out).toContain('AGENTISTICS_TEAM_ORG=acme')
  })

  it('uses default appPort 47291 when omitted', () => {
    const out = generateEnvFile({
      password: 'pw',
      sessionSecret: 'sec',
      mongoUrl: 'mongodb://mongo:27017',
    })
    expect(out).toContain('APP_PORT=47291')
  })

  it('uses custom appPort when provided', () => {
    const out = generateEnvFile({
      password: 'pw',
      sessionSecret: 'sec',
      mongoUrl: 'mongodb://mongo:27017',
      appPort: 8080,
    })
    expect(out).toContain('APP_PORT=8080')
  })

  it('includes the ingest token when provided', () => {
    const out = generateEnvFile({
      password: 'pw',
      sessionSecret: 'sec',
      mongoUrl: 'mongodb://mongo:27017',
      ingestToken: 'tok-xyz',
    })
    expect(out).toContain('AGENTISTICS_TEAM_INGEST_TOKEN=tok-xyz')
  })

  it('ends with a newline', () => {
    const out = generateEnvFile({
      password: 'pw',
      sessionSecret: 'sec',
      mongoUrl: 'mongodb://mongo:27017',
    })
    expect(out.endsWith('\n')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// autostartSnippet
// ---------------------------------------------------------------------------

describe('autostartSnippet', () => {
  describe('systemd', () => {
    it('returns a valid unit file header', () => {
      const out = autostartSnippet('systemd', '/usr/local/bin/agentop')
      expect(out).toContain('[Unit]')
      expect(out).toContain('[Service]')
      expect(out).toContain('[Install]')
    })

    it('contains the provided execPath', () => {
      const out = autostartSnippet('systemd', '/usr/local/bin/agentop')
      expect(out).toContain('ExecStart=/usr/local/bin/agentop')
    })

    it('includes docker compose execPath verbatim', () => {
      const out = autostartSnippet('systemd', 'docker compose up -d')
      expect(out).toContain('ExecStart=docker compose up -d')
    })
  })

  describe('launchd', () => {
    it('returns valid plist XML', () => {
      const out = autostartSnippet('launchd', '/usr/local/bin/agentop')
      expect(out).toContain('<?xml version="1.0"')
      expect(out).toContain('<plist version="1.0">')
      expect(out).toContain('com.agentistics.team')
    })

    it('contains the provided execPath in the program arguments', () => {
      const out = autostartSnippet('launchd', '/usr/local/bin/agentop')
      expect(out).toContain('<string>/usr/local/bin/agentop</string>')
    })

    it('sets RunAtLoad and KeepAlive to true', () => {
      const out = autostartSnippet('launchd', '/usr/local/bin/agentop')
      expect(out).toContain('<key>RunAtLoad</key>')
      expect(out).toContain('<key>KeepAlive</key>')
    })
  })

  describe('pm2', () => {
    it('returns a module.exports config block', () => {
      const out = autostartSnippet('pm2', '/usr/local/bin/agentop')
      expect(out).toContain('module.exports')
      expect(out).toContain('apps:')
    })

    it('contains the provided execPath as script', () => {
      const out = autostartSnippet('pm2', '/usr/local/bin/agentop')
      expect(out).toContain("script: '/usr/local/bin/agentop'")
    })

    it('mentions pm2 startup instruction', () => {
      const out = autostartSnippet('pm2', '/usr/local/bin/agentop')
      expect(out).toContain('pm2 startup')
    })
  })
})
