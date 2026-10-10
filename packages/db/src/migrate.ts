import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { Db } from "./pool.js";

const DIR = fileURLToPath(new URL("../migrations/", import.meta.url));

/** Applies every migrations/*.sql not yet applied, in name order, each in its own transaction. */
export async function migrate(db: Db, log: (msg: string) => void = () => undefined): Promise<string[]> {
  const client = await db.connect();
  try {
    // One migrator at a time across processes.
    await client.query("SELECT pg_advisory_lock(727001)");
    await client.query("CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
    const done = new Set((await client.query<{ name: string }>("SELECT name FROM schema_migrations")).rows.map((r) => r.name));
    const files = (await readdir(DIR)).filter((f) => f.endsWith(".sql")).sort();
    const applied: string[] = [];
    for (const f of files) {
      if (done.has(f)) continue;
      const sql = await readFile(DIR + f, "utf8");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [f]);
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        throw new Error(`migration ${f} failed: ${(err as Error).message}`);
      }
      log(`applied ${f}`);
      applied.push(f);
    }
    return applied;
  } finally {
    await client.query("SELECT pg_advisory_unlock(727001)").catch(() => undefined);
    client.release();
  }
}
