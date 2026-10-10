import { migrate } from "@constant/db";
import { fromEnv } from "./config.js";
import { processOrders, recover, scanRenewals, sendNotices, type Deps } from "./jobs.js";
import { jsonLog } from "./log.js";

const log = jsonLog("worker");
const deps: Deps = { ...fromEnv(), log, now: () => new Date() };
let stopping = false;

/** Runs `fn` every `ms`, never overlapping itself, until shutdown. */
async function every(name: string, ms: number, fn: () => Promise<unknown>) {
  while (!stopping) {
    const started = Date.now();
    try {
      await fn();
    } catch (err) {
      log.error(`${name} failed`, { err: (err as Error).message });
    }
    // Sleep in short steps so a shutdown signal is honoured within a second.
    while (!stopping && Date.now() - started < ms) await new Promise((r) => setTimeout(r, Math.min(1000, ms)));
  }
}

async function main() {
  await migrate(deps.db, (m) => log.info(m));
  await recover(deps);
  log.info("worker started", { vending: deps.vending.name });
  await Promise.all([
    every("renewal scan", 5 * 60_000, () => scanRenewals(deps)),
    every("orders", 10_000, () => processOrders(deps)),
    every("notices", 10_000, () => sendNotices(deps)),
  ]);
  await deps.db.end();
  log.info("worker stopped");
}

for (const sig of ["SIGTERM", "SIGINT"] as const) process.on(sig, () => (stopping = true));
main().catch((err) => {
  log.error("worker crashed", { err: (err as Error).message });
  process.exit(1);
});
