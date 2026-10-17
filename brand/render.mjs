#!/usr/bin/env node
/**
 * Renders the brand images at exact pixel sizes from src/*.html with the site's fonts (Inter Tight, Instrument Serif).
 *   node brand/render.mjs     (needs Playwright's Chromium; output in brand/out)
 */
import { chromium } from "/opt/node22/lib/node_modules/playwright/index.mjs";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(dir, "out");
mkdirSync(out, { recursive: true });
const JOBS = [
  // X (Twitter): profile photo 400×400 (shown as a circle), header 1500×500.
  { src: "avatar.html", w: 400, h: 400, file: "x-profile-400.png" },
  { src: "avatar.html", w: 400, h: 400, file: "x-profile-400-light.png", vars: { "--bg": "#fafafa", "--fg": "#0a0a0a" } },
  { src: "header.html", w: 1500, h: 500, file: "x-header-1500x500.png" },
  // Square icon for other places (LinkedIn, app stores later, favicons).
  { src: "avatar.html", w: 400, h: 400, scale: 2.56, file: "icon-1024.png" },
  // Logo with the name, on transparent: dark for light backgrounds, light for dark ones.
  { src: "wordmark.html", w: 1200, h: 300, scale: 2, file: "logo-dark-2400x600.png", transparent: true },
  { src: "wordmark.html", w: 1200, h: 300, scale: 2, file: "logo-light-2400x600.png", transparent: true, vars: { "--fg": "#fafafa", "--bg": "#0a0a0a" } },
];
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
for (const j of JOBS) {
  const page = await browser.newPage({ viewport: { width: j.w, height: j.h }, deviceScaleFactor: j.scale ?? 1 });
  await page.goto(pathToFileURL(path.join(dir, "src", j.src)).href);
  if (j.vars) await page.evaluate((v) => Object.entries(v).forEach(([k, x]) => document.documentElement.style.setProperty(k, x)), j.vars);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: path.join(out, j.file), omitBackground: Boolean(j.transparent) });
  await page.close();
  console.log(j.file);
}
await browser.close();
