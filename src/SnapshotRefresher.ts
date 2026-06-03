import fs from "fs";
import path from "path";
import crypto from "crypto";
import { ChildProcess, spawn } from "child_process";
import { Logger } from "homebridge";
import { getStreamer } from "./NestStreamer";
import { resolveFfmpegPath } from "./util";
// Type-only import to avoid a runtime require cycle (Camera -> SnapshotRefresher -> Camera).
import type { Camera } from "./sdm/Camera";

/**
 * Keeps Home-app camera tiles reasonably fresh. SDM has no on-demand snapshot for
 * WebRTC cameras, so a "fresh still" means briefly opening a stream and grabbing one
 * frame. To stay clear of the SDM rate limit (HTTP 429), every grab funnels through a
 * single serialized queue with global spacing and a per-camera TTL/cooldown.
 *
 * Triggered fire-and-forget from two hooks in Camera (motion events and snapshot
 * requests). Configured once by the Platform at `didFinishLaunching` so the cache
 * lives under the Homebridge storage path (NOT os.homedir(), which is wrong when the
 * service runs under a non-login account such as Windows LocalSystem).
 */

export interface RefresherConfig {
    storagePath: string;
    ffmpegPath?: string;
    enabled: boolean;
    appOpenEnabled: boolean;
    spacingMs: number;
    ttlMs: number;
    log: Logger;
}

interface CamState {
    inFlight: boolean;
    lastAttemptMs: number;
    lastSuccessMs: number;
    consecFailures: number;
}

const COOLDOWN_MS = 600000;       // min between attempts per camera
const MAX_QUEUE = 12;             // shed load past this
const GRAB_TIMEOUT_MS = 20000;    // hard wall-clock kill for a single grab
const BACKOFF_CAP_MS = 3600000;   // failure backoff ceiling

let cfg: RefresherConfig | undefined;
let cacheDir: string | undefined;
const states = new Map<string, CamState>();
const queue: Camera[] = [];
const pendingSet = new Set<string>();
let lastGrabStartMs = 0;
let workerRunning = false;

export function configure(c: RefresherConfig): void {
    cfg = c;
    cacheDir = path.join(c.storagePath, "nest-sdm-snapshots");
    try { fs.mkdirSync(cacheDir, { recursive: true }); } catch (e) { /* ignore */ }
    c.log.info(`Snapshot refresher ${c.enabled ? "enabled" : "disabled"} (spacing ${Math.round(c.spacingMs / 1000)}s, ttl ${Math.round(c.ttlMs / 60000)}m). Cache: ${cacheDir}`);
}

export function isConfigured(): boolean {
    return !!cfg && !!cacheDir;
}

function sha1(s: string): string {
    return crypto.createHash("sha1").update(s).digest("hex");
}

export function snapshotPathFor(cameraName: string): string {
    if (!cacheDir) throw new Error("SnapshotRefresher is not configured");
    return path.join(cacheDir, sha1(cameraName) + ".jpg");
}

function tmpPathFor(cameraName: string): string {
    return path.join(cacheDir!, "." + sha1(cameraName) + ".tmp.jpg");
}

function stateFor(name: string): CamState {
    let s = states.get(name);
    if (!s) {
        s = { inFlight: false, lastAttemptMs: 0, lastSuccessMs: 0, consecFailures: 0 };
        states.set(name, s);
    }
    return s;
}

function fileMtimeMs(file: string): number {
    try { return fs.statSync(file).mtimeMs; } catch (e) { return 0; }
}

function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/** Fire-and-forget. Never throws into the caller. */
export function requestRefresh(camera: Camera, reason: "motion" | "app-open"): void {
    try {
        if (!cfg || !cacheDir || !cfg.enabled) return;
        if (reason === "app-open" && !cfg.appOpenEnabled) return;
        const name = camera.getName();
        const s = stateFor(name);
        const now = Date.now();
        if (s.inFlight) return;                 // a grab is executing
        if (pendingSet.has(name)) return;       // already queued (closes the burst race)
        // freshness: newest of in-memory success or file mtime (restart backstop; also
        // makes a camera that's currently being live-viewed skip, since the live view
        // keeps its cache file hot).
        const fresh = Math.max(s.lastSuccessMs, fileMtimeMs(snapshotPathFor(name)));
        if (now - fresh < cfg.ttlMs) return;
        // per-camera cooldown with exponential backoff on consecutive failures
        const cooldown = Math.min(COOLDOWN_MS * Math.pow(2, s.consecFailures), BACKOFF_CAP_MS);
        if (now - s.lastAttemptMs < cooldown) return;
        if (queue.length >= MAX_QUEUE) return;  // shed load
        queue.push(camera);
        pendingSet.add(name);
        if (!workerRunning) {
            workerRunning = true;
            setImmediate(() => { void runWorker(); });
        }
    } catch (e) { /* never throw into hook */ }
}

async function runWorker(): Promise<void> {
    try {
        while (queue.length > 0 && cfg) {
            const camera = queue.shift()!;
            const name = camera.getName();
            pendingSet.delete(name);
            const s = stateFor(name);
            if (s.inFlight) continue;
            const wait = cfg.spacingMs - (Date.now() - lastGrabStartMs); // global spacing between grab starts
            if (wait > 0) await delay(wait);
            s.inFlight = true;
            s.lastAttemptMs = Date.now();
            lastGrabStartMs = Date.now();
            try {
                await grabFrame(camera);
                s.lastSuccessMs = Date.now();
                s.consecFailures = 0;
            } catch (e: any) {
                s.consecFailures = Math.min(s.consecFailures + 1, 10);
                cfg?.log.debug(`Snapshot refresh failed for ${name}: ${e?.message ?? e}`);
            } finally {
                s.inFlight = false;
            }
        }
    } finally {
        workerRunning = false;
        if (queue.length > 0 && cfg) {
            workerRunning = true;
            setImmediate(() => { void runWorker(); }); // drain late arrivals
        }
    }
}

/**
 * Open a brief stream, grab one JPEG, ALWAYS tear down. Writes to a temp file and
 * atomically renames so a killed ffmpeg never leaves a truncated tile.
 */
async function grabFrame(camera: Camera): Promise<void> {
    if (!cfg || !cacheDir) throw new Error("not configured");
    const name = camera.getName();
    const finalPath = snapshotPathFor(name);
    const tmpPath = tmpPathFor(name);
    const ffmpegPath = resolveFfmpegPath(cfg.ffmpegPath);
    const streamer = await getStreamer(cfg.log, camera);
    let proc: ChildProcess | undefined;
    let killTimer: NodeJS.Timeout | undefined;
    let killed = false;
    try {
        const ns = await streamer.initialize(); // werift PC + UDP + generateStream + 2s RTCP-PLI keyframe loop
        const args = ns.args.split(/\s+/).filter(Boolean).concat([
            "-map", "0:v:0", "-frames:v", "1", "-vf", "scale=640:-2", "-q:v", "5", "-f", "image2", "-y", tmpPath,
        ]);
        proc = spawn(ffmpegPath, args, { env: process.env, stdio: ["pipe", "ignore", "ignore"] });
        const child = proc;
        await new Promise<void>((resolve, reject) => {
            let settled = false;
            killTimer = setTimeout(() => { killed = true; try { child.kill("SIGKILL"); } catch (e) { /* ignore */ } }, GRAB_TIMEOUT_MS);
            child.on("error", (err) => { if (!settled) { settled = true; reject(err); } });
            child.on("exit", (code) => {
                if (settled) return;
                settled = true;
                if (killed) reject(new Error("grab timed out"));
                else if (code === 0) resolve();
                else reject(new Error("ffmpeg exited with code " + code));
            });
            if (child.stdin) {
                child.stdin.on("error", () => { /* ignore EPIPE */ });
                try { if (ns.stdin) child.stdin.write(ns.stdin); child.stdin.end(); } catch (e) { /* ignore */ }
            }
        });
        let sz = 0;
        try { sz = fs.statSync(tmpPath).size; } catch (e) { /* ignore */ }
        if (sz <= 0) throw new Error("empty snapshot");
        fs.renameSync(tmpPath, finalPath); // atomic publish
    } finally {
        if (killTimer) clearTimeout(killTimer);
        try { proc?.kill("SIGKILL"); } catch (e) { /* ignore */ }
        try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch (e) { /* ignore */ }
        try { await streamer.teardown(); } catch (e) { /* always release PC/UDP/SDM session */ }
    }
}
