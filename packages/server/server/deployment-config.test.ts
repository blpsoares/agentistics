import { describe, expect, it } from 'bun:test'
import { parseEnvFile, resolveDeploymentConfig } from './deployment-config'

describe('parseEnvFile', () => {
  it('reads simple assignments and ignores comments and blanks', () => {
    expect(parseEnvFile('# comment\nA=1\n\nB=two\n')).toEqual({ A: '1', B: 'two' })
  })

  it('keeps everything after the first = , so a URI survives intact', () => {
    expect(parseEnvFile('MONGO_URL=mongodb://u:p@h:27017/?replicaSet=rs0').MONGO_URL)
      .toBe('mongodb://u:p@h:27017/?replicaSet=rs0')
  })

  it('strips surrounding quotes and whitespace', () => {
    expect(parseEnvFile('A = "x" \nB=\'y\'')).toEqual({ A: 'x', B: 'y' })
  })

  it('ignores malformed lines rather than throwing', () => {
    expect(parseEnvFile('no-equals-here\nA=1')).toEqual({ A: '1' })
  })
})

describe('resolveDeploymentConfig', () => {
  const proc = {
    AGENTISTICS_TEAM_CENTRAL: '1',
    AGENTISTICS_TEAM_TLS: '1',
    BIND_IP: '127.0.0.1',
  }

  it('uses the process environment when there is no env file', () => {
    const r = resolveDeploymentConfig(null, proc)
    expect(r.source).toBe('process')
    expect(r.bindIp).toBe('127.0.0.1')
    expect(r.tls).toBe(true)
  })

  it('prefers the deployment file, because that is what the container will run with', () => {
    const r = resolveDeploymentConfig('BIND_IP=0.0.0.0\nAGENTISTICS_TEAM_CENTRAL=1\n', proc)
    expect(r.source).toBe('file')
    expect(r.bindIp).toBe('0.0.0.0')
    // Absent from the file means absent from the deployment — the host's own env must not
    // paper over it, or the check reports on the wrong machine.
    expect(r.tls).toBe(false)
  })

  it('reports the documented defaults for keys the file omits', () => {
    const r = resolveDeploymentConfig('AGENTISTICS_TEAM_CENTRAL=1\n', {})
    expect(r.bindIp).toBe('127.0.0.1')
    expect(r.exposure).toBeUndefined()
    expect(r.allowLocalShell).toBe(false)
  })

  it('carries every field the preflight needs', () => {
    const r = resolveDeploymentConfig(
      [
        'AGENTISTICS_TEAM_CENTRAL=1',
        'AGENTISTICS_EXPOSURE=public',
        'AGENTISTICS_TEAM_TLS=1',
        'AGENTISTICS_TRUST_PROXY=1',
        'AGENTISTICS_ALLOW_LOCAL_SHELL=1',
        'AGENTISTICS_TEAM_SESSION_SECRET=' + 'f'.repeat(64),
        'AGENTISTICS_TEAM_PASSWORD=hunter2hunter2',
        'AGENTISTICS_ALLOWED_ORIGINS=https://a.example, https://b.example',
        'BIND_IP=127.0.0.1',
        'MONGO_URL=mongodb://user:pass@mongo:27017/',
      ].join('\n'),
      {},
    )
    expect(r).toMatchObject({
      central: true,
      exposure: 'public',
      tls: true,
      trustProxy: true,
      allowLocalShell: true,
      bindIp: '127.0.0.1',
      mongoAuthenticated: true,
      source: 'file',
    })
    expect(r.allowedOrigins).toEqual(['https://a.example', 'https://b.example'])
    expect(r.password).toBe('hunter2hunter2')
  })

  it('detects an unauthenticated mongo URI', () => {
    expect(resolveDeploymentConfig('MONGO_URL=mongodb://mongo:27017/', {}).mongoAuthenticated).toBe(false)
  })
})
