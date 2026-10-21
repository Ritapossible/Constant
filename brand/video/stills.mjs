// Renders single frames at the given seconds for review: node stills.mjs 4 9 20 …
import { chromium } from "/opt/node22/lib/node_modules/playwright/index.mjs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const dir = path.dirname(fileURLToPath(import.meta.url));
const out = process.env.STILLS_OUT ?? path.join(dir, "out");
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
const errors = [];
p.on("pageerror", (e) => errors.push(e.message));
await p.goto(pathToFileURL(path.join(dir, "video.html")).href);
await p.evaluate(() => document.fonts.ready);
for (const s of process.argv.slice(2).map(Number)) {
  await p.evaluate((t) => window.seek(t), s);
  await p.screenshot({ path: path.join(out, `still-${String(s).padStart(5, "0")}.jpg`), type: "jpeg", quality: 80 });
}
if (errors.length) console.log("ERRORS", errors);
await b.close();
