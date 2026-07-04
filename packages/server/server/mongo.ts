import { MongoClient, type Db, type Collection } from 'mongodb'
import { MONGO_URL, MONGO_DB } from './config'
import type { TeamSessionDoc } from './team-store'

let client: MongoClient | null = null
let db: Db | null = null

/** Lazy singleton Mongo connection. Reused across requests for the process lifetime. */
export async function getMongoDb(): Promise<Db> {
  if (db) return db
  client = new MongoClient(MONGO_URL)
  await client.connect()
  db = client.db(MONGO_DB)
  return db
}

/** The team sessions collection, typed. */
export async function getTeamCollection(): Promise<Collection<TeamSessionDoc>> {
  const database = await getMongoDb()
  return database.collection<TeamSessionDoc>('sessions')
}

/** Close the connection (tests / shutdown). Safe to call when never opened. */
export async function closeMongo(): Promise<void> {
  await client?.close()
  client = null
  db = null
}
