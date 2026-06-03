export type Config = {
    clientId: string,
    clientSecret: string,
    projectId: string,
    refreshToken: string,
    subscriptionId: string,
    gcpProjectId?: string,
    vEncoder?: string,
    showFan?: boolean,
    fanDuration?: number,
    // Path to a custom ffmpeg binary (e.g. a hardware-accelerated build). Blank = bundled ffmpeg-for-homebridge.
    ffmpegPath?: string,
    // Snapshot refresher: keep Home-app camera tiles fresh by grabbing stills on motion / app open.
    snapshotRefresh?: boolean,
    snapshotRefreshOnAppOpen?: boolean,
    snapshotRefreshSpacing?: number, // seconds between grabs (rate-limit guard)
    snapshotRefreshTtl?: number      // minutes a tile is considered fresh
}
