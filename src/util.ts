/**
 * Build a concise, SAFE error summary for logging. Crucially this never includes
 * the request config / headers (which carry the OAuth `Authorization` bearer token
 * and cookies) the way `JSON.stringify(error)` on an Axios/Gaxios error does.
 */
export function summarizeError(error: any): string {
    const status = error?.response?.status;
    const statusText = error?.response?.statusText;
    const apiMessage = error?.response?.data?.error?.message;
    const message = apiMessage || error?.message || String(error);
    return status ? `HTTP ${status}${statusText ? ' ' + statusText : ''}: ${message}` : message;
}

/**
 * Resolve which ffmpeg binary to use: an explicit configured path wins, otherwise
 * the bundled `ffmpeg-for-homebridge`, otherwise `ffmpeg` from PATH.
 */
export function resolveFfmpegPath(configuredPath?: string): string {
    if (configuredPath && configuredPath.trim().length > 0)
        return configuredPath;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('ffmpeg-for-homebridge') || 'ffmpeg';
}
