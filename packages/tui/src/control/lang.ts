/**
 * lang.ts — the language tag used across the control center.
 *
 * Declared here rather than imported from the server: the dependency direction is
 * `server -> tui`, so `cli.ts` resolves the language (via `server/cli-lang.ts`) and passes it in.
 * The TUI never reads preferences itself.
 */

export type CliLang = 'en' | 'pt'

export function asLang(value: unknown): CliLang {
  return value === 'pt' ? 'pt' : 'en'
}
