# CLAUDE.md — homebridge-google-nest-sdm-v2

Maintained fork of `homebridge-google-nest-sdm` (potmat, ISC) — a Homebridge platform
plugin for Google Nest cameras/doorbells/thermostats via the Smart Device Management
(SDM) API. Published to npm + GitHub (`nnmb2vgw4r-sudo/homebridge-google-nest-sdm-v2`).

## Hard invariants — do not violate

- **Platform alias stays `homebridge-google-nest-sdm`** (`src/Settings.ts` `PLATFORM_NAME`).
  The npm package is `…-v2`, but the alias users write in `config.json` must NOT change or
  every existing install breaks. The smoke driver asserts this.
- **Never log credentials.** Errors go through `summarizeError()` (`src/util.ts`) — never
  `JSON.stringify` an axios/gaxios error or log `error.config`/`error.request`/headers;
  they carry the OAuth `Authorization` bearer token and cookies. Never log the config
  object (clientSecret + refreshToken).
- **Refresh token needs the Pub/Sub scope.** Events depend on it; the README/error
  messages point users at this. Don't remove that guidance.
- ISC license + the upstream copyright line stay; attribution to potmat/Andreas Bauer stays.

## Verify gate (run before every commit)

```bash
npm install
npm run build      # strict tsc — the primary correctness gate
node .claude/skills/run-homebridge-google-nest-sdm-v2/driver.mjs   # offline smoke (see that skill)
```

`npm test` is intentionally unconfigured (exits 1). The build + driver are the checks.

## Deploy target

Runs on **Zork-O-Plex** (Windows Plex box, `192.168.4.21`), Node 24, Homebridge as an
NSSM service. NOT on the Pi (the Pi runs the other plugins). Deploy = publish to npm,
then on the host `npm.cmd i -g homebridge-google-nest-sdm-v2@<ver>` + `Restart-Service
Homebridge`. See the `/release-homebridge-plugin` workspace skill for the full pipeline.
Gotchas: `npm` over SSH→PowerShell is blocked (use `npm.cmd`); fresh npm versions take
~30–60s to propagate (else `notarget` — retry).

## Bug classes that have actually bitten this codebase

When reviewing or editing, watch for these (all have been real bugs here):

- **Falsy-zero**: `if (!temp)` / `if (!eco)` / `|| fallback` wrongly drop a legitimate `0`
  (0°C setpoint) or `false` (eco-OFF). Use `=== undefined` / `== null` / `??`.
- **Resource leaks on error paths**: a WebRTC/RTSP stream opened via `getStreamer()` +
  `initialize()` must be `teardown()`'d on EVERY throw/abort — including before a session
  is tracked. Timers (the RTCP-PLI interval) must be cleared on every teardown.
- **Child-process kill**: `childProcess.killed` is true after a signal is *sent*, not when
  the process dies — use `exitCode`/`signalCode` for liveness.
- **Pagination**: `list_devices()` must follow `nextPageToken`; the stale-accessory cleanup
  unregisters anything not returned, so a missed page = deleted accessories.
- **HAP traps**: `getService(type)` returns the first service of that UUID ignoring subtype;
  custom characteristics (EcoMode) need `addOptionalCharacteristic`; un-awaited
  `setupEvents()` racing `updateCharacteristic`.
- **Unhandled rejections**: async work kicked off inside the Pub/Sub message listener (e.g.
  `getVideoProtocol().then(...)`) needs a `.catch`.

## Release hygiene

Semver patch for fixes. Bump `package.json` version + add a `CHANGELOG.md` entry in the
same commit. The npm tarball is restricted by `package.json` "files" to
dist/schema/LICENSE/README/CHANGELOG — `.claude/`, configs, and creds never ship; keep it
that way (the release skill secret-scans `npm pack` before publishing).
