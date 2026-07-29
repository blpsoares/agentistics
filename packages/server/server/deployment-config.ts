/**
 * deployment-config.ts — resolve the configuration a central will actually RUN with.
 *
 * `agentop doctor` is usually typed on the host, while the central runs in a container whose
 * environment comes from `central.env`. Reading `process.env` there describes the operator's
 * shell, not the deployment: on a real machine that produced a preflight reporting
 * `BIND_IP=127.0.0.1` while `central.env` said `0.0.0.0` — a false pass on the one check that
 * decides whether the instance is reachable from the internet.
 *
 * So when a deployment file exists it is the authority, whole: a key absent from it is absent
 * from the deployment, and the host's own environment must not paper over it. Inside the
 * container there is no such file and `process.env` is correct.
 *
 * Pure — the caller reads the file and passes its text (or null).
 */

export interface DeploymentConfig {
  central: boolean
  exposure: string | undefined
  allowLocalShell: boolean
  tls: boolean
  trustProxy: boolean
  bindIp: string
  allowedOrigins: string[]
  sessionSecret: string | undefined
  password: string | undefined
  mongoAuthenticated: boolean
  /** Which source the values came from — reported to the operator so it is never ambiguous. */
  source: 'file' | 'process'
}

/** Minimal `KEY=value` reader: comments, blanks and malformed lines are skipped. */
export function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq === -1) continue
    const key = line.slice(0, eq).trim()
    let value = line.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (key) out[key] = value
  }
  return out
}

export function resolveDeploymentConfig(
  envFileText: string | null,
  processEnv: Record<string, string | undefined>,
): DeploymentConfig {
  const fromFile = envFileText !== null
  const env = fromFile ? parseEnvFile(envFileText) : processEnv
  const get = (k: string): string | undefined => {
    const v = env[k]
    return v === undefined || v === '' ? undefined : v
  }
  const mongoUrl = get('MONGO_URL') ?? ''
  return {
    central: get('AGENTISTICS_TEAM_CENTRAL') === '1',
    exposure: get('AGENTISTICS_EXPOSURE'),
    allowLocalShell: get('AGENTISTICS_ALLOW_LOCAL_SHELL') === '1',
    tls: get('AGENTISTICS_TEAM_TLS') === '1',
    trustProxy: get('AGENTISTICS_TRUST_PROXY') === '1',
    // Mirrors the compose default, so an omitted key reads as what will actually happen.
    bindIp: get('BIND_IP') ?? '127.0.0.1',
    allowedOrigins: (get('AGENTISTICS_ALLOWED_ORIGINS') ?? '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean),
    sessionSecret: get('AGENTISTICS_TEAM_SESSION_SECRET'),
    password: get('AGENTISTICS_TEAM_PASSWORD'),
    // A credentialed URI carries `user:pass@`.
    mongoAuthenticated: /\/\/[^/@]+@/.test(mongoUrl),
    source: fromFile ? 'file' : 'process',
  }
}
