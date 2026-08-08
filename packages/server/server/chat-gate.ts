/** PURE: may this machine serve the chat?
 *
 *  Chat spawns an assistant CLI on the host. It is the most powerful thing this server does, and
 *  until now it was on by default anywhere the exposure profile permitted it — so a machine
 *  installed for its metrics also shipped a shell, without anyone choosing that.
 *
 *  Two gates, and the order between them is the whole point:
 *  - `capable` is `CAPS.localChat`, decided by the exposure profile in `exposure.ts`. It is the
 *    SECURITY answer.
 *  - `preference` is the user's own switch, and it may only ever NARROW. A preference that could
 *    re-enable what `public` denied would be an opt-in that restores host power on an exposed
 *    instance, which `exposure.ts` exists to make impossible.
 *
 *  Absent preference reads as OFF. This is deliberately not the "absent means the old default"
 *  migration `shareMode` uses: there, treating absence as anything else would silently invert live
 *  sharing rules; here, treating absence as ON would keep the shell open on every machine that has
 *  not been touched since the upgrade, which is the very thing being fixed. The cost of the strict
 *  reading is a switch to flip in Settings, and the cost of the lenient one is a shell nobody
 *  asked for. */
export function chatAllowed(capable: boolean, preference: boolean | undefined): boolean {
  return capable && preference === true
}
