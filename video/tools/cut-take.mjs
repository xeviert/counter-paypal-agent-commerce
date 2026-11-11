// Builds the edit of the face-cam take: keeps the chosen transcript segments (the last clean
// attempt of each line), snaps cuts to the silences ffmpeg found, and shortens long pauses.
//   node tools/cut-take.mjs            → assets/take/edl.json + summary
// Inputs: assets/take/segments.txt (start|end| text), assets/take/silences.txt (start-end)
import fs from "node:fs";
import path from "node:path";

const dir = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, "$1")), "..");
const take = (f) => path.join(dir, "assets", "take", f);

const segments = fs
  .readFileSync(take("segments.txt"), "utf8")
  .trim()
  .split("\n")
  .map((l, i) => {
    const [s, e, text] = l.split("|");
    return { n: i + 1, start: +s, end: +e, text: text.trim() };
  });
const silences = fs
  .readFileSync(take("silences.txt"), "utf8")
  .trim()
  .split("\n")
  .map((l) => l.split("-").map(Number));

// Segment numbers from segments.txt, grouped by beat. Retakes and false starts are left out.
const BEATS = [
  { beat: 1, keep: [1, 2, 3, 4] },
  { beat: 2, keep: [5, 6, 7, 8] },
  { beat: 3, keep: [13, 14, 15, 16, 17, 18] },
  { beat: 4, keep: [20, 21, 26] },
  { beat: 5, keep: [27, 28] },
  { beat: 6, keep: [29, 30, 31] },
  { beat: 7, keep: [32, 33] },
  { beat: 8, keep: [35, 36, 37] },
  { beat: 9, keep: [39, 40] },
];
// Whisper stretches the first word over the lead-in; speech starts after the 12.68–13.03 s silence.
const START_OVERRIDE = { 1: 13.0 };
const MAX_PAUSE = 0.45;
const EDGE = 0.1;

// Speech regions = the gaps between silences.
const regions = [];
let t = 0;
for (const [s, e] of silences) {
  if (s > t + 0.05) regions.push([t, s]);
  t = Math.max(t, e);
}
const total = 296.29;
if (t < total) regions.push([t, total]);

const owner = (r) => {
  const mid = (r[0] + r[1]) / 2;
  return segments.find((s) => mid >= (START_OVERRIDE[s.n] ?? s.start) && mid < s.end + 0.05);
};

const edl = [];
for (const { beat, keep } of BEATS) {
  const kept = regions.filter((r) => {
    const o = owner(r);
    return o && keep.includes(o.n);
  });
  const ranges = [];
  for (const [a, b] of kept) {
    const last = ranges[ranges.length - 1];
    // Same line or next line in the source: keep the pause, capped.
    const adjacent = last && regions.findIndex((r) => r[0] === a) === regions.findIndex((r) => r[1] === last.srcEnd) + 1;
    if (last && adjacent && a - last.srcEnd <= MAX_PAUSE) {
      last.srcEnd = b;
      last.out = b + EDGE;
      continue;
    }
    if (last && adjacent) {
      last.out = last.srcEnd + MAX_PAUSE / 2;
      ranges.push({ in: a - MAX_PAUSE / 2, srcEnd: b, out: b + EDGE });
      continue;
    }
    if (last) last.out = last.srcEnd + EDGE;
    ranges.push({ in: a - EDGE, srcEnd: b, out: b + EDGE });
  }
  edl.push({ beat, ranges: ranges.map((r) => [+r.in.toFixed(3), +r.out.toFixed(3)]), text: keep.map((n) => segments[n - 1].text).join(" ") });
}

let pos = 0;
for (const b of edl) {
  b.start = +pos.toFixed(3);
  for (const [a, c] of b.ranges) pos += c - a;
  b.end = +pos.toFixed(3);
}
fs.writeFileSync(take("edl.json"), JSON.stringify(edl, null, 2));
for (const b of edl) console.log(`beat ${b.beat}: ${b.start.toFixed(1)}–${b.end.toFixed(1)} (${(b.end - b.start).toFixed(1)} s, ${b.ranges.length} cuts)`);
console.log(`total ${pos.toFixed(1)} s`);

// Second pass: whisper merged some retakes into one segment, so they survive the first pass.
// These ranges are in the first pass's output time (from re-transcribing vo-cut-check.wav);
// each edge snaps to the quietest 10 ms within ±0.12 s.
const REMOVE = [
  [74.12, 76.77], // "Lucía can ask her store questions, uh, retake."
  [86.16, 88.28], // "She can ask AI for its new charts." (first try)
  [91.47, 97.71], // three false starts of "Because agents talk in plain language"
  [108.09, 108.92], // "PayPal uses." → "Under the hood, this app uses…"
  [118.89, 121.7], // "Claude writes listing, negotiates answers." (first try)
  [126.4, 128.09], // "It all runs on Render with work…" (first try)
  [131.87, 139.07], // first try of the close
];
const rmsPath = take("rms10-cut1.txt");
if (fs.existsSync(rmsPath)) {
  const rms = fs.readFileSync(rmsPath, "utf8").trim().split("\n").map(Number);
  const snap = (t) => {
    let best = t, bestV = Infinity;
    for (let x = t - 0.12; x <= t + 0.12; x += 0.01) {
      const v = rms[Math.round(x * 100)];
      if (v !== undefined && v < bestV) { bestV = v; best = x; }
    }
    return +best.toFixed(3);
  };
  const removes = REMOVE.map(([a, b]) => [snap(a), snap(b)]);
  // first-pass output time → source time
  const flat = edl.flatMap((b) => b.ranges.map((r) => ({ beat: b.beat, src: r })));
  const pieces = [];
  let o = 0;
  for (const f of flat) {
    const len = f.src[1] - f.src[0];
    pieces.push({ beat: f.beat, o0: o, o1: o + len, s0: f.src[0] });
    o += len;
  }
  const final = [];
  for (const p of pieces) {
    let segs = [[p.o0, p.o1]];
    for (const [a, b] of removes) {
      segs = segs.flatMap(([x, y]) => (b <= x || a >= y ? [[x, y]] : [[x, a], [b, y]].filter(([u, v]) => v - u > 0.04)));
    }
    for (const [x, y] of segs) final.push({ beat: p.beat, src: [+(p.s0 + x - p.o0).toFixed(3), +(p.s0 + y - p.o0).toFixed(3)] });
  }
  // Third pass, in source time: found by watching the first render.
  const SRC_REMOVE = [
    [158.48, 159.025], // "…ake", the tail of "retake" before "Lucía can ask her store questions"
    [249.375, 249.58], // 0.2 s of silent face after "listing pipeline": flashed as a jump cut before the close
    [284.4, 287.075], // "PayPal already reaches makers in 200…" (false start; the clean take follows)
  ];
  for (const [a, b] of SRC_REMOVE) {
    for (let i = final.length - 1; i >= 0; i--) {
      const [x, y] = final[i].src;
      if (a <= x && b >= y) final.splice(i, 1);
    }
  }
  const out = [];
  let pos2 = 0;
  for (const { beat } of BEATS) {
    const ranges = final.filter((f) => f.beat === beat).map((f) => f.src);
    const start = pos2;
    for (const [a, c] of ranges) pos2 += c - a;
    out.push({ beat, start: +start.toFixed(3), end: +pos2.toFixed(3), ranges });
  }
  fs.writeFileSync(take("edl-final.json"), JSON.stringify(out, null, 2));
  console.log("final:");
  for (const b of out) console.log(`beat ${b.beat}: ${b.start.toFixed(1)}–${b.end.toFixed(1)} (${(b.end - b.start).toFixed(1)} s)`);
  console.log(`total ${pos2.toFixed(1)} s`);
}
