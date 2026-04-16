import { exec } from 'child_process'
import { promisify } from 'util'
import type { ProjectGitStats } from '../src/lib/types'

const execAsync = promisify(exec)

// UUID regex: 8-4-4-4-12 hex groups
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Decode a Claude project directory name back to a filesystem path. */
export function decodeProjectDir(dirName: string): string {
  // Claude encodes absolute paths by replacing every '/' with '-'
  // The leading '-' corresponds to the leading '/' of an absolute path
  if (dirName.startsWith('-')) {
    return dirName.replace(/-/g, '/')
  }
  // Relative or unknown — just return as-is prefixed with /
  return '/' + dirName.replace(/-/g, '/')
}

export async function getGitFileStats(
  projectPath: string,
  afterIso: string,
  beforeIso: string
): Promise<{ linesAdded: number; linesRemoved: number; filesModified: number }> {
  const empty = { linesAdded: 0, linesRemoved: 0, filesModified: 0 }
  if (!projectPath || !afterIso || !beforeIso) return empty
  try {
    // add 1 minute buffer on each side so the commits made during the session are included
    const after = new Date(new Date(afterIso).getTime() - 60_000).toISOString()
    const before = new Date(new Date(beforeIso).getTime() + 60_000).toISOString()
    const { stdout } = await execAsync(
      `git -C "${projectPath}" log --numstat --after="${after}" --before="${before}" --format=""`,
      { timeout: 5000 }
    )
    let linesAdded = 0, linesRemoved = 0
    const filesSeen = new Set<string>()
    for (const line of stdout.split('\n')) {
      const m = line.match(/^(\d+)\s+(\d+)\s+(.+)$/)
      if (m) {
        linesAdded += parseInt(m[1]!, 10)
        linesRemoved += parseInt(m[2]!, 10)
        filesSeen.add(m[3]!)
      }
    }
    return { linesAdded, linesRemoved, filesModified: filesSeen.size }
  } catch {
    return empty
  }
}

export async function getProjectGitStats(projectPath: string): Promise<ProjectGitStats | undefined> {
  const gitEnv = { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: 'echo' }
  try {
    // Check if it's a git repo
    await execAsync(`git -C "${projectPath}" rev-parse --git-dir`, { timeout: 3000, env: gitEnv })
  } catch {
    return undefined
  }
  try {
    const { stdout } = await execAsync(
      `git -C "${projectPath}" log --numstat --format="COMMIT %H %ai" HEAD`,
      { timeout: 10000, env: gitEnv }
    )
    let commits = 0, linesAdded = 0, linesRemoved = 0
    const filesSeen = new Set<string>()
    let since = ''
    for (const line of stdout.split('\n')) {
      if (line.startsWith('COMMIT ')) {
        commits++
        const date = line.split(' ')[2]
        if (date && (!since || date < since)) since = date
      } else {
        const m = line.match(/^(\d+)\s+(\d+)\s+(.+)$/)
        if (m) {
          linesAdded += parseInt(m[1]!, 10)
          linesRemoved += parseInt(m[2]!, 10)
          filesSeen.add(m[3]!)
        }
      }
    }
    if (commits === 0) return undefined
    return { commits, lines_added: linesAdded, lines_removed: linesRemoved, files_modified: filesSeen.size, since }
  } catch {
    return undefined
  }
}
