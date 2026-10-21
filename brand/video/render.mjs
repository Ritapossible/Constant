// Renders video.html to out/constantunits-intro.mp4: every frame through Chromium, piped to ffmpeg, with the
// soundtrack from music.py.  python3 music.py out/music.wav && node render.mjs
import { chromium } from "/opt/node22/lib/node_modules/playwright/index.mjs";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const FFMPEG = process.env.FFMPEG ?? "ffmpeg";
const FPS = 30;
const out = path.join(dir, "out", "constantunits-intro.mp4");

const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
const errors = [];
p.on("pageerror", (e) => errors.push(e.message));
await p.goto(pathToFileURL(path.join(dir, "video.html")).href);
await p.evaluate(() => document.fonts.ready);
const duration = await p.evaluate(() => window.DURATION ?? 72);
const frames = Math.round(duration * FPS);

const ff = spawn(FFMPEG, [
  "-y", "-loglevel", "error",
  "-f", "image2pipe", "-framerate", String(FPS), "-c:v", "mjpeg", "-i", "-",
  "-i", path.join(dir, "out", "music.wav"),
  "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-pix_fmt", "yuv420p", "-profile:v", "high",
  "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart", out,
], { stdio: ["pipe", "inherit", "inherit"] });

for (let i = 0; i < frames; i++) {
  await p.evaluate((t) => window.seek(t), i / FPS);
  const jpg = await p.screenshot({ type: "jpeg", quality: 95 });
  if (!ff.stdin.write(jpg)) await new Promise((r) => ff.stdin.once("drain", r));
  if (i % 150 === 0) console.log(`frame ${i}/${frames}`);
}
ff.stdin.end();
await new Promise((r) => ff.on("close", r));
await b.close();
if (errors.length) console.log("ERRORS", errors);
console.log("wrote", out);
