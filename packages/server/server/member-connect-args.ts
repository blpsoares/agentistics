/**
 * member-connect-args.ts — **pure**: the argv gate for `agentop member connect`.
 *
 * It lives here rather than inline in `bin/cli.ts` because the gate ITSELF was the bug. The central
 * mints a composite token (`act1_<base64 url>.<secret>`, see `packConnectToken`) precisely so that
 * pasting one command connects a machine, and both the Machines panel and the post-rotation drawer
 * print exactly `agentop member connect --token act1_…`. The CLI meanwhile refused anything without
 * `--endpoint` — before `memberConnect`, which has always unpacked the URL out of the token, was
 * ever reached. The advertised fast path answered a usage line and exit 1.
 *
 * So the gate requires ONLY the token. Whether an endpoint can be resolved AT ALL stays where it
 * can actually be answered — `memberConnect` unpacks the token and, when neither the flag nor the
 * token carries a URL, says so in a sentence naming both ways to supply one. Two places enforcing
 * one rule is how they drift; this one just collects flags.
 */

export interface MemberConnectArgs {
  endpoint?: string
  token: string
  org?: string
  label?: string
}

export type ParsedMemberConnect =
  | { ok: true; opts: MemberConnectArgs }
  | { ok: false; usage: string }

/** The token-only form leads, because it is the one the central actually prints. */
export const MEMBER_CONNECT_USAGE =
  'Usage: agentop member connect --token <token> [--endpoint <url>] [--org <org>] [--label <name>]\n'
  + '  A token from the central carries its URL — --endpoint is only needed for a bare token.'

/** `--flag value`. A flag whose value is missing is the flag being absent — never an empty string,
 *  which downstream would read as "the user asked for an empty label". */
function readFlag(argv: string[], name: string): string | undefined {
  const idx = argv.indexOf(name)
  return idx !== -1 && argv[idx + 1] ? argv[idx + 1] : undefined
}

export function parseMemberConnectArgs(argv: string[]): ParsedMemberConnect {
  const token = readFlag(argv, '--token')
  if (!token) return { ok: false, usage: MEMBER_CONNECT_USAGE }
  return {
    ok: true,
    opts: {
      token,
      endpoint: readFlag(argv, '--endpoint'),
      org: readFlag(argv, '--org'),
      label: readFlag(argv, '--label'),
    },
  }
}
