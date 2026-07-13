import { test, expect } from 'bun:test'
import { pidsToKill } from './cli-start'

// Regression for the "kill and restart" self-termination bug: the CLI health check
// (`isServerRunning` → fetch to PORT) leaves a keep-alive client socket open, so
// `lsof -ti tcp:PORT` returns BOTH the server pid AND the CLI's own pid. Killing the
// full list SIGTERM'd the CLI itself ("Terminated") before it could restart the server.
// pidsToKill must never include the caller's own pid.

test('pidsToKill excludes the caller own pid', () => {
  // server pid 172382 + CLI own pid 175302 (as observed via lsof)
  expect(pidsToKill('172382\n175302', 175302)).toEqual(['172382'])
})

test('pidsToKill keeps all other pids and trims blanks', () => {
  expect(pidsToKill('  100 \n 200 \n\n300 ', 999)).toEqual(['100', '200', '300'])
})

test('pidsToKill returns empty when only own pid is present', () => {
  expect(pidsToKill('4242', 4242)).toEqual([])
})

test('pidsToKill handles empty lsof output', () => {
  expect(pidsToKill('', 123)).toEqual([])
})
