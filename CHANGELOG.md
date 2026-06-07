# Changelog

All notable changes to this fork are documented here. This project is a maintained
fork of [`homebridge-google-nest-sdm`](https://github.com/potmat/homebridge-google-nest-sdm)
by potmat; it follows the same ISC license.

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
