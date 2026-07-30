// preferences.lock-test-child.ts — spawned as a SEPARATE OS process by preferences.test.ts's
// cross-process lock test. Never imported by production code and never spawned in production —
// it exists ONLY to prove `acquireFileLock` (in preferences.ts) serializes a read-modify-write
// against a writer running in ANOTHER process, which `enqueueWrite`'s in-process chain cannot do
// (a second `bun` process has its own, independent `_writeChain`).
//
// Usage: bun run preferences.lock-test-child.ts <primary> <legacy> <prefix4hex> <count>
// Performs <count> SEQUENTIAL updateTeamConfigAt calls against the given preferences file pair,
// each appending one connection with a distinct id `c_<prefix4hex><i as 8 hex>` (exactly 12 hex
// chars after `c_`, matching @agentistics/core's ID_RE, so migrateTeamConfig never regenerates it
// out from under the test's ability to count survivors by prefix) AND a distinct endpoint — the
// endpoint is `connections[]`'s uniqueness key (see TeamConnection's own doc comment in
// core/src/team.ts), so migrateTeamConfig legitimately DEDUPES same-endpoint entries down to one;
// reusing one endpoint here would look exactly like a lost-update bug in the lock, when it is
// actually this fixture violating the schema's own invariant.

import { updateTeamConfigAt } from '../../server/preferences'

async function main(): Promise<void> {
  const [primary, legacy, prefix, countStr] = process.argv.slice(2)
  if (!primary || !legacy || !prefix || !countStr || prefix.length !== 4) {
    process.stderr.write('usage: bun run preferences.lock-test-child.ts <primary> <legacy> <prefix4hex> <count>\n')
    process.exit(1)
  }
  const count = Number(countStr)
  for (let i = 0; i < count; i++) {
    await updateTeamConfigAt(primary, legacy, (current) => ({
      ...current,
      connections: [
        ...current.connections,
        {
          id: `c_${prefix}${i.toString(16).padStart(8, '0')}`,
          endpoint: `http://127.0.0.1:1/${prefix}${i}`,
          org: 'default',
          user: '',
          token: '',
          deniedRepos: [],
        },
      ],
    }))
  }
}

main()
