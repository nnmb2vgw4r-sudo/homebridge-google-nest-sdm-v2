# homebridge-google-nest-sdm-v2

A Homebridge plugin for Google Nest **cameras, doorbells, displays, and thermostats** via the documented [Google Smart Device Management (SDM) API](https://developers.google.com/nest/device-access). Supports HomeKit Secure Video.

> **Maintained fork.** This is a community-maintained continuation of the excellent [`homebridge-google-nest-sdm`](https://github.com/potmat/homebridge-google-nest-sdm) by **potmat** (originally based on a Homebridge template © 2020 Andreas Bauer), which is no longer actively updated. All credit for the original work goes to them; this fork is offered **best-effort** under the same ISC license. It is not affiliated with or endorsed by Google.

## What's new in v2

- **Refreshing camera snapshots** — Home-app tiles now show a recent frame instead of the generic Nest/Google placeholder. Stills are grabbed on motion and (optionally) when you open the Home app, through a single **rate-limited, serialized queue** so it stays clear of the SDM 429 limit. Configurable; can be turned off. *(addresses [#45](https://github.com/potmat/homebridge-google-nest-sdm/issues/45))*
- **Configurable ffmpeg / hardware transcoding** — a new `ffmpegPath` option lets you point at a build with the hardware encoder you want (`h264_qsv`, `h264_videotoolbox`, `h264_vaapi`, `h264_nvenc`, …) instead of being locked to the bundled binary.
- **Security: no more tokens in logs** — SDM command errors no longer dump the full request (which contained your OAuth `Authorization: Bearer …` token) into the Homebridge log. *(addresses the leak seen in [#99](https://github.com/potmat/homebridge-google-nest-sdm/issues/99))*
- **Graceful rate-limit handling** — an SDM `429 RESOURCE_EXHAUSTED` on stream start now logs a clear message instead of throwing `TypeError: Cannot read properties of undefined (reading 'mediaSessionId')`. *(addresses [#99](https://github.com/potmat/homebridge-google-nest-sdm/issues/99))*
- **HKSV teardown hardening** — recording streams now force-kill ffmpeg (SIGKILL escalation) and always release the server/socket, reducing orphaned ffmpeg processes / growing memory. *(addresses [#150](https://github.com/potmat/homebridge-google-nest-sdm/issues/150))*
- **Homebridge v2 support** — declared compatible with Homebridge `^1.6.0 || ^2.0.0`. *(addresses [#200](https://github.com/potmat/homebridge-google-nest-sdm/issues/200))*
- **Clearer setup docs** — the three "project" identifiers are disambiguated, and the critical Pub/Sub-scope step is front and center (see below).

See [CHANGELOG.md](./CHANGELOG.md).

## Installation

```
npm install -g --unsafe-perm homebridge-google-nest-sdm-v2
```

Or install **Google Nest SDM (v2)** from the Homebridge UI plugin search. Don't forget `--unsafe-perm` on the CLI.

> Migrating from the original `homebridge-google-nest-sdm`? Uninstall it first (they register the same platform and can't both run), then install this. Your existing config works as-is — the `"platform"` value stays `"homebridge-google-nest-sdm"`.

## Setup

You need five values from Google. Follow Google's [Device Access getting-started guide](https://developers.google.com/nest/device-access/get-started), then mind the **Pub/Sub scope** step below.

### The three "project" identifiers (this trips everyone up)

Google's setup involves **three different things all called a "project."** Mixing them up is the #1 cause of setup failure (typically an `invalid_client` error):

| Config field | What it is | Looks like | Where it comes from |
|---|---|---|---|
| `projectId` | **Device Access** Project ID | a UUID, `4f689e03-...` | [Device Access Console](https://developers.google.com/nest/device-access/get-started#create_a_device_access_project) |
| `gcpProjectId` | **Google Cloud** Project ID | `my-project-334315` | the GCP project where you made the OAuth client + Pub/Sub subscription |
| (not a config field) | GCP **project number** | `837325688835` | appears only in some error messages — same project as `gcpProjectId` |

And the OAuth credentials, which are **not** any of the above:

- `clientId` — OAuth client ID, ends in `.apps.googleusercontent.com` ([GCP setup](https://developers.google.com/nest/device-access/get-started#set_up_google_cloud_platform)).
- `clientSecret` — paired secret, starts with `GOCSPX-`.

### Remaining values

- `refreshToken` — from [authorizing the account](https://developers.google.com/nest/device-access/authorize#get_an_access_token). **Must be generated with the Pub/Sub scope** (see below).
- `subscriptionId` — from [creating a Pub/Sub pull subscription](https://developers.google.com/nest/device-access/subscribe-to-events#create_a_pull_subscription). Full path form: `projects/<gcp-project-id>/subscriptions/<subscription-id>`.

### ⚠️ THE PUB/SUB SCOPE STEP — don't skip this

When you authorize the account, Google's guide tells you to open an authorization URL whose scope is **only** `sdm.service`:

```
…&scope=https://www.googleapis.com/auth/sdm.service
```

**Do not use that URL.** Use one with the Pub/Sub scope appended, or **device events (motion, doorbell presses, temperature changes) will silently not work**:

```
https://nestservices.google.com/partnerconnections/PROJECT-ID/auth?redirect_uri=https://www.google.com&access_type=offline&prompt=consent&client_id=OAUTH2-CLIENT-ID&response_type=code&scope=https://www.googleapis.com/auth/sdm.service+https://www.googleapis.com/auth/pubsub
```

Note the `+https://www.googleapis.com/auth/pubsub` on the end. (Replace `PROJECT-ID` with your Device Access project UUID and `OAUTH2-CLIENT-ID` with your client ID.) If you've already generated a refresh token without it, you must re-do this step to get a new one. The symptom of a missing scope is `Plugin initialization failed, there was a failure with event subscription … insufficient authentication scopes`.

## Example config

```json
{
    "platform": "homebridge-google-nest-sdm",
    "clientId": "780816631155-xxxx.apps.googleusercontent.com",
    "clientSecret": "GOCSPX-...",
    "projectId": "4f689e03-....",
    "refreshToken": "1//...",
    "subscriptionId": "projects/my-project-334315/subscriptions/nest-events-sub",
    "gcpProjectId": "my-project-334315",
    "vEncoder": "libx264 -preset ultrafast -tune zerolatency",
    "ffmpegPath": "",
    "snapshotRefresh": true,
    "snapshotRefreshOnAppOpen": true,
    "snapshotRefreshSpacing": 30,
    "snapshotRefreshTtl": 15
}
```

The Homebridge UI config screen is the easiest way to enter these. Only the first five values are required.

## Camera snapshots

The SDM API has **no on-demand snapshot** for cameras. v2 works around this by caching the **last decoded frame** from streams it opens:

- **On motion/person events** a fresh still is grabbed (this is the most useful freshness — a changed tile means something happened).
- **On app open** (`snapshotRefreshOnAppOpen`) stale tiles are topped up when the Home app requests snapshots.

All grabs go through one **serialized queue** with a global spacing (`snapshotRefreshSpacing`, default 30s) and a per-camera freshness window (`snapshotRefreshTtl`, default 15 min), so the feature stays well within Google's rate limits. Tradeoff: lower spacing / shorter TTL = fresher tiles but more SDM calls (closer to HTTP 429). Set `snapshotRefresh: false` to disable entirely (tiles fall back to the placeholder logo). Snapshots are cached under your Homebridge storage directory in `nest-sdm-snapshots/`.

## Hardware transcoding

`vEncoder` selects the ffmpeg video encoder; `ffmpegPath` selects the ffmpeg **binary**. Together they let you offload transcoding to a GPU:

| Platform | `vEncoder` | Notes |
|---|---|---|
| Intel (Quick Sync) | `h264_qsv` | needs an ffmpeg built with QSV + Intel drivers |
| macOS | `h264_videotoolbox` | |
| Raspberry Pi 4 | `h264_v4l2m2m` | |
| Linux + VAAPI | `h264_vaapi` | |
| NVIDIA | `h264_nvenc` | needs an NVENC-capable ffmpeg |
| any (no transcode) | `copy` | lowest CPU, but can't adapt to what HomeKit requests; less reliable |

If `vEncoder` names an encoder your ffmpeg doesn't have, streams will fail ("camera not responding"). Point `ffmpegPath` at a build that includes it. Leave `ffmpegPath` blank to use the bundled `ffmpeg-for-homebridge`.

## HomeKit Secure Video

HKSV is supported. Note how it works: SDM reports motion → the plugin reports it to your hub → the hub requests a stream → the plugin transcodes it → the hub analyzes it for motion and may log a clip. Because of this round-trip, **a motion event may not always produce a timeline clip** (the motion may be over by the time the hub starts analyzing). HKSV transcoding is CPU-heavy; for many cameras you'll want a capable host.

## Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| `invalid_client` | You mixed up the IDs — `clientId` must be the `…apps.googleusercontent.com` value, not the Device Access UUID. See the table above. |
| `insufficient authentication scopes` / event subscription failure | Refresh token was generated **without the Pub/Sub scope.** Re-do the authorization with the `+…/auth/pubsub` URL above. Setting `gcpProjectId` can also help. |
| `SERVICE_DISABLED` / 403 listing devices | The Smart Device Management API isn't enabled on your GCP project. Enable it in *APIs & Services → Library*. |
| `429` / `RESOURCE_EXHAUSTED` | Google's per-project SDM rate limit, usually from opening many streams at once. v2 handles it gracefully; reduce churn (e.g. don't open many cameras simultaneously) and/or raise `snapshotRefreshSpacing`. You can request a quota increase in the GCP console. |
| Cameras "not responding" | Check audio/mic is enabled on the camera; ensure ffmpeg exists / your `vEncoder` is supported by your ffmpeg (`ffmpegPath`); disconnect any VPN on the Apple device. |
| **Docker / Unraid** streams don't work | Running Homebridge in a container breaks ffmpeg input and WebRTC data transfer. **Run Homebridge natively.** |
| Camera shows as `<null> Camera` | A Google-side glitch; rename it on the HomeKit side after pairing. |

## FAQ

**Why a fork?** The original is dormant (last release Feb 2024) with open issues. This fork carries fixes and a snapshot feature forward. All credit to potmat for the original.

**Do I still have to pay Google $5 for Device Access?** Yes — that's Google's one-time registration fee, unchanged.

**Why use the SDM API at all instead of the unofficial-API Nest plugins?** SDM is the documented, push-event API: lower overhead, no fragile reverse-engineered endpoints or account cookies.

**Tiles still show the "G" logo.** A tile is a placeholder until the first stream is opened for that camera (then it caches a frame). With `snapshotRefresh` on, it should populate after the first motion/view. Set a shorter `snapshotRefreshTtl` for more frequent updates (at the cost of more SDM calls).

## Disclaimer

Not affiliated with, provided, endorsed, or supported by Google. For personal, non-commercial use; review the [Google SDM Terms of Service](https://developers.google.com/nest/device-access/tos).
