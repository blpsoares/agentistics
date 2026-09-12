/**
 * unsavedLeave.ts — the pure half of asking before the Sessions page drops unsaved Studio buffers.
 *
 * `unsavedBuffers.ts` holds WHAT is unsaved and the pending question; this holds the two decisions
 * around it that are easy to get subtly wrong, and the words.
 *
 * WHY THE NAVIGATOR IS WRAPPED. The app mounts a `BrowserRouter`, not a data router, so
 * `useBlocker` is not available (it throws outside one). Every in-app navigation — a `SideNav`
 * link, the bottom nav, a `navigate()` from a menu, a session row — reaches the history object
 * through `navigator.push` / `navigator.replace`, looked up at CALL time, so wrapping those two is
 * the one place all of them pass. What it cannot see is stated rather than discovered: the
 * browser's own Back/Forward (a `popstate` has already moved the URL by the time anything hears
 * it) and `navigate(-1)` (`go`, whose destination is unknown; nothing in this app calls it). A
 * reload, a closed tab and an external link are the `beforeunload` half, in the guard component.
 */

import type { DropCause } from './unsavedBuffers'

/**
 * Whether a navigation to `pathname` leaves the Studio MOUNTED — i.e. it is the same session's own
 * page, differing at most in query or hash (`?view=` is the Chat/Terminal switch, and changes
 * nothing about the pane). `keys` are every id the open session answers to: a row is named by its
 * managed id and by its conversation id, and a link may carry either.
 *
 * `/sessions/<id>/terminal` is NOT the same page: the dedicated terminal is an early return that
 * renders no pane at all, so going there unmounts the Studio as surely as leaving.
 */
export function navigationKeepsStudio(pathname: string, keys: readonly string[]): boolean {
  const m = /^\/sessions\/([^/]+)\/?$/.exec(pathname)
  if (m === null) return false
  let id: string
  try { id = decodeURIComponent(m[1]!) } catch { return false }
  return keys.includes(id)
}

/** The pathname a `navigator.push`/`replace` target names — a resolved path object or a string. */
export function pathnameOf(to: unknown, current: string): string {
  if (typeof to === 'string') {
    const cut = to.split(/[?#]/)[0]!
    return cut === '' ? current : cut
  }
  if (typeof to === 'object' && to !== null && typeof (to as { pathname?: unknown }).pathname === 'string') {
    const p = (to as { pathname: string }).pathname
    return p === '' ? current : p
  }
  return current
}

export interface GuardableNavigator {
  push: (...args: never[]) => void
  replace: (...args: never[]) => void
}

/**
 * Wraps `push` and `replace` so a navigation `hold` claims is handed to `onHold` with a function
 * that performs it later through the ORIGINAL method — so proceeding can never be held a second
 * time by its own guard. `restore` puts the originals back, and only if nothing has wrapped the
 * navigator again since (a restore that clobbered a newer wrapper would silently disarm it).
 */
export function guardNavigator(
  nav: GuardableNavigator,
  hold: (to: unknown) => boolean,
  onHold: (proceed: () => void) => boolean,
): () => void {
  const originals = { push: nav.push, replace: nav.replace }
  const wrap = (method: 'push' | 'replace') => (...args: never[]) => {
    const original = originals[method]
    const run = () => { original.apply(nav, args) }
    // `onHold` answers whether it really held (nothing unsaved means it did not), so a guard that is
    // armed a render late can never swallow a navigation.
    if (hold(args[0]) && onHold(run)) return
    run()
  }
  const wrapped = { push: wrap('push'), replace: wrap('replace') }
  nav.push = wrapped.push
  nav.replace = wrapped.replace
  return () => {
    if (nav.push === wrapped.push) nav.push = originals.push
    if (nav.replace === wrapped.replace) nav.replace = originals.replace
  }
}

export interface UnsavedLeaveText {
  title: string
  message: string
  confirm: string
  cancel: string
}

/**
 * The question, for N files. Same shape and the same "keep editing" as the Studio's own one-tab
 * question (`Studio.tsx`), raised for the panel. The files are NAMED (up to three, then a count): a
 * reader who has forgotten which buffer is dirty cannot decide whether it matters from a number.
 */
export function unsavedLeaveText(
  files: readonly string[], cause: DropCause, lang: 'pt' | 'en',
): UnsavedLeaveText {
  const n = files.length
  const shown = files.slice(0, 3).map(f => f.split('/').pop() || f)
  const more = n > shown.length ? (lang === 'pt' ? ` e mais ${n - shown.length}` : ` and ${n - shown.length} more`)
    : ''
  const names = `${shown.join(', ')}${more}`
  if (lang === 'pt') {
    const what = n === 1
      ? `1 arquivo no Studio tem mudanças que não foram salvas (${names}).`
      : `${n} arquivos no Studio têm mudanças que não foram salvas (${names}).`
    return {
      title: 'Descartar mudanças não salvas?',
      message: cause === 'close'
        ? `${what} Fechar o painel descarta o que ainda não foi salvo.`
        : `${what} Sair desta sessão descarta o que ainda não foi salvo.`,
      confirm: cause === 'close' ? 'Fechar mesmo assim' : 'Sair mesmo assim',
      cancel: 'Continuar editando',
    }
  }
  const what = n === 1
    ? `1 file in the Studio has changes that have not been saved (${names}).`
    : `${n} files in the Studio have changes that have not been saved (${names}).`
  return {
    title: 'Discard unsaved changes?',
    message: cause === 'close'
      ? `${what} Closing the panel discards what has not been saved.`
      : `${what} Leaving this session discards what has not been saved.`,
    confirm: cause === 'close' ? 'Close anyway' : 'Leave anyway',
    cancel: 'Keep editing',
  }
}
