import { describe, expect, it } from 'bun:test'
import { decideRepoFacts } from './repo-facts'

describe('decideRepoFacts', () => {
  it('reports nothing at all outside a repository', () => {
    expect(decideRepoFacts({ remote: '', gitDir: '', commonDir: '' })).toEqual({ worktree: false })
  })

  it('names the repository by its REMOTE, which is what a worktree shares with its checkout', () => {
    // The directory names deliberately differ — that is the point of a worktree — so the remote is
    // the only key that provably identifies the two as one project.
    const main = decideRepoFacts({
      remote: 'git@github.com:blpsoares/agentistics.git',
      gitDir: '/home/d/agentistics/.git',
      commonDir: '/home/d/agentistics/.git',
    })
    const wt = decideRepoFacts({
      remote: 'https://github.com/blpsoares/agentistics',
      gitDir: '/home/d/agentistics/.git/worktrees/session-monitor',
      commonDir: '/home/d/agentistics/.git',
    })
    expect(main.repo).toBe('blpsoares/agentistics')
    expect(wt.repo).toBe('blpsoares/agentistics')
  })

  it('calls a LINKED worktree one, and the main checkout not one', () => {
    // `--git-dir` and `--git-common-dir` differ exactly inside a linked worktree. That is the
    // canonical test, and the only one that does not depend on a path convention anyone can rename.
    expect(decideRepoFacts({
      remote: '', gitDir: '/r/.git/worktrees/x', commonDir: '/r/.git',
    }).worktree).toBe(true)
    expect(decideRepoFacts({
      remote: '', gitDir: '/r/.git', commonDir: '/r/.git',
    }).worktree).toBe(false)
  })

  it('falls back to the MAIN checkout folder when there is no remote', () => {
    // `--show-toplevel` would answer with the worktree's own directory, which is exactly the name
    // that must not become the grouping key.
    expect(decideRepoFacts({
      remote: '', gitDir: '/home/d/agentistics/.git/worktrees/session-monitor',
      commonDir: '/home/d/agentistics/.git',
    })).toEqual({ repo: 'agentistics', worktree: true })
  })

  it('ignores a remote git cannot key on, rather than inventing a name from it', () => {
    expect(decideRepoFacts({
      remote: '/some/local/path', gitDir: '/r/.git', commonDir: '/r/.git',
    }).repo).toBe('r')
  })
})
