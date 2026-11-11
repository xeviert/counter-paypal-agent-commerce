// Records maker-app runs at Pixel 9a width on the Render URL, for beats 4–6.
//   node video/tools/record-phone.mjs <run> [--order <id>] [--carrier DHL --tracking <n>]
// Runs: inbox (beat 4), ship (beat 5, adds tracking: real sandbox action), released (beat 5 end),
//       copilot (beat 6, typed question), probe (read-only test).
// Output: video/assets/clips/raw/<run>-<timestamp>.webm
import { chromium } from "playwright";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const BASE = process.env.COUNTER_URL ?? "https://counter-2cdt.onrender.com";
const MAKER = process.env.MAKER_NAME ?? "Lucía Hernández";
const args = process.argv.slice(2);
const run = args[0] ?? "probe";
// The buyer page is a desktop scene; everything else is the maker's phone.
const DESKTOP = ["buyer", "ops", "dashboard"].includes(run);
const VIEW = DESKTOP ? { width: 1280, height: 720 } : { width: 412, height: 915 };
const SCALE = DESKTOP ? 1.5 : 2;
const opt = (k) => {
  const i = args.indexOf(`--${k}`);
  return i > -1 ? args[i + 1] : undefined;
};

const outDir = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, "$1")), "../assets/clips/raw");
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ channel: "chromium" });

// Sign in off camera so the take starts on the app, not the login screen.
const auth = await browser.newContext({ viewport: VIEW, deviceScaleFactor: SCALE, isMobile: true, hasTouch: true, locale: "es-MX" });
const login = await auth.newPage();
if (run === "ops") {
  // OPS_PASSWORD comes from the repo's .env and never reaches the recording.
  const env = fs.readFileSync(path.resolve(outDir, "../../../../.env"), "utf8");
  const pw = env.match(/^OPS_PASSWORD=(.*)$/m)?.[1].trim().replace(/^["']|["']$/g, "");
  await login.goto(`${BASE}/ops/login`, { waitUntil: "networkidle" });
  await login.locator('input[name="password"]').fill(pw);
  await login.locator('button[type="submit"]').click();
  await login.waitForURL((u) => !u.pathname.startsWith("/ops/login"), { timeout: 60000 });
} else {
  await login.goto(`${BASE}/s/login`, { waitUntil: "networkidle" });
  await login.getByRole("button", { name: new RegExp(MAKER) }).first().click();
  await login.waitForURL((u) => !u.pathname.startsWith("/s/login"), { timeout: 60000 });
}
const state = await auth.storageState();
await auth.close();

const ctx = await browser.newContext({
  viewport: VIEW,
  deviceScaleFactor: SCALE,
  isMobile: !DESKTOP,
  hasTouch: true,
  locale: "es-MX",
  storageState: state,
});
const page = await ctx.newPage();

// recordVideo and Page.startScreencast both capture at 1x here; a screenshot loop keeps
// device pixels at the cost of frame rate.
const FPS = 30;
const frames = [];
const cdp = await ctx.newCDPSession(page);
let capturing = true;
const grabber = (async () => {
  while (capturing) {
    const t = Date.now() / 1000;
    // A capture during navigation can stall; drop it rather than wait.
    const r = await Promise.race([
      cdp.send("Page.captureScreenshot", { format: "jpeg", quality: 90, optimizeForSpeed: true, clip: { x: 0, y: 0, ...VIEW, scale: SCALE } }).catch(() => null),
      new Promise((res) => setTimeout(() => res(null), 400)),
    ]);
    if (r) frames.push({ t, data: Buffer.from(r.data, "base64") });
    else await new Promise((res) => setTimeout(res, 50));
  }
})();
const beat = (ms) => page.waitForTimeout(ms);
const tap = async (locator) => {
  await locator.scrollIntoViewIfNeeded();
  await beat(500);
  await locator.tap();
};

async function openOrder() {
  const id = opt("order");
  if (id) {
    await page.goto(`${BASE}/s/orders/${id}`, { waitUntil: "networkidle" });
    return;
  }
  await page.goto(`${BASE}/s/orders`, { waitUntil: "networkidle" });
  await beat(1200);
  const ref = opt("ref");
  const link = ref ? page.locator('a[href^="/s/orders/"]', { hasText: ref }) : page.locator('a[href^="/s/orders/"]');
  await tap(link.first());
  await page.waitForLoadState("networkidle");
}

if (run === "probe") {
  await page.goto(`${BASE}/s`, { waitUntil: "networkidle" });
  await beat(1500);
  await page.goto(`${BASE}/s/inbox`, { waitUntil: "networkidle" });
  await beat(2000);
  await openOrder();
  await beat(2500);
  await page.mouse.wheel(0, 500);
  await beat(2000);
} else if (run === "inbox") {
  await page.goto(`${BASE}/s`, { waitUntil: "networkidle" });
  await beat(1500);
  await tap(page.locator('a[href="/s/inbox"]').first());
  await page.waitForLoadState("networkidle");
  await beat(2000);
  await tap(page.locator('main a[href^="/s/orders/"]').first());
  await page.waitForLoadState("networkidle");
  await beat(3000);
  await page.mouse.wheel(0, 400);
  await beat(2500);
} else if (run === "ship") {
  await openOrder();
  await beat(2000);
  const carrier = opt("carrier") ?? "DHL";
  const tracking = opt("tracking") ?? "1234567890";
  const carrierField = page.locator('select[name="carrier"]');
  if (await carrierField.evaluate((el) => el.tagName === "SELECT").catch(() => false)) {
    await carrierField.selectOption({ label: carrier }).catch(() => carrierField.selectOption(carrier));
  } else {
    await tap(carrierField);
    await carrierField.pressSequentially(carrier, { delay: 90 });
  }
  await beat(600);
  const trackingField = page.locator('input[name="trackingNumber"]');
  await tap(trackingField);
  await trackingField.pressSequentially(tracking, { delay: 90 });
  await beat(800);
  await tap(page.getByRole("button", { name: /Enviar a PayPal/ }));
  await page.waitForLoadState("networkidle");
  await beat(3000);
} else if (run === "buyer") {
  // The buyer's order page from the agent's checkout reply; confirming releases the funds.
  await page.goto(`${BASE}/o/${opt("token")}`, { waitUntil: "networkidle" });
  await beat(2000);
  await tap(page.getByRole("button", { name: "I received it" }));
  await beat(1500);
  await tap(page.getByRole("button", { name: "Yes, it arrived" }));
  await page.getByText(/Released|Paid to the maker|released/i).first().waitFor({ timeout: 60000 }).catch(() => {});
  await page.reload({ waitUntil: "networkidle" });
  await beat(3000);
} else if (run === "ops") {
  await page.goto(`${BASE}/ops/events?type=mcp.make_offer&product=${opt("product")}`, { waitUntil: "networkidle" });
  await beat(1500);
  await page.getByText("Agent's message (untrusted)").first().scrollIntoViewIfNeeded();
  await beat(3500);
} else if (run === "dashboard") {
  // AG Studio report: the payout timeline on Ventas, then a chart from an AI prompt starter.
  await page.goto(`${BASE}/s/dashboard`, { waitUntil: "networkidle" });
  await beat(6000);
  if (args.includes("--reset")) {
    // Lucía's saved layout predates the payout timeline; the default report has it.
    await page.getByRole("button", { name: "Restablecer panel" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Restablecer panel" }).click();
    await beat(5000);
  }
  const timeline = page.getByText("Cuándo te pagan").first();
  await timeline.scrollIntoViewIfNeeded().catch(() => {});
  await beat(5000);
  await page.mouse.wheel(0, -3000);
  await beat(1500);
  await page.getByRole("button", { name: "Editar y preguntar a la IA" }).click();
  await beat(2500);
  await page.getByText("Ventas por país", { exact: true }).first().click();
  await beat(40000);
} else if (run === "released") {
  await openOrder();
  await beat(3500);
} else if (run === "copilot") {
  const question = opt("q") ?? "¿Quién compró hoy?";
  await page.goto(`${BASE}/s/copilot`, { waitUntil: "networkidle" });
  await beat(1500);
  const box = page.getByRole("textbox").first();
  await tap(box);
  await box.pressSequentially(question, { delay: 80 });
  await beat(500);
  await box.press("Enter");
  await page.waitForResponse((r) => r.url().includes("/copilot") || r.url().includes("/api/"), { timeout: 60000 }).catch(() => {});
  await beat(12000);
} else {
  console.error(`Unknown run: ${run}`);
}

capturing = false;
await Promise.race([grabber, new Promise((r) => setTimeout(r, 1000))]);
const endT = Date.now() / 1000;
await ctx.close();
await browser.close();

// Screencast frames arrive only when the page repaints; hold each one until the next.
const ffmpeg = (() => {
  const root = path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), ".cache"), "ms-playwright");
  const dir = fs.readdirSync(root).filter((d) => d.startsWith("ffmpeg-")).sort().pop();
  const bin = fs.readdirSync(path.join(root, dir)).find((f) => f.startsWith("ffmpeg"));
  return path.join(root, dir, bin);
})();
const out = path.join(outDir, `${run}-${Date.now()}.webm`);
// Playwright's ffmpeg build has no pipe protocol: write one MJPEG stream file, then encode it.
const stream = path.join(os.tmpdir(), `counter-${run}-${Date.now()}.mjpeg`);
const fd = fs.openSync(stream, "w");
const t0 = frames[0].t;
const total = Math.ceil((endT - t0) * FPS);
let fi = 0;
for (let n = 0; n < total; n++) {
  const t = t0 + n / FPS;
  while (fi + 1 < frames.length && frames[fi + 1].t <= t) fi++;
  fs.writeSync(fd, frames[fi].data);
}
fs.closeSync(fd);
const enc = spawn(
  ffmpeg,
  ["-loglevel", "error", "-y", "-f", "image2pipe", "-c:v", "mjpeg", "-framerate", String(FPS), "-i", stream,
   "-c:v", "libvpx-vp9", "-b:v", "0", "-crf", "24", "-row-mt", "1", "-deadline", "good", "-cpu-used", "4",
   "-pix_fmt", "yuv420p", out],
  { stdio: "inherit" },
);
await new Promise((r) => enc.on("close", r));
fs.rmSync(stream);
console.log(out, `${(total / FPS).toFixed(1)}s, ${frames.length} frames`);
