/**
 * monacoLanguage.ts — PURE: which Monaco language id a file's own name implies.
 *
 * v1 deliberately runs Monaco with NO language services (no TypeScript/JS type-checking, no
 * inline diagnostics — see the design spec's "Deferred" list), so this mapping only has to name a
 * language Monaco's bundled Monarch grammars can tokenize for syntax highlighting; it does not
 * need to distinguish "has a language service" from "syntax only".
 *
 * Deliberately NOT `EXT_TO_LANG` (packages/server/server/jsonl.ts): that table maps extensions to
 * the DISPLAY names used in per-language usage stats (e.g. 'TypeScript', 'C++'), not to Monaco's
 * own lowercase language ids, and `packages/web/src/` may never import `packages/server/server/*`
 * (Vite would try to bundle Bun/Node APIs and fail). Where the two genuinely agree — same
 * extension, same language — this table agrees with it deliberately.
 */

const EXT_LANGUAGE: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript', mts: 'typescript', cts: 'typescript',
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  json: 'json', jsonc: 'json',
  md: 'markdown', mdx: 'markdown',
  css: 'css', scss: 'scss', less: 'less',
  html: 'html', htm: 'html',
  yml: 'yaml', yaml: 'yaml',
  py: 'python', rb: 'ruby', go: 'go', rs: 'rust',
  java: 'java', kt: 'kotlin', swift: 'swift',
  c: 'c', h: 'c', cpp: 'cpp', hpp: 'cpp', cc: 'cpp',
  cs: 'csharp', php: 'php',
  sh: 'shell', bash: 'shell', zsh: 'shell',
  sql: 'sql', xml: 'xml', toml: 'toml',
  graphql: 'graphql', vue: 'vue', svelte: 'plaintext',
}

const NAME_LANGUAGE: Record<string, string> = {
  dockerfile: 'dockerfile',
  makefile: 'makefile',
}

/**
 * Resolve a Monaco language id from a file path. Looks at the basename only (case-insensitive):
 * first a full-name match (Dockerfile, Makefile — no extension to key on), then the extension.
 * An unknown or absent extension resolves to `plaintext` — a confident wrong highlighting is
 * worse than none, so this never guesses and never returns `undefined`.
 */
export function languageForPath(path: string): string {
  const base = (path.split('/').pop() ?? path).toLowerCase()
  const byName = NAME_LANGUAGE[base]
  if (byName) return byName
  const dot = base.lastIndexOf('.')
  if (dot <= 0) return 'plaintext'
  const ext = base.slice(dot + 1)
  return EXT_LANGUAGE[ext] ?? 'plaintext'
}
