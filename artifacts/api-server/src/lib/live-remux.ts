/**
 * Server-side remux of the live-tab streams.
 *
 * WHY THIS EXISTS
 * The upstream HLS is fundamentally broken:
 *   1. The segment CDN throttles each connection (~0.15 MB/s) — playback can
 *      barely keep up with realtime.
 *   2. The segmenter emits many fragments with NO audio track (measured: ~25%
 *      of fragments in a sample stream). hls.js appends those into the audio
 *      SourceBuffer creating holes; the <video> element needs data in every
 *      track at the playhead, so playback freezes at each hole.
 *   3. Segment PTS is offset ~+1.4s from the playlist's declared times.
 *
 * THE FIX: download + AES-decrypt the stream ONCE per video (background job),
 * then run a single ffmpeg pass that copies the video and mixes the real
 * audio over a continuous silent bed (amix with anullsrc) — verified to
 * produce gap-free audio. Output is a clean local fMP4 HLS that streams from
 * our own disk: instant startup, zero stalls, no origin involvement at
 * playback time.
 */

import { createDecipheriv } from "node:crypto";
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const UPSTREAM_BASE = "https://h4gaz3.jpzydpzm.cc";
const MIRROR_BASES = [UPSTREAM_BASE, "https://box.jpzydpzm.cc"];

const REMUX_DIR =
  process.env.LIVE_REMUX_DIR ?? path.resolve(process.cwd(), "remux-cache");
const MAX_CACHE_BYTES = Number(process.env.LIVE_REMUX_MAX_BYTES ?? 8 * 1024 * 1024 * 1024); // 8 GB
// The origin throttles per CONNECTION but scales with parallelism (measured
// ~5x aggregate at 6-way) — use a wide download fan-out.
const DOWNLOAD_CONCURRENCY = 10;
const DOWNLOAD_TIMEOUT_MS = 30_000;
// Two videos at once: origin + disk can take it, halves catalogue warm-up.
const MAX_PARALLEL_JOBS = 3;

export type RemuxStatus = "idle" | "queued" | "running" | "ready" | "failed";

interface RemuxJob {
  status: RemuxStatus;
  startedAt?: number;
  readyAt?: number;
  error?: string;
}

const jobs = new Map<string, RemuxJob>();
const queue: string[] = [];
const activeJobs = new Set<string>();

function jobDir(id: string): string {
  return path.join(REMUX_DIR, id);
}

function playlistPath(id: string): string {
  return path.join(jobDir(id), "index.m3u8");
}

export function getRemuxStatus(id: string): RemuxJob {
  if (jobs.has(id)) return jobs.get(id)!;
  // Server restarted: trust the filesystem (previous run may have finished).
  if (existsSync(playlistPath(id))) {
    const done: RemuxJob = { status: "ready", readyAt: Date.now() };
    jobs.set(id, done);
    return done;
  }
  return { status: "idle" };
}

/** Fire-and-forget: queue a remux for this video if not already done/running.
 *  Failed jobs are retried after a 5-minute cooldown. */
export function ensureRemux(id: string): void {
  const st = getRemuxStatus(id);
  if (st.status === "ready" || st.status === "running" || st.status === "queued") return;
  if (
    st.status === "failed" &&
    st.startedAt &&
    Date.now() - st.startedAt < 5 * 60_000
  ) {
    return;
  }
  jobs.set(id, { status: "queued", startedAt: Date.now() });
  queue.push(id);
  pumpQueue();
}

let warmerStarted = false;
/** Queue the WHOLE catalogue through the remux pipeline (once per boot).
 *  Runs in the background for a few hours; every video it finishes becomes
 *  a smooth, silence-filled, locally-served stream. */
export function warmCatalogue(ids: string[]): void {
  if (warmerStarted) return;
  warmerStarted = true;
  for (const id of ids) {
    const st = getRemuxStatus(id);
    if (st.status !== "idle") continue;
    jobs.set(id, { status: "queued" });
    queue.push(id);
  }
  pumpQueue();
}

function pumpQueue(): void {
  while (activeJobs.size < MAX_PARALLEL_JOBS && queue.length > 0) {
    const id = queue.shift()!;
    activeJobs.add(id);
    jobs.set(id, { status: "running", startedAt: Date.now() });
    runRemux(id)
      .then(() => {
        jobs.set(id, { status: "ready", readyAt: Date.now() });
      })
      .catch((err) => {
        jobs.set(id, {
          status: "failed",
          startedAt: Date.now(),
          error: err instanceof Error ? err.message : String(err),
        });
      })
      .finally(() => {
        activeJobs.delete(id);
        void trimCache();
        pumpQueue();
      });
  }
}

async function fetchText(url: string, timeoutMs = 15_000): Promise<string> {
  const candidates = [url];
  try {
    const origin = new URL(url).origin;
    for (const base of MIRROR_BASES) {
      if (base !== origin) candidates.push(url.replace(/^https?:\/\/[^/]+/, base));
    }
  } catch {
    /* just try the original URL */
  }
  let lastErr: unknown;
  for (const candidate of candidates) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(candidate, {
        headers: { "User-Agent": BROWSER_UA, Referer: "https://www.google.com/" },
        signal: controller.signal,
        redirect: "follow",
      });
      if (!res.ok) throw new Error(`upstream ${res.status}`);
      return await res.text();
    } catch (err) {
      lastErr = err;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("upstream fetch failed");
}

async function runRemux(id: string): Promise<void> {
  const dir = jobDir(id);
  await fs.mkdir(dir, { recursive: true });
  const tmp = path.join(dir, "full.ts");

  // 1. Media playlist
  const videoPageUrl = `${UPSTREAM_BASE}/video/${id}/`;
  const html = await fetchText(videoPageUrl);
  const cfgMatch = html.match(/data-config='([^']+)'/);
  if (!cfgMatch) throw new Error("no player config on video page");
  const cfg = JSON.parse(cfgMatch[1]) as { video?: { url?: string } };
  const m3u8 = cfg.video?.url ?? "";
  if (!/^https?:\/\//.test(m3u8)) throw new Error("no m3u8 in player config");

  const playlist = await fetchText(m3u8);
  const lines = playlist.split("\n");
  const base = rsplit2(m3u8);
  const segUris = lines.filter((l) => l.trim() && !l.trim().startsWith("#"));
  if (segUris.length === 0) throw new Error("empty playlist");

  // 2. Key + IV
  const keyLine = lines.find((l) => l.startsWith("#EXT-X-KEY"));
  if (!keyLine) throw new Error("playlist is not AES-128 encrypted (unexpected)");
  const keyUri = /URI="([^"]+)"/.exec(keyLine)?.[1] ?? "";
  const keyUrl = /^https?:/.test(keyUri) ? keyUri : `${base}/${keyUri}`;
  const ivHex = /IV=0[xX]([0-9a-fA-F]+)/.exec(keyLine)?.[1];
  const keyBuf = await fetchBinary(keyUrl);

  // 3. Download + decrypt all segments (parallel, written in order)
  const mediaSeq = Number(/MEDIA-SEQUENCE=(\d+)/.exec(playlist)?.[1] ?? 0);
  const buffers = new Array<Buffer | null>(segUris.length).fill(null);
  let nextToWrite = 0;
  await fs.writeFile(tmp, Buffer.alloc(0));
  let cursor = 0;
  let failed = 0;
  const worker = async (): Promise<void> => {
    while (true) {
      const i = cursor++;
      if (i >= segUris.length) return;
      const uri = segUris[i];
      const segUrl = /^https?:/.test(uri) ? uri : `${base}/${uri}`;
      try {
        const enc = await fetchBinary(segUrl);
        const iv = ivHex
          ? Buffer.from(ivHex, "hex")
          : seqIv(mediaSeq + i);
        const decipher = createDecipheriv("aes-128-cbc", keyBuf, iv);
        buffers[i] = Buffer.concat([decipher.update(enc), decipher.final()]);
      } catch {
        failed += 1;
        buffers[i] = Buffer.alloc(0); // keep sequence alignment; ffmpeg tolerates gaps
      }
      // write in order as slots complete
      while (nextToWrite < buffers.length && buffers[nextToWrite] !== null) {
        const buf = buffers[nextToWrite]!;
        buffers[nextToWrite] = null;
        await fs.appendFile(tmp, buf);
        nextToWrite += 1;
      }
    }
  };
  await Promise.all(Array.from({ length: DOWNLOAD_CONCURRENCY }, worker));
  if (nextToWrite < segUris.length) throw new Error("segment assembly incomplete");
  const st = await fs.stat(tmp);
  if (st.size < 100_000) throw new Error(`assembled stream too small (${st.size}B)`);
  if (failed > segUris.length * 0.1) {
    throw new Error(`too many segment failures (${failed}/${segUris.length})`);
  }

  // 4. Gap-free audio, deterministic PCM assembly (amix proved unreliable:
  //    it emitted a segment whose audio PTS was 5s off the video):
  //      a. ffprobe every audio packet (pts + duration)
  //      b. decode the audio track to raw PCM (frames in packet order)
  //      c. re-lay the PCM on a continuous timeline, writing digital silence
  //         wherever the source has no audio (the broken segments)
  //      d. mux: video copy + the filled PCM → AAC → clean fMP4 HLS
  const probe = await runFFprobeDuration(tmp);
  const videoDur = probe > 0 ? probe : sumExtinf(playlist);
  const audioPkts = await ffprobeAudioPackets(tmp);
  const videoStart = await ffprobeFirstVideoPts(tmp);
  const pcmFile = path.join(dir, "audio.pcm");
  await runFfmpeg([
    "-y", "-i", "full.ts", "-map", "0:a",
    "-f", "s16le", "-ar", "44100", "-ac", "2", "audio.pcm",
  ], dir);
  const filledFile = path.join(dir, "filled.pcm");
  await assembleFilledAudio(
    pcmFile,
    filledFile,
    audioPkts,
    videoDur + 1,
    videoStart,
  );
  await fs.rm(pcmFile, { force: true });

  // 4b. Loudness fix: the upstream mics record EXTREMELY quiet audio
  //     (measured peak ≈ -58 dBFS, RMS ≈ -72 dB — barely audible). Measure
  //     the assembled track's peak and apply enough clean gain to land the
  //     peak at ≈ -4 dBFS, plus a highpass to cut rumble below speech.
  const peakDb = await measurePeak(filledFile);
  const gainDb = Number.isFinite(peakDb) && peakDb < -10
    ? Math.min(60, Math.max(0, -4 - peakDb))
    : 0;
  const audioFilters = gainDb > 0.5
    ? [`volume=${gainDb.toFixed(1)}dB`, "highpass=f=100"]
    : [];

  const ffmpegCmd = [
    "-y",
    "-i", "full.ts",
    "-f", "s16le", "-ar", "44100", "-ac", "2", "-i", "filled.pcm",
    "-map", "0:v", "-map", "1:a",
    "-c:v", "copy",
    "-c:a", "aac", "-b:a", "128k",
    ...(audioFilters.length > 0 ? ["-af", audioFilters.join(",")] : []),
    "-avoid_negative_ts", "make_zero",
    "-f", "hls",
    "-hls_time", "6",
    "-hls_segment_type", "fmp4",
    "-hls_playlist_type", "vod",
    "-hls_list_size", "0",
    "-hls_segment_filename", "seg%05d.m4s",
    "index.m3u8",
  ];
  await runFfmpeg(ffmpegCmd, dir);
  await fs.rm(filledFile, { force: true });
  // verify playlist was produced
  const idx = await fs.readFile(playlistPath(id), "utf8");
  if (!idx.includes("#EXTM3U")) throw new Error("ffmpeg produced no playlist");
  await fs.rm(tmp, { force: true }); // free the ~250MB intermediate
}

async function fetchBinary(url: string): Promise<Buffer> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": BROWSER_UA, Referer: "https://www.google.com/" },
      signal: controller.signal,
      redirect: "follow",
    });
    if (!res.ok) throw new Error(`upstream ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  } finally {
    clearTimeout(timer);
  }
}

function rsplit2(s: string): string {
  const i = s.lastIndexOf("/");
  return i > 0 ? s.slice(0, i) : s;
}

function sumExtinf(playlist: string): number {
  let total = 0;
  for (const l of playlist.split("\n")) {
    const m = /^#EXTINF:([\d.]+)/.exec(l.trim());
    if (m) total += Number(m[1]);
  }
  return total > 0 ? total : 3600;
}

interface AudioPacket {
  pts: number;
  dur: number;
}

function ffprobeAudioPackets(file: string): Promise<AudioPacket[]> {
  return new Promise((resolve, reject) => {
    const proc = spawn(
      "ffprobe",
      [
        "-v", "error",
        "-select_streams", "a",
        "-show_entries", "packet=pts_time,duration_time",
        "-of", "csv=p=0",
        file,
      ],
      { stdio: ["ignore", "pipe", "ignore"] },
    );
    let out = "";
    proc.stdout.on("data", (d: Buffer) => (out += d.toString()));
    proc.on("error", reject);
    proc.on("close", () => {
      const pkts: AudioPacket[] = [];
      for (const line of out.split("\n")) {
        const parts = line.trim().split(",");
        if (parts.length < 2) continue;
        const pts = Number(parts[0]);
        const dur = Number(parts[1]);
        if (Number.isFinite(pts) && Number.isFinite(dur)) pkts.push({ pts, dur });
      }
      resolve(pkts);
    });
  });
}

function ffprobeFirstVideoPts(file: string): Promise<number> {
  return new Promise((resolve) => {
    const proc = spawn(
      "ffprobe",
      [
        "-v", "error",
        "-select_streams", "v",
        "-show_entries", "packet=pts_time",
        "-of", "csv=p=0",
        "-read_intervals", "%+#1",
        file,
      ],
      { stdio: ["ignore", "pipe", "ignore"] },
    );
    let out = "";
    proc.stdout.on("data", (d: Buffer) => (out += d.toString()));
    proc.on("error", () => resolve(0));
    proc.on("close", () => {
      const v = Number(out.trim().split(",")[0]);
      resolve(Number.isFinite(v) ? v : 0);
    });
  });
}

/** Peak level (dBFS) of a raw s16le 44.1kHz stereo PCM file, via astats. */
function measurePeak(pcmFile: string): Promise<number> {
  return new Promise((resolve) => {
    const proc = spawn(
      "ffmpeg",
      [
        "-v", "info",
        "-f", "s16le", "-ar", "44100", "-ac", "2",
        "-i", pcmFile,
        "-af", "astats=metadata=1",
        "-f", "null", "-",
      ],
      { stdio: ["ignore", "ignore", "pipe"] },
    );
    let err = "";
    proc.stderr.on("data", (d: Buffer) => (err += d.toString()));
    proc.on("error", () => resolve(Number.NaN));
    proc.on("close", () => {
      const m = /Peak level dB: (-?[\d.]+)/.exec(err);
      resolve(m ? Number(m[1]) : Number.NaN);
    });
  });
}

const PCM_SAMPLE_RATE = 44_100;
const PCM_CHANNELS = 2;
const PCM_BYTES_PER_SAMPLE = 2;

/**
 * Re-lay decoded audio PCM onto a continuous 0..duration timeline, writing
 * digital silence for every gap in the source. Streams from disk — no big
 * buffers. The k-th byte range of the decoded PCM corresponds to the k-th
 * packet's duration (verified: sum(durations)×rate×channels×2 == pcm size).
 */
async function assembleFilledAudio(
  pcmIn: string,
  pcmOut: string,
  packets: AudioPacket[],
  durationSec: number,
  timelineZeroPts: number,
): Promise<void> {
  const bytesPerSec = PCM_SAMPLE_RATE * PCM_CHANNELS * PCM_BYTES_PER_SAMPLE;
  const totalBytes = Math.round(durationSec * bytesPerSec);
  const t0 = timelineZeroPts;
  const inFd = await fs.open(pcmIn, "r");
  const outFd = await fs.open(pcmOut, "w");
  try {
    let outPos = 0;
    let inPos = 0;
    const silence = Buffer.alloc(64 * 1024);
    const writeSilence = async (bytes: number): Promise<void> => {
      while (bytes > 0) {
        const n = Math.min(bytes, silence.length);
        await outFd.write(silence.subarray(0, n));
        bytes -= n;
        outPos += n;
      }
    };
    for (const pkt of packets) {
      const target = Math.max(0, Math.round((pkt.pts - t0) * bytesPerSec));
      if (target > outPos) await writeSilence(target - outPos);
      const n = Math.max(0, Math.round(pkt.dur * bytesPerSec));
      if (n > 0) {
        const buf = Buffer.alloc(n);
        const { bytesRead } = await inFd.read(buf, 0, n, inPos);
        if (bytesRead > 0) {
          await outFd.write(buf.subarray(0, bytesRead));
          outPos += bytesRead;
          inPos += bytesRead;
        }
      }
    }
    if (totalBytes > outPos) await writeSilence(totalBytes - outPos);
  } finally {
    await inFd.close();
    await outFd.close();
  }
}

/** HLS default IV when the playlist omits one: the media sequence number,
 *  64-bit big-endian in the low half of a 128-bit block. */
function seqIv(seq: number): Buffer {
  const iv = Buffer.alloc(16);
  iv.writeBigUInt64BE(BigInt(seq), 8);
  return iv;
}

function runFfmpeg(args: string[], cwd?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"], cwd });
    let errTail = "";
    proc.stderr.on("data", (d: Buffer) => {
      errTail = (errTail + d.toString()).slice(-2000);
    });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited ${code}: ${errTail.slice(-400)}`));
    });
  });
}

function runFFprobeDuration(file: string): Promise<number> {
  return new Promise((resolve) => {
    const proc = spawn(
      "ffprobe",
      ["-v", "error", "-show_entries", "format=duration", "-of", "json", file],
      { stdio: ["ignore", "pipe", "ignore"] },
    );
    let out = "";
    proc.stdout.on("data", (d: Buffer) => (out += d.toString()));
    proc.on("error", () => resolve(0));
    proc.on("close", () => {
      try {
        resolve(Number(JSON.parse(out).format?.duration ?? 0));
      } catch {
        resolve(0);
      }
    });
  });
}

/** Keep the cache under budget: delete oldest-ready jobs first. */
async function trimCache(): Promise<void> {
  let entries: Array<{ dir: string; size: number; mtime: number }> = [];
  try {
    for (const name of await fs.readdir(REMUX_DIR)) {
      const dir = path.join(REMUX_DIR, name);
      let size = 0;
      let mtime = 0;
      for (const f of await fs.readdir(dir)) {
        const fp = path.join(dir, f);
        const s = await fs.stat(fp);
        size += s.size;
        mtime = Math.max(mtime, s.mtimeMs);
      }
      entries.push({ dir, size, mtime });
    }
  } catch {
    return;
  }
  let total = entries.reduce((a, e) => a + e.size, 0);
  entries.sort((a, b) => a.mtime - b.mtime);
  for (const e of entries) {
    if (total <= MAX_CACHE_BYTES) break;
    const id = path.basename(e.dir);
    const job = jobs.get(id);
    if (job?.status === "running") continue;
    await fs.rm(e.dir, { recursive: true, force: true });
    jobs.delete(id);
    total -= e.size;
  }
}

/** Loop duration of a remuxed video (sum of playlist EXTINF), memoized.
 *  Used to compute the shared broadcast position for players + thumbnails. */
const remuxDurations = new Map<string, number>();
export function getRemuxDuration(id: string): number {
  const hit = remuxDurations.get(id);
  if (hit) return hit;
  try {
    const text = readFileSync(playlistPath(id), "utf8");
    let total = 0;
    for (const line of text.split("\n")) {
      const m = /^#EXTINF:([\d.]+)/.exec(line.trim());
      if (m) total += Number(m[1]);
    }
    if (total > 0) {
      remuxDurations.set(id, total);
      return total;
    }
  } catch {
    /* not ready */
  }
  return 0;
}

/** Express-style request handler helper: stream a remuxed file, or 404. */
export function openRemuxFile(
  id: string,
  file: string,
): { stream: ReturnType<typeof createReadStream>; size: number; type: string } | null {
  if (!/^[a-zA-Z0-9_-]+$/.test(id) || !/^[a-zA-Z0-9._-]+$/.test(file)) return null;
  if (file.includes("..")) return null;
  const fp = path.join(jobDir(id), file);
  if (!existsSync(fp)) return null;
  const type = file.endsWith(".m3u8")
    ? "application/vnd.apple.mpegurl"
    : file.endsWith(".m4s") || file.endsWith(".mp4")
      ? "video/iso.segment"
      : "application/octet-stream";
  return { stream: createReadStream(fp), size: statSync(fp).size, type };
}
