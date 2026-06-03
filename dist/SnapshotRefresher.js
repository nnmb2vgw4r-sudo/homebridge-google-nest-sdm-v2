"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.requestRefresh = exports.snapshotPathFor = exports.isConfigured = exports.configure = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const crypto_1 = __importDefault(require("crypto"));
const child_process_1 = require("child_process");
const NestStreamer_1 = require("./NestStreamer");
const util_1 = require("./util");
const COOLDOWN_MS = 600000; // min between attempts per camera
const MAX_QUEUE = 12; // shed load past this
const GRAB_TIMEOUT_MS = 20000; // hard wall-clock kill for a single grab
const BACKOFF_CAP_MS = 3600000; // failure backoff ceiling
let cfg;
let cacheDir;
const states = new Map();
const queue = [];
const pendingSet = new Set();
let lastGrabStartMs = 0;
let workerRunning = false;
function configure(c) {
    cfg = c;
    cacheDir = path_1.default.join(c.storagePath, "nest-sdm-snapshots");
    try {
        fs_1.default.mkdirSync(cacheDir, { recursive: true });
    }
    catch (e) { /* ignore */ }
    c.log.info(`Snapshot refresher ${c.enabled ? "enabled" : "disabled"} (spacing ${Math.round(c.spacingMs / 1000)}s, ttl ${Math.round(c.ttlMs / 60000)}m). Cache: ${cacheDir}`);
}
exports.configure = configure;
function isConfigured() {
    return !!cfg && !!cacheDir;
}
exports.isConfigured = isConfigured;
function sha1(s) {
    return crypto_1.default.createHash("sha1").update(s).digest("hex");
}
function snapshotPathFor(cameraName) {
    if (!cacheDir)
        throw new Error("SnapshotRefresher is not configured");
    return path_1.default.join(cacheDir, sha1(cameraName) + ".jpg");
}
exports.snapshotPathFor = snapshotPathFor;
function tmpPathFor(cameraName) {
    return path_1.default.join(cacheDir, "." + sha1(cameraName) + ".tmp.jpg");
}
function stateFor(name) {
    let s = states.get(name);
    if (!s) {
        s = { inFlight: false, lastAttemptMs: 0, lastSuccessMs: 0, consecFailures: 0 };
        states.set(name, s);
    }
    return s;
}
function fileMtimeMs(file) {
    try {
        return fs_1.default.statSync(file).mtimeMs;
    }
    catch (e) {
        return 0;
    }
}
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
/** Fire-and-forget. Never throws into the caller. */
function requestRefresh(camera, reason) {
    try {
        if (!cfg || !cacheDir || !cfg.enabled)
            return;
        if (reason === "app-open" && !cfg.appOpenEnabled)
            return;
        const name = camera.getName();
        const s = stateFor(name);
        const now = Date.now();
        if (s.inFlight)
            return; // a grab is executing
        if (pendingSet.has(name))
            return; // already queued (closes the burst race)
        // freshness: newest of in-memory success or file mtime (restart backstop; also
        // makes a camera that's currently being live-viewed skip, since the live view
        // keeps its cache file hot).
        const fresh = Math.max(s.lastSuccessMs, fileMtimeMs(snapshotPathFor(name)));
        if (now - fresh < cfg.ttlMs)
            return;
        // per-camera cooldown with exponential backoff on consecutive failures
        const cooldown = Math.min(COOLDOWN_MS * Math.pow(2, s.consecFailures), BACKOFF_CAP_MS);
        if (now - s.lastAttemptMs < cooldown)
            return;
        if (queue.length >= MAX_QUEUE)
            return; // shed load
        queue.push(camera);
        pendingSet.add(name);
        if (!workerRunning) {
            workerRunning = true;
            setImmediate(() => { void runWorker(); });
        }
    }
    catch (e) { /* never throw into hook */ }
}
exports.requestRefresh = requestRefresh;
async function runWorker() {
    var _a;
    try {
        while (queue.length > 0 && cfg) {
            const camera = queue.shift();
            const name = camera.getName();
            pendingSet.delete(name);
            const s = stateFor(name);
            if (s.inFlight)
                continue;
            const wait = cfg.spacingMs - (Date.now() - lastGrabStartMs); // global spacing between grab starts
            if (wait > 0)
                await delay(wait);
            s.inFlight = true;
            s.lastAttemptMs = Date.now();
            lastGrabStartMs = Date.now();
            try {
                await grabFrame(camera);
                s.lastSuccessMs = Date.now();
                s.consecFailures = 0;
            }
            catch (e) {
                s.consecFailures = Math.min(s.consecFailures + 1, 10);
                cfg === null || cfg === void 0 ? void 0 : cfg.log.debug(`Snapshot refresh failed for ${name}: ${(_a = e === null || e === void 0 ? void 0 : e.message) !== null && _a !== void 0 ? _a : e}`);
            }
            finally {
                s.inFlight = false;
            }
        }
    }
    finally {
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
async function grabFrame(camera) {
    if (!cfg || !cacheDir)
        throw new Error("not configured");
    const name = camera.getName();
    const finalPath = snapshotPathFor(name);
    const tmpPath = tmpPathFor(name);
    const ffmpegPath = (0, util_1.resolveFfmpegPath)(cfg.ffmpegPath);
    const streamer = await (0, NestStreamer_1.getStreamer)(cfg.log, camera);
    let proc;
    let killTimer;
    let killed = false;
    try {
        const ns = await streamer.initialize(); // werift PC + UDP + generateStream + 2s RTCP-PLI keyframe loop
        const args = ns.args.split(/\s+/).filter(Boolean).concat([
            "-map", "0:v:0", "-frames:v", "1", "-vf", "scale=640:-2", "-q:v", "5", "-f", "image2", "-y", tmpPath,
        ]);
        proc = (0, child_process_1.spawn)(ffmpegPath, args, { env: process.env, stdio: ["pipe", "ignore", "ignore"] });
        const child = proc;
        await new Promise((resolve, reject) => {
            let settled = false;
            killTimer = setTimeout(() => { killed = true; try {
                child.kill("SIGKILL");
            }
            catch (e) { /* ignore */ } }, GRAB_TIMEOUT_MS);
            child.on("error", (err) => { if (!settled) {
                settled = true;
                reject(err);
            } });
            child.on("exit", (code) => {
                if (settled)
                    return;
                settled = true;
                if (killed)
                    reject(new Error("grab timed out"));
                else if (code === 0)
                    resolve();
                else
                    reject(new Error("ffmpeg exited with code " + code));
            });
            if (child.stdin) {
                child.stdin.on("error", () => { });
                try {
                    if (ns.stdin)
                        child.stdin.write(ns.stdin);
                    child.stdin.end();
                }
                catch (e) { /* ignore */ }
            }
        });
        let sz = 0;
        try {
            sz = fs_1.default.statSync(tmpPath).size;
        }
        catch (e) { /* ignore */ }
        if (sz <= 0)
            throw new Error("empty snapshot");
        fs_1.default.renameSync(tmpPath, finalPath); // atomic publish
    }
    finally {
        if (killTimer)
            clearTimeout(killTimer);
        try {
            proc === null || proc === void 0 ? void 0 : proc.kill("SIGKILL");
        }
        catch (e) { /* ignore */ }
        try {
            if (fs_1.default.existsSync(tmpPath))
                fs_1.default.unlinkSync(tmpPath);
        }
        catch (e) { /* ignore */ }
        try {
            await streamer.teardown();
        }
        catch (e) { /* always release PC/UDP/SDM session */ }
    }
}
//# sourceMappingURL=SnapshotRefresher.js.map