import { createClient } from "@libsql/client";

const url = process.env.TURSO_DATABASE_URL;
const token = process.env.TURSO_AUTH_TOKEN;
if (!url || !token) throw new Error("TURSO_DATABASE_URL and TURSO_AUTH_TOKEN must be set");

export const db = createClient({ url, authToken: token });

export async function initDb() {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS stats (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      visits INTEGER NOT NULL DEFAULT 0,
      total_playtime_seconds INTEGER NOT NULL DEFAULT 0
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS sessions (
      session_id TEXT PRIMARY KEY,
      started_at INTEGER NOT NULL,
      last_seen_at INTEGER NOT NULL
    )
  `);

  await db.execute(
    `INSERT OR IGNORE INTO stats (id, visits, total_playtime_seconds) VALUES (1, 0, 0)`
  );
}
