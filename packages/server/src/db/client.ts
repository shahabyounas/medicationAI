import { MongoClient, type Db } from 'mongodb';
import { env } from '../env.js';

let client: MongoClient | null = null;
let database: Db | null = null;

export async function connectToDatabase(uri = env.MONGODB_URI, dbName = env.MONGODB_DB): Promise<Db> {
  if (database) return database;

  client = new MongoClient(uri, {
    // Fail fast on boot rather than hanging: a developer with no Mongo running
    // should see the problem in seconds, not after a 30-second default timeout.
    serverSelectionTimeoutMS: 5_000,
  });
  await client.connect();
  database = client.db(dbName);
  return database;
}

export function getDatabase(): Db {
  if (!database) {
    throw new Error('Database not connected. Call connectToDatabase() during startup.');
  }
  return database;
}

export async function closeDatabase(): Promise<void> {
  await client?.close();
  client = null;
  database = null;
}
