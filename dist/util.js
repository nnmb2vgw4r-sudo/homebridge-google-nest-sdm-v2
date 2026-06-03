"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveFfmpegPath = exports.summarizeError = void 0;
/**
 * Build a concise, SAFE error summary for logging. Crucially this never includes
 * the request config / headers (which carry the OAuth `Authorization` bearer token
 * and cookies) the way `JSON.stringify(error)` on an Axios/Gaxios error does.
 */
function summarizeError(error) {
    var _a, _b, _c, _d, _e;
    const status = (_a = error === null || error === void 0 ? void 0 : error.response) === null || _a === void 0 ? void 0 : _a.status;
    const statusText = (_b = error === null || error === void 0 ? void 0 : error.response) === null || _b === void 0 ? void 0 : _b.statusText;
    const apiMessage = (_e = (_d = (_c = error === null || error === void 0 ? void 0 : error.response) === null || _c === void 0 ? void 0 : _c.data) === null || _d === void 0 ? void 0 : _d.error) === null || _e === void 0 ? void 0 : _e.message;
    const message = apiMessage || (error === null || error === void 0 ? void 0 : error.message) || String(error);
    return status ? `HTTP ${status}${statusText ? ' ' + statusText : ''}: ${message}` : message;
}
exports.summarizeError = summarizeError;
/**
 * Resolve which ffmpeg binary to use: an explicit configured path wins, otherwise
 * the bundled `ffmpeg-for-homebridge`, otherwise `ffmpeg` from PATH.
 */
function resolveFfmpegPath(configuredPath) {
    if (configuredPath && configuredPath.trim().length > 0)
        return configuredPath;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('ffmpeg-for-homebridge') || 'ffmpeg';
}
exports.resolveFfmpegPath = resolveFfmpegPath;
//# sourceMappingURL=util.js.map