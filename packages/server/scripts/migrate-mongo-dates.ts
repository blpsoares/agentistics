#!/usr/bin/env bun
/**
 * migrate-mongo-dates.ts — one-shot repair of dates stored as STRINGS in Mongo.
 *
 * The central runs the same migration at boot (see index.ts), so this script exists for the
 * cases where that is not enough: repairing a database without restarting the service, pointing
 * at a different deployment, or inspecting the damage before touching anything.
 *
 * Usage:
 *   bun packages/server/scripts/migrate-mongo-dates.ts                 # DRY RUN (default)
 *   bun packages/server/scripts/migrate-mongo-dates.ts --apply         # actually convert
 *   MONGO_URL=... MONGO_DB=... bun ... --apply                         # target another deployment
 *
 * It is a dry run unless `--apply` is passed — reporting what would change is the safe default
 * for a script whose whole job is rewriting production documents in place.
 *
 * Idempotent: only documents whose field is still `$type: 'string'` are touched. A value that
 * cannot be parsed as a date is deliberately LEFT AS A STRING and counted in the report, rather
 * than being nulled — losing a real timestamp to tidy up a schema is a worse outcome than a
 * leftover row a human can look at.
 */

import { MongoClient } from 'mongodb'
import { migrateStringDatesToBson } from '../server/mongo-dates'

const MONGO_URL = (process.env.MONGO_URL ?? 'mongodb://localhost:27017').trim()
const MONGO_DB = (process.env.MONGO_DB ?? 'agentistics').trim()

const apply = process.argv.includes('--apply')
const dryRun = !apply

/** Hide credentials before printing a connection string. */
function redact(url: string): string {
  return url.replace(/\/\/([^@/]+)@/, '//***@')
}

const client = new MongoClient(MONGO_URL)
try {
  await client.connect()
  const db = client.db(MONGO_DB)

  console.log(`\n[mongo-dates] ${redact(MONGO_URL)} → db "${MONGO_DB}"`)
  console.log(`[mongo-dates] mode: ${dryRun ? 'DRY RUN (pass --apply to write)' : 'APPLY'}\n`)

  // force: a human running this by hand wants a real scan, not the boot marker's word for it.
  const results = await migrateStringDatesToBson(db, { dryRun, force: true, log: m => console.log(m) })

  if (results.length === 0) {
    console.log('\n[mongo-dates] nothing to do — every stored date is already a BSON Date.\n')
  } else {
    const found = results.reduce((n, r) => n + r.stringsBefore, 0)
    const converted = results.reduce((n, r) => n + r.converted, 0)
    const stuck = results.reduce((n, r) => n + r.unconvertible, 0)
    console.log('')
    if (dryRun) {
      console.log(`[mongo-dates] ${found} document-field(s) hold a string date. Re-run with --apply to convert.`)
    } else {
      console.log(`[mongo-dates] converted ${converted} of ${found} string date(s).`)
      if (stuck > 0) {
        console.log(`[mongo-dates] ${stuck} value(s) could not be parsed as a date and were LEFT AS STRINGS:`)
        for (const r of results.filter(r => r.unconvertible > 0)) {
          console.log(`  - ${r.collection}.${r.field}: ${r.unconvertible}`)
        }
        console.log('[mongo-dates] inspect those before deciding what they should be.')
      }
    }
    console.log('')
  }
} catch (e) {
  console.error('[mongo-dates] failed:', e instanceof Error ? e.message : e)
  process.exitCode = 1
} finally {
  await client.close()
}
