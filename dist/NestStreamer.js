"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.WebRtcNestStreamer = exports.RtspNestStreamer = exports.NestStreamer = void 0;
exports.getStreamer = getStreamer;
const dgram_1 = require("dgram");
const werift_1 = require("werift");
const Traits = __importStar(require("./sdm/Traits"));
const pick_port_1 = __importDefault(require("pick-port"));
const util_1 = require("./util");
class NestStreamer {
    constructor(log, camera) {
        this.log = log;
        this.camera = camera;
    }
}
exports.NestStreamer = NestStreamer;
class RtspNestStreamer extends NestStreamer {
    async initialize() {
        const streamInfo = await this.camera.generateStream();
        this.token = streamInfo.streamExtensionToken;
        return {
            args: '-analyzeduration 15000000 -probesize 100000000 -i ' + streamInfo.streamUrls.rtspUrl
        };
    }
    async teardown() {
        if (!this.token)
            return;
        try {
            await this.camera.stopStream(this.token);
        }
        catch (error) {
            this.log.error('Error stopping camera stream: ' + (0, util_1.summarizeError)(error));
        }
    }
}
exports.RtspNestStreamer = RtspNestStreamer;
class WebRtcNestStreamer extends NestStreamer {
    async initialize() {
        var _a, _b;
        this.udp = (0, dgram_1.createSocket)("udp4");
        this.pc = new werift_1.RTCPeerConnection({
            bundlePolicy: "max-bundle",
            codecs: {
                audio: [
                    new werift_1.RTCRtpCodecParameters({
                        mimeType: "audio/opus",
                        clockRate: 48000,
                        channels: 2,
                    })
                ],
                video: [
                    new werift_1.RTCRtpCodecParameters({
                        mimeType: "video/H264",
                        clockRate: 90000,
                        rtcpFeedback: [
                            { type: "transport-cc" },
                            { type: "ccm", parameter: "fir" },
                            { type: "nack" },
                            { type: "nack", parameter: "pli" },
                            { type: "goog-remb" },
                        ],
                        parameters: 'level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f'
                    })
                ],
            }
        });
        const options = {
            type: 'udp',
            ip: '0.0.0.0',
            reserveTimeout: 15
        };
        const audioPort = await (0, pick_port_1.default)(options);
        const audioTransceiver = this.pc.addTransceiver("audio", { direction: "recvonly" });
        audioTransceiver.onTrack.subscribe((track) => {
            audioTransceiver.sender.replaceTrack(track);
            track.onReceiveRtp.subscribe((rtp) => {
                this.udp.send(rtp.serialize(), audioPort, "127.0.0.1");
            });
        });
        const videoPort = await (0, pick_port_1.default)(options);
        const videoTransceiver = this.pc.addTransceiver("video", { direction: "recvonly" });
        videoTransceiver.onTrack.subscribe((track) => {
            videoTransceiver.sender.replaceTrack(track);
            track.onReceiveRtp.subscribe((rtp) => {
                this.udp.send(rtp.serialize(), videoPort, "127.0.0.1");
            });
            track.onReceiveRtp.once(() => {
                var _a, _b;
                // Keep-alive keyframe requests. MUST be cleared in teardown() — otherwise every
                // stream/snapshot/recording leaks a timer firing on a closed receiver forever.
                this.pliTimer = setInterval(() => videoTransceiver.receiver.sendRtcpPLI(track.ssrc), 2000);
                (_b = (_a = this.pliTimer).unref) === null || _b === void 0 ? void 0 : _b.call(_a);
            });
        });
        this.pc.createDataChannel('dataSendChannel', { id: 1 });
        let offer = await this.pc.createOffer();
        await this.pc.setLocalDescription(offer);
        const streamInfo = await this.camera.generateStream(offer.sdp);
        if (!streamInfo || !streamInfo.mediaSessionId) {
            // generateStream() returns undefined when the SDM command failed — most
            // commonly an HTTP 429 (RESOURCE_EXHAUSTED). Fail with a clear message
            // instead of throwing a TypeError on `streamInfo.mediaSessionId`.
            if (this.pliTimer) {
                clearInterval(this.pliTimer);
                this.pliTimer = undefined;
            }
            // Close and null out so the teardown() that runs in the caller's finally doesn't
            // double-close (which would throw "Not running" / log a spurious error).
            try {
                (_a = this.pc) === null || _a === void 0 ? void 0 : _a.close();
            }
            catch (e) { /* ignore */ }
            try {
                (_b = this.udp) === null || _b === void 0 ? void 0 : _b.close();
            }
            catch (e) { /* ignore */ }
            this.pc = undefined;
            this.udp = undefined;
            throw new Error('Nest SDM returned no media session (likely rate-limited / HTTP 429). Aborting stream start.');
        }
        this.token = streamInfo.mediaSessionId;
        await this.pc.setRemoteDescription({
            type: 'answer',
            sdp: streamInfo.answerSdp
        });
        return {
            args: `-protocol_whitelist pipe,crypto,udp,rtp,fd -analyzeduration 15000000 -probesize 100000000 -i -`,
            stdin: `v=0
o=- 0 0 IN IP4 127.0.0.1
s=-
c=IN IP4 127.0.0.1
t=0 0
m=audio ${audioPort} UDP 96
a=rtpmap:96 opus/48000/2
a=fmtp:96 minptime=10;useinbandfec=1
a=rtcp-fb:96 transport-cc
a=sendrecv
m=video ${videoPort} UDP 97
a=rtpmap:97 H264/90000
a=rtcp-fb:97 ccm fir
a=rtcp-fb:97 nack
a=rtcp-fb:97 nack pli
a=rtcp-fb:97 goog-remb
a=fmtp:97 level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f
a=sendrecv`
        };
    }
    async teardown() {
        var _a, _b;
        if (this.pliTimer) {
            clearInterval(this.pliTimer);
            this.pliTimer = undefined;
        }
        if (this.token) {
            try {
                await this.camera.stopStream(this.token);
            }
            catch (error) {
                this.log.error('Error stopping camera stream: ' + (0, util_1.summarizeError)(error));
            }
        }
        try {
            (_a = this.pc) === null || _a === void 0 ? void 0 : _a.close();
        }
        catch (error) {
            this.log.error('Error closing peer connection: ' + (0, util_1.summarizeError)(error));
        }
        this.pc = undefined;
        try {
            (_b = this.udp) === null || _b === void 0 ? void 0 : _b.close();
        }
        catch (error) {
            // A grab on a camera that never streamed (or an already-closed socket) leaves the dgram
            // socket unbound; close() then throws ERR_SOCKET_DGRAM_NOT_RUNNING. That's benign — log
            // it at debug rather than as an error so normal snapshot churn doesn't spam the log.
            if ((error === null || error === void 0 ? void 0 : error.code) === 'ERR_SOCKET_DGRAM_NOT_RUNNING')
                this.log.debug('UDP socket to FFMpeg was not running at teardown (benign).');
            else
                this.log.error('Error closing UDP connection to FFMpeg: ' + (0, util_1.summarizeError)(error));
        }
        this.udp = undefined;
    }
}
exports.WebRtcNestStreamer = WebRtcNestStreamer;
async function getStreamer(log, camera) {
    if ((await camera.getVideoProtocol()) === Traits.ProtocolType.WEB_RTC) {
        return new WebRtcNestStreamer(log, camera);
    }
    else {
        return new RtspNestStreamer(log, camera);
    }
}
//# sourceMappingURL=NestStreamer.js.map