// Cuts the face-cam take with assets/take/edl-final.json → assets/face.mp4 (video + VO) and assets/vo.wav.
//   node tools/build-face.mjs [path/to/C0170.MP4]
// Needs ffmpeg on PATH. Writes the filter graph to assets/take/final-av.txt.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const dir = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, "$1")), "..");
const src = process.argv[2] ?? "C:/Users/xevie/Videos/C0170.MP4";
const edl = JSON.parse(fs.readFileSync(path.join(dir, "assets/take/edl-final.json"), "utf8"));
const ranges = edl.flatMap((b) => b.ranges);
const FADE = 0.015;

const parts = [];
ranges.forEach(([a, b], i) => {
  parts.push(`[0:v]trim=${a}:${b},setpts=PTS-STARTPTS[v${i}]`);
  const st = (b - a - FADE).toFixed(3);
  parts.push(`[0:a]atrim=${a}:${b},asetpts=PTS-STARTPTS,afade=t=in:d=${FADE},afade=t=out:st=${st}:d=${FADE}[a${i}]`);
});
const pads = ranges.map((_, i) => `[v${i}][a${i}]`).join("");
parts.push(`${pads}concat=n=${ranges.length}:v=1:a=1[vv][aa]`);
parts.push("[aa]pan=mono|c0=c0,highpass=f=80,afftdn=nr=10:nf=-42,loudnorm=I=-16:TP=-1.5:LRA=11,asplit[ao][aw]");
const graph = path.join(dir, "assets/take/final-av.txt");
fs.writeFileSync(graph, parts.join(";"));

execFileSync(
  "ffmpeg",
  ["-v", "error", "-y", "-i", src, "-/filter_complex", graph,
    "-map", "[vv]", "-map", "[ao]", "-c:v", "libx264", "-profile:v", "high", "-pix_fmt", "yuv420p", "-crf", "18", "-preset", "medium",
    "-c:a", "aac", "-b:a", "192k", "-ar", "48000", path.join(dir, "assets/face.mp4"),
    "-map", "[aw]", "-c:a", "pcm_s16le", "-ar", "48000", path.join(dir, "assets/vo.wav")],
  { stdio: "inherit" },
);
console.log(`${ranges.length} ranges → assets/face.mp4, assets/vo.wav`);
