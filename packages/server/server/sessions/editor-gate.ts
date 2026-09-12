/**
 * editor-gate.ts — PURE: may this machine serve the repository explorer's read+write routes?
 *
 * Filesystem read+write+create+delete over an arbitrary subtree is at least as powerful as the
 * per-session shell — arguably more directly dangerous, since it needs no command execution at
 * all to do damage. It gets the SAME two-gate model `shell-gate.ts` already established, not a
 * weaker one:
 *
 *  - `capable` is `CAPS.localShell`, decided by the exposure profile in `exposure.ts`. This is
 *    deliberately the SAME capability the shell rides, not a new one — the spec is explicit that
 *    there is no deployment that should expose a shell but not this.
 *  - `preference` is the user's own switch (`Preferences.editorEnabled`), and it may only ever
 *    NARROW `capable`. Absent reads as OFF, for the same reason `shellAllowed` gives: treating
 *    absence as ON would open a read/write file editor in the browser of every machine nobody has
 *    touched since the upgrade.
 *
 * It is a SEPARATE switch from `shellEnabled`, not a reuse of it: a person who wants a shell has
 * not thereby asked for a file editor, or vice versa — folding two distinct grants into one switch
 * is exactly the trap `chat-gate.ts`'s header warns about.
 */
export function editorAllowed(capable: boolean, preference: boolean | undefined): boolean {
  return capable && preference === true
}
