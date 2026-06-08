---
name: run-homebridge-google-nest-sdm-v2
description: Build, smoke-test, and verify the homebridge-google-nest-sdm-v2 Homebridge plugin (Google Nest cameras/doorbells/thermostats via the Smart Device Management API). Use when asked to run, build, test, smoke-test, or verify the Nest SDM plugin, or to check that it still loads into Homebridge and that credentials aren't leaked in logs.
---

# Run homebridge-google-nest-sdm-v2

This is a **Homebridge platform plugin**, not a standalone app. It has no UI of
its own and no server to launch — Homebridge loads `dist/index.js`, calls the
exported function with an `api` object, and (given Google SDM credentials + real
Nest devices) drives it. There is nothing to screenshot.

So the agent-facing driver is an **import-and-call smoke harness**:
[`driver.mjs`](driver.mjs) loads the *built* plugin the way Homebridge would and
asserts the things that actually break this plugin — the registration contract,
config validation, the token-redaction security path, and ffmpeg resolution —
all offline, no credentials, no network.

All paths below are relative to the unit root
(`homebridge-google-nest-sdm-v2/`).

## Prerequisites

- **Node + npm.** Node 18–24 is the supported range; **Node 24** matches the
  deployment target. Node 25+ works for the build and for `driver.mjs` (the
  driver shims one removed buffer API — see Gotchas), but is not a runtime you'd
  deploy to.
- No system packages needed for build + smoke (pure TypeScript/JS; the bundled
  `ffmpeg-for-homebridge` is a dependency, not a system install).

## Build

```bash
npm install
npm run build      # rimraf dist && tsc (strict) && copy src/res/*.jpg -> dist/
```

`npm run build` is the **primary correctness gate** — the strict `tsc` compile
catches the large majority of regressions in this codebase. A clean build leaves
`dist/index.js` plus `dist/res/*.jpg`.

## Run (agent path) — the smoke driver

```bash
node .claude/skills/run-homebridge-google-nest-sdm-v2/driver.mjs
```

Exits `0` and prints `OK — 0 failure(s)` when healthy; exits `1` on any failed
check, `2` if `dist/` is missing (build first). Verified output this session:

```
homebridge-google-nest-sdm-v2 smoke driver

  PASS  module graph loads (require dist/index.js + Platform + util)
  PASS  registers platform under the stable alias
  PASS  missing config is reported, not crashed
  PASS  summarizeError redacts credentials
        (fallback ffmpeg: ffmpeg)
  PASS  resolveFfmpegPath honors explicit path and has a fallback

OK — 0 failure(s)
```

What each check defends:

1. **module graph loads** — `require('dist/index.js')` pulls the whole graph
   (googleapis, @google-cloud/pubsub, werift, …); catches a bad import / missing
   dep before Homebridge would.
2. **registers platform under the stable alias** — asserts `index(api)` calls
   `registerPlatform('homebridge-google-nest-sdm', Platform)`. The npm package is
   `…-v2` but the platform alias intentionally stays `homebridge-google-nest-sdm`
   so existing user configs keep working — the test fails loudly if that drifts.
3. **missing config is reported, not crashed** — constructs `Platform` with an
   empty config and asserts it logs which required fields are missing
   (`projectId, clientId, clientSecret, refreshToken, subscriptionId`) and
   early-returns instead of throwing or logging the secret-bearing config object.
4. **summarizeError redacts credentials** — feeds a gaxios-style 401 carrying a
   bearer token in `config.headers.Authorization` and asserts the summary keeps
   the status + API message but **never** contains the token. This is the
   security fix; treat a failure here as release-blocking.
5. **resolveFfmpegPath** — explicit path wins; otherwise a non-empty fallback.

To exercise a specific internal a PR touches, add a check to `driver.mjs` the
same way (require from `dist/…`, call, assert) — it's agent tooling, edit freely.

## Run (live, real devices) — requires a configured Homebridge host

True end-to-end needs a Homebridge instance, Google SDM OAuth credentials (with
the **Pub/Sub** scope), and real Nest devices — it can't run in this repo. The
deploy pattern used in production (global install on the Homebridge host, then
restart) is:

```bash
# on the Homebridge host, after publishing the version to npm:
npm i -g homebridge-google-nest-sdm-v2@<version>     # use npm.cmd on Windows (see Gotchas)
# then restart Homebridge and tail its log; a healthy load shows:
#   Loaded plugin: homebridge-google-nest-sdm-v2@<version>
#   [homebridge-google-nest-sdm] Initializing homebridge-google-nest-sdm platform...
#   [homebridge-google-nest-sdm] Snapshot refresher enabled (...)
#   ...Restoring existing accessory from cache: <camera names>
# and NO 'scope'/'subscription'/'Missing required field' errors.
```

## Test

```bash
npm test    # NOTE: not configured — prints an error and exits 1. Use the build + driver above.
```

## Gotchas

- **Node 25 removed `buffer.SlowBuffer`.** A transitive googleapis auth dep
  (`buffer-equal-constant-time`) reads it at require-time, so on Node ≥25
  `require('dist/index.js')` throws `Cannot read properties of undefined (reading
  'prototype')`. `driver.mjs` shims `bufferMod.SlowBuffer = Buffer` at the top
  (harness-only; does not touch the shipped plugin or the live Node-24 runtime).
  Without that shim the module graph won't load on a Node-25 host.
- **Platform alias ≠ package name, on purpose.** Package: `…-v2`; config alias:
  `homebridge-google-nest-sdm`. Don't "fix" the alias to match — it would break
  every existing user's `config.json`. Check #2 guards this.
- **`ffmpeg-for-homebridge` can resolve falsy**, in which case
  `resolveFfmpegPath()` falls back to bare `ffmpeg` (seen this session). That's
  intended; on the live host the bundled binary (with `h264_qsv`) does resolve.
- **The constructor is safe to instantiate offline only with an *invalid* config**
  (it early-returns). A *valid* config makes `SmartDeviceManagement` attach a
  Pub/Sub subscriber, which opens a background gRPC stream — the driver
  deliberately tests only the invalid-config path to stay offline.
- **Windows host:** `npm` over SSH→PowerShell is blocked by execution policy; use
  `npm.cmd` and `Restart-Service Homebridge`. Freshly-published npm versions take
  ~30–60s to propagate (a too-eager `npm.cmd i -g @x.y.z` fails with `notarget`;
  retry).

## Troubleshooting

| Symptom | Fix |
|---|---|
| `dist/index.js not found` (driver exits 2) | Run `npm run build` first. |
| `Cannot read properties of undefined (reading 'prototype')` at require | You're on Node ≥25 and bypassed `driver.mjs`'s shim — run via `driver.mjs`, or use Node 24. |
| Driver check #4 fails | A change reintroduced credential leakage in `summarizeError` (`src/util.ts`) — release-blocking. |
| Driver check #2 fails | `PLATFORM_NAME` in `src/Settings.ts` drifted off `homebridge-google-nest-sdm`; revert it. |
