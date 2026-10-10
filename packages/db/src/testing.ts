import { randomBytes } from "node:crypto";
import { migrate } from "./migrate.js";
import { createPool, type Db } from "./pool.js";

/**
 * A fresh, migrated database for one test file, dropped afterwards.
 * Needs TEST_DATABASE_URL (or DATABASE_URL) pointing at a server where the user may CREATE DATABASE.
 */
export async function freshDatabase(): Promise<{ db: Db; url: string; drop: () => Promise<void> }> {
  const admin = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!admin) throw new Error("Set TEST_DATABASE_URL to run database tests, e.g. postgres://postgres:postgres@localhost:5432/postgres");
  const name = `constant_test_${randomBytes(6).toString("hex")}`;
  const root = createPool(admin, 1);
  await root.query(`CREATE DATABASE ${name}`);
  const u = new URL(admin);
  u.pathname = `/${name}`;
  const db = createPool(u.toString(), 20);
  await migrate(db);
  return {
    db,
    url: u.toString(),
    drop: async () => {
      await db.end();
      await root.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await root.end();
    },
  };
}

/** 32 random bytes, base64: test-only keys. */
export function testKeyB64(): string {
  return randomBytes(32).toString("base64");
}
