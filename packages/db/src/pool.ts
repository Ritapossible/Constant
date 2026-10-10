import pg from "pg";

// int8 → bigint everywhere. Money must never pass through a JS number.
pg.types.setTypeParser(20, (v) => BigInt(v));

export type Db = pg.Pool;
export type Tx = pg.PoolClient;
/** Anything that can run a query: the pool or a client inside a transaction. */
export type Q = Pick<pg.Pool, "query"> | Pick<pg.PoolClient, "query">;

export function createPool(connectionString: string, max = 10): Db {
  const pool = new pg.Pool({ connectionString, max });
  // An idle client dropped by the server (restart, failover) must not crash the process; the pool replaces it.
  pool.on("error", (err) => console.error(JSON.stringify({ level: "error", msg: "postgres idle client error", code: (err as { code?: string }).code })));
  return pool;
}

/**
 * Run `fn` in one transaction. Commits if it returns, rolls back if it throws.
 * Serialization failures and deadlocks are retried a few times: they mean "try again", not "wrong".
 */
export async function withTx<T>(db: Db, fn: (tx: Tx) => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      const out = await fn(client);
      await client.query("COMMIT");
      return out;
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      const code = (err as { code?: string }).code;
      if ((code === "40001" || code === "40P01") && attempt < 4) continue;
      throw err;
    } finally {
      client.release();
    }
  }
}
