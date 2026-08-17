/**
 * watcher-state.ts — is the OTel watcher running INSIDE this process?
 *
 * `agentop server` starts the watcher by importing `otel-watcher.ts` into its own process
 * (bin/cli.ts, `Promise.all([import('../server/index.ts'), import('../server/otel-watcher.ts')])`),
 * so in the normal case there is NO separate watcher pid to find. Scanning `/proc` for one there is
 * structurally unable to answer the question and reports a running daemon as stopped.
 *
 * A one-line module of its own rather than an export from `otel-watcher.ts`, because importing that
 * file STARTS the watcher: the probe that only wants to ask a question would launch the thing it is
 * asking about.
 */

let hosted = false

/** Called once by the watcher's `main()`. Idempotent. */
export function markOtelWatcherHosted(): void {
  hosted = true
}

/** True when the watcher is running in THIS process. Says nothing about other processes. */
export function otelWatcherHosted(): boolean {
  return hosted
}
