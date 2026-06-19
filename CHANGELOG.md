# Changelog

All notable changes to this fork are documented here. This project is a maintained
fork of [`homebridge-google-nest-sdm`](https://github.com/potmat/homebridge-google-nest-sdm)
by potmat; it follows the same ISC license.

## 2.0.5

### Security
- **Bumped `@google-cloud/pubsub` `^2.18.1` → `^4.11.0` (resolves 4.11.0).** Clears 13
  transitive Dependabot advisories that all came in through the old pubsub →
  `google-gax@2` → `@grpc/grpc-js@1.6` + `protobufjs` chain: 10 `protobufjs` (code
  injection / prototype-pollution / unbounded-recursion DoS), 2 `@grpc/grpc-js`
  (malformed-message crash), and 1 `@protobufjs/utf8`. v4 pulls patched
  `@grpc/grpc-js` 1.14.4 and `protobufjs` 7.6.4. (Chose v4 over v5 for a smaller
  dependency delta; v3 was insufficient — it caps grpc-js below the patched version.)
  The Pub/Sub event path in `src/sdm/Api.ts` (subscription + message ack/parse) is
  unchanged across the major — the `PubSub` constructor credentials option,
  `subscription()`, and `message` events behave identically.

### Changed
- **Dev toolchain: `typescript` `^4.4.3` → `~5.6`.** Required because pubsub v4's gax
  pulls `@opentelemetry/api` type definitions the old TypeScript parser can't read.
  Pinned to the `5.6` minor deliberately (TS ≥5.7 changes typed-array generics, which
  is unrelated churn). No runtime effect — `dist` is recompiled output only.
- **`src/sdm/Device.ts`: constrained the `executeCommand<T, …>` generic to
  `T extends Record<string, any> | null`.** Type-only fix so TypeScript 5.6 selects the
  correct SDM `executeCommand` overload (an unconstrained `T` no longer matched the
  request-body `params` shape). The command payload sent to Google is byte-identical.

Transitive advisories from the `googleapis` (uuid) and `ffmpeg-for-homebridge` (tar)
chains are tracked separately and require their own major upgrades.

## 2.0.4

### Security
- **Bumped `axios` `^1.3.5` → `^1.16.0` (resolves to 1.18.0).** Clears several Dependabot
  high-severity advisories: prototype-pollution gadgets (MitM via `config.proxy`, credential
  theft / response hijacking in config merge), `Proxy-Authorization` leak across HTTP→HTTPS
  redirect, and ReDoS via cookie-name injection. Only call site is the event-image `axios.get`
  in `src/sdm/Camera.ts`; the GET API and `AxiosError` shape are unchanged across 1.x, so no
  behavior change.
- **Bumped `systeminformation` `^5.9.3` → `^5.31.6` (resolves to 5.31.7).** Clears the
  high-severity Linux command-injection advisory in `networkInterfaces()`. This plugin only
  calls `networkInterfaceDefault()`, whose contract is unchanged.

Dependency-only release — no source changes. (Transitive advisories from the older
`@google-cloud/pubsub` / `googleapis` chains are tracked separately and require major
upgrades.)

## 2.0.3

### Fixed
- **Spurious "Error closing UDP connection to FFMpeg: Not running" log.** A snapshot grab
  on a camera that never streamed (e.g. "not available for streaming" / no media session)
  left the dgram socket unbound, so `teardown()` logged an error-level message on a normal
  path. The WebRTC streamer now nulls the peer connection/socket after closing (so the
  caller's `finally` teardown can't double-close) and treats `ERR_SOCKET_DGRAM_NOT_RUNNING`
  as benign (debug, not error).

## 2.0.2

Follow-up fixes from a full whole-codebase review, including two issues introduced by
the 2.0.1 hardening.

### Fixed
- **HKSV SIGKILL escalation never fired (regression in 2.0.1):** the new guard tested
  `!childProcess.killed`, but Node sets `killed` to `true` the instant a signal is *sent*,
  so the guard was always false and a stalled ffmpeg was never force-killed. Now checks
  `exitCode`/`signalCode` (true liveness), restoring the orphaned-process cleanup.
- **Device list pagination / stale-accessory safety:** `list_devices()` now follows
  `nextPageToken` and fetches every page. Previously only the first page was read, so on
  accounts with more devices than one page the 2.0.1 stale-accessory cleanup would
  unregister (and re-add) every device beyond page one on each run.
- **Recording-stream leak:** if the SDM stream `initialize()` failed during an HKSV
  recording request, the partially-opened WebRTC PeerConnection/UDP socket leaked because
  the session wasn't tracked yet; it is now torn down on failure.
- **Live-stream leak / crash on missing prepare:** `startStream` now bails cleanly when
  there is no matching prepared session instead of dereferencing it (which threw after the
  SDM stream was already opened, leaking it).
- **Falsy-zero in characteristic values:** `convertToNullable` mapped legitimate `false`
  and `0` to `null` — most notably reporting `null` for the normal eco-OFF state and for a
  0°C / 0% reading. It now only nulls `undefined`/`null`.
- **Unhandled rejection on camera events:** the motion/person/sound event handlers run
  inside the Pub/Sub message listener; a rejected `getVideoProtocol()` is now caught and
  logged instead of becoming an unhandled rejection.
- **Thermostat 0°C handling:** setpoint-range setters and the setpoint-changed event no
  longer treat a legitimate 0°C value as "unset" (truthy checks replaced with
  `undefined`/`null` checks; `||` fallbacks replaced with `??`).
- **HKSV recording audio:** audio is now encoded based on the *value* of the
  `RecordingAudioActive` characteristic rather than the mere presence of the characteristic
  object, so disabling recording audio is honored.

## 2.0.1

Hardening release following a full code review. No config or behavior changes for a
correctly configured setup; all items are robustness/correctness fixes.

### Fixed / Hardened
- **Pub/Sub message handler:** malformed event payloads are now caught and discarded
  with a warning instead of throwing inside the `message` listener; events without a
  `resourceUpdate` (e.g. resource-relation events) are tolerated.
- **Subscription errors are no longer fatal:** a transient Pub/Sub `error` no longer
  permanently disables the plugin — only a hard setup failure does. Events are
  redelivered by the auto-reconnecting client.
- **Startup config validation** reports exactly which required field(s) are missing,
  and still never logs the config object (which carries the client secret / refresh
  token).
- **Stale accessories** (a device removed from the account, or the Fan disabled) are now
  unregistered on successful discovery, instead of lingering as "not responding" tiles.
- **WebRTC keep-alive timer leak:** the RTCP-PLI interval is now cleared on every
  teardown and on the 429 abort path, so streams/snapshots/recordings no longer leak a
  timer per session.
- **AccessoryInformation** (Manufacturer/Model/Serial) is now set on the real service
  instead of a discarded throwaway one.
- **Thermostat setpoints:** `setTargetTemperatureRange` no longer falls through between
  HEAT/COOL cases; `setFan` only sends a duration when one is provided.
- **Stream/snapshot error paths:** snapshot, prepare-stream and start-stream failures are
  caught, summarized (no token leakage), and reported back via their callbacks instead of
  surfacing as unhandled rejections; failed stream starts tear down cleanly.
- **`setupEvents` is serialized** so concurrent invocations (constructor + mode/eco
  update handlers) can't interleave and leave threshold characteristics inconsistent.
- **EcoMode** custom characteristic is declared optional on the service to avoid
  Homebridge 2.x warnings.

### Changed
- Dev dependency `homebridge` bumped to `^1.6.0 || ^2.0.0` to compile against the v2 types
  it declares support for.

## 2.0.0

First release of the `homebridge-google-nest-sdm-v2` fork, based on upstream `1.1.23`.

### Added
- **Refreshing camera snapshots.** Home-app tiles show a recent frame instead of the
  static Nest/Google placeholder. Stills are grabbed on motion/person events and
  (optionally) when the Home app requests snapshots, via a single serialized,
  rate-limited queue. New options: `snapshotRefresh`, `snapshotRefreshOnAppOpen`,
  `snapshotRefreshSpacing`, `snapshotRefreshTtl`. (upstream #45)
- **`ffmpegPath` option** to use a custom ffmpeg binary (e.g. a hardware-accelerated
  build for `h264_qsv` / `h264_vaapi` / `h264_nvenc` / `h264_videotoolbox`), instead of
  being locked to the bundled binary.

### Fixed / Hardened
- **Security:** SDM command/list/event-image errors no longer log the full Axios error
  object, which contained the OAuth `Authorization: Bearer` token (and cookies). Errors
  are now summarized to status + message only. (relates to upstream #99)
- **Graceful 429 handling:** a `RESOURCE_EXHAUSTED` on WebRTC stream start now throws a
  clear "rate-limited" error instead of `TypeError: Cannot read properties of undefined
  (reading 'mediaSessionId')`. (upstream #99)
- **HKSV teardown:** recording streams now escalate to SIGKILL and always close the
  server/socket, and the recording generator tears down in a `finally` — reducing
  orphaned ffmpeg processes and growing memory use. (upstream #150)

### Changed
- **Homebridge v2 support:** `engines.homebridge` is now `^1.6.0 || ^2.0.0`. (upstream #200)
- Snapshot cache is stored under the Homebridge storage path (`api.user.storagePath()`),
  which is correct even when Homebridge runs under a non-login service account
  (e.g. Windows LocalSystem), rather than `os.homedir()`.
- Clearer config field descriptions and README setup guide: disambiguates the three
  "project" identifiers and foregrounds the required Pub/Sub OAuth scope.

### Attribution
- Original plugin © potmat; Homebridge plugin template © 2020 Andreas Bauer. ISC license
  retained. This fork is maintained on a best-effort basis and is not affiliated with Google.
