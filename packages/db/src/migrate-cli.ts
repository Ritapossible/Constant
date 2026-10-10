import { migrate } from "./migrate.js";
import { createPool } from "./pool.js";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}
const db = createPool(url, 1);
migrate(db, (m) => console.log(m))
  .then((a) => console.log(a.length ? `done (${a.length})` : "up to date"))
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.end());
