/** PURE: the session-activity rules every harness shares.
 *
 *  These two rules used to live inside `jsonl.ts`, the Claude transcript parser — a 400-line file no
 *  adapter could reuse without copying, and a copied rule is a rule that drifts. That is why
 *  `git_commits` was hardcoded to 0 in every non-Claude adapter: not because the data was missing,
 *  but because the rule was not reachable. */
import type { HarnessId } from '@agentistics/core'

/** How many git commits and pushes a shell command line performs.
 *
 *  A command line is a CHAIN — `git add -A && git commit && git push` is three commands — so it is
 *  split on the shell's separators and each segment judged on its own.
 *
 *  `(?![\w-])` rather than the `\b` the original rule used: `\b` matches between `t` and `-`, so
 *  `git commit-tree` (plumbing, writes no commit) counted as one. Rare enough that no real total
 *  moves, wrong enough that it should not be carried into five more harnesses. */
export function countGitCommands(cmd: string): { commits: number; pushes: number } {
  let commits = 0, pushes = 0
  for (const seg of cmd.split(/&&|\|\||;|\n/)) {
    const s = seg.trim()
    // The optional `cd … &&` prefix survives from the original rule: the split above already
    // separates that case, but a segment may still arrive whole from a caller that did not split.
    if (/^(cd\s+\S+\s+&&\s+)?git\s+commit(?![\w-])/.test(s)) commits++
    if (/^(cd\s+\S+\s+&&\s+)?git\s+push(?![\w-])/.test(s)) pushes++
  }
  return { commits, pushes }
}

/**
 * Each harness's own tool name → the shared name.
 *
 * The tools breakdown compares harnesses; it cannot do that while one calls it `Bash`, another
 * `exec_command` and a third `RUN_COMMAND`. Claude's names are the shared vocabulary because they
 * are already what every chart, label and filter in the product is written against.
 *
 * It is a MAPPING, not an interpretation: a name nobody has mapped passes through unchanged rather
 * than being dropped or bucketed as "other". A new tool should show up as itself and be noticed.
 */
const TOOL_ALIASES: Record<string, string> = {
  // shell
  exec_command: 'Bash',
  local_shell_call: 'Bash',
  shell: 'Bash',
  bash: 'Bash',
  run_shell_command: 'Bash',
  run_command: 'Bash',
  RUN_COMMAND: 'Bash',
  // read
  view: 'Read',
  read_file: 'Read',
  read_many_files: 'Read',
  view_file: 'Read',
  // write / edit
  write_to_file: 'Write',
  write_file: 'Write',
  create_file: 'Write',
  replace_file_content: 'Edit',
  multi_replace_file_content: 'Edit',
  str_replace: 'Edit',
  edit_file: 'Edit',
  replace: 'Edit',
  // search
  grep_search: 'Grep',
  search_file_content: 'Grep',
  glob_file_search: 'Glob',
  find_files: 'Glob',
  list_dir: 'Glob',
}

/** The shared name for a harness's tool, or the name itself when nothing maps it. */
export function canonicalTool(_harness: HarnessId, name: string): string {
  return TOOL_ALIASES[name] ?? name
}
