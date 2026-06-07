"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    Object.defineProperty(o, k2, { enumerable: true, get: function() { return m[k]; } });
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.Platform = void 0;
const Settings_1 = require("./Settings");
const CameraAccessory_1 = require("./CameraAccessory");
const Api_1 = require("./sdm/Api");
const ThermostatAccessory_1 = require("./ThermostatAccessory");
const Camera_1 = require("./sdm/Camera");
const Thermostat_1 = require("./sdm/Thermostat");
const Doorbell_1 = require("./sdm/Doorbell");
const DoorbellAccessory_1 = require("./DoorbellAccessory");
const EcoMode = require("./EcoMode");
const FanAccessory_1 = require("./FanAccessory");
const UnknownDevice_1 = require("./sdm/UnknownDevice");
const SnapshotRefresher = __importStar(require("./SnapshotRefresher"));
let IEcoMode;
/**
 * HomebridgePlatform
 * This class is the main constructor for your plugin, this is where you should
 * parse the user config and discover/register accessories with Homebridge.
 */
class Platform {
    constructor(log, platformConfig, api) {
        this.log = log;
        this.platformConfig = platformConfig;
        this.api = api;
        this.accessories = [];
        this.debugMode = process.argv.includes('-D') || process.argv.includes('--debug');
        this.EcoMode = EcoMode(api);
        IEcoMode = this.EcoMode;
        this.config = platformConfig;
        const required = ['projectId', 'clientId', 'clientSecret', 'refreshToken', 'subscriptionId'];
        const missing = required.filter(k => !this.config || !this.config[k]);
        if (missing.length > 0) {
            // NEVER log the config object — it carries clientSecret + the OAuth refresh token.
            log.error(`${platformConfig.platform} is not configured correctly. Missing/empty required field(s): ${missing.join(', ')}`);
            return;
        }
        this.smartDeviceManagement = new Api_1.SmartDeviceManagement(this.config, log);
        // When this event is fired it means Homebridge has restored all cached accessories from disk.
        // Dynamic Platform plugins should only register new accessories after this event was fired,
        // in order to ensure they weren't added to homebridge already. This event can also be used
        // to start discovery of new accessories.
        this.api.on('didFinishLaunching', () => {
            var _a, _b;
            log.debug('Executed didFinishLaunching callback');
            // Configure the snapshot refresher once, rooted at the Homebridge storage path
            // (NOT os.homedir(), which is wrong under non-login service accounts).
            SnapshotRefresher.configure({
                storagePath: this.api.user.storagePath(),
                ffmpegPath: this.config.ffmpegPath,
                enabled: this.config.snapshotRefresh !== false,
                appOpenEnabled: this.config.snapshotRefreshOnAppOpen !== false,
                spacingMs: ((_a = this.config.snapshotRefreshSpacing) !== null && _a !== void 0 ? _a : 30) * 1000,
                ttlMs: ((_b = this.config.snapshotRefreshTtl) !== null && _b !== void 0 ? _b : 15) * 60000,
                log: this.log,
            });
            // run the method to discover / register your devices as accessories
            this.discoverDevices();
        });
        this.Characteristic = Object.defineProperty(this.api.hap.Characteristic, 'EcoMode', { value: this.EcoMode });
    }
    /**
     * This function is invoked when homebridge restores cached accessories from disk at startup.
     * It should be used to setup event handlers for characteristics and update respective values.
     */
    configureAccessory(accessory) {
        this.log.info('Loading accessory from cache:', accessory.displayName);
        // add the restored accessory to the accessories cache so we can track if it has already been registered
        this.accessories.push(accessory);
    }
    /**
     * This is an example method showing how to register discovered accessories.
     * Accessories must only be registered once, previously created accessories
     * must not be registered again to prevent "duplicate UUID" errors.
     */
    async discoverDevices() {
        if (!this.smartDeviceManagement)
            return;
        const devices = await this.smartDeviceManagement.list_devices();
        if (!devices)
            return;
        const deviceInfos = devices
            .map(device => {
            const uuid = this.api.hap.uuid.generate(device.getName());
            const category = (() => {
                if (device instanceof Doorbell_1.Doorbell)
                    return 18 /* VIDEO_DOORBELL */;
                else if (device instanceof Camera_1.Camera)
                    return 17 /* CAMERA */;
                else if (device instanceof Thermostat_1.Thermostat)
                    return 9 /* THERMOSTAT */;
                else if (device instanceof UnknownDevice_1.UnknownDevice)
                    return 1 /* OTHER */;
            })();
            return {
                device: device,
                uuid: uuid,
                category: category,
                existingAccessory: this.accessories.find(accessory => accessory.UUID === uuid)
            };
        });
        devices.filter(device => device instanceof Thermostat_1.Thermostat).forEach(thermostatDevice => {
            if (this.config.showFan) {
                const uuid = this.api.hap.uuid.generate(thermostatDevice.getName() + ' Fan');
                deviceInfos.push({
                    device: thermostatDevice,
                    uuid: uuid,
                    category: 3 /* FAN */,
                    existingAccessory: this.accessories.find(accessory => accessory.UUID === uuid)
                });
            }
        });
        // loop over the discovered devices and register each one if it has not already been registered
        for (const deviceInfo of deviceInfos) {
            if (deviceInfo.category === 1 /* OTHER */)
                continue;
            if (deviceInfo.existingAccessory) {
                this.log.info('Restoring existing accessory from cache:', deviceInfo.existingAccessory.displayName);
                // if you need to update the accessory.context then you should run `api.updatePlatformAccessories`. eg.:
                deviceInfo.existingAccessory.context.device = deviceInfo.device;
                this.api.updatePlatformAccessories([deviceInfo.existingAccessory]);
                switch (deviceInfo.category) {
                    case 18 /* VIDEO_DOORBELL */:
                        new DoorbellAccessory_1.DoorbellAccessory(this.api, this.log, this, deviceInfo.existingAccessory, deviceInfo.device);
                        break;
                    case 17 /* CAMERA */:
                        new CameraAccessory_1.CameraAccessory(this.api, this.log, this, deviceInfo.existingAccessory, deviceInfo.device);
                        break;
                    case 9 /* THERMOSTAT */:
                        new ThermostatAccessory_1.ThermostatAccessory(this.api, this.log, this, deviceInfo.existingAccessory, deviceInfo.device);
                        break;
                    case 3 /* FAN */:
                        new FanAccessory_1.FanAccessory(this.api, this.log, this, deviceInfo.existingAccessory, deviceInfo.device);
                        break;
                }
                // update accessory cache with any changes to the accessory details and information
                this.api.updatePlatformAccessories([deviceInfo.existingAccessory]);
            }
            else {
                switch (deviceInfo.category) {
                    case 18 /* VIDEO_DOORBELL */:
                        const doorbellPlatformAccessory = this.getPlatformAccessory(deviceInfo.device, deviceInfo.device.getDisplayName(), deviceInfo.uuid, 18 /* VIDEO_DOORBELL */);
                        new DoorbellAccessory_1.DoorbellAccessory(this.api, this.log, this, doorbellPlatformAccessory, deviceInfo.device);
                        this.api.registerPlatformAccessories(Settings_1.PLUGIN_NAME, Settings_1.PLATFORM_NAME, [doorbellPlatformAccessory]);
                        break;
                    case 17 /* CAMERA */:
                        const cameraPlatformAccessory = this.getPlatformAccessory(deviceInfo.device, deviceInfo.device.getDisplayName(), deviceInfo.uuid, 17 /* CAMERA */);
                        new CameraAccessory_1.CameraAccessory(this.api, this.log, this, cameraPlatformAccessory, deviceInfo.device);
                        this.api.registerPlatformAccessories(Settings_1.PLUGIN_NAME, Settings_1.PLATFORM_NAME, [cameraPlatformAccessory]);
                        break;
                    case 9 /* THERMOSTAT */:
                        let thermostatPlatformAccessory = this.getPlatformAccessory(deviceInfo.device, deviceInfo.device.getDisplayName(), deviceInfo.uuid, 9 /* THERMOSTAT */);
                        new ThermostatAccessory_1.ThermostatAccessory(this.api, this.log, this, thermostatPlatformAccessory, deviceInfo.device);
                        this.api.registerPlatformAccessories(Settings_1.PLUGIN_NAME, Settings_1.PLATFORM_NAME, [thermostatPlatformAccessory]);
                        break;
                    case 3 /* FAN */:
                        let fanPlatformAccessory = this.getPlatformAccessory(deviceInfo.device, deviceInfo.device.getDisplayName() + ' Fan', deviceInfo.uuid, 3 /* FAN */);
                        new FanAccessory_1.FanAccessory(this.api, this.log, this, fanPlatformAccessory, deviceInfo.device);
                        this.api.registerPlatformAccessories(Settings_1.PLUGIN_NAME, Settings_1.PLATFORM_NAME, [fanPlatformAccessory]);
                        break;
                }
            }
        }
        // Remove cached accessories that no longer map to a discovered device — e.g. a device was
        // removed from the account, or the Fan was disabled (showFan off). Only runs when discovery
        // succeeded (guarded by the early return on a null device list), so a transient API failure
        // won't wipe accessories.
        const validUuids = new Set(deviceInfos.filter(d => d.category !== 1 /* OTHER */).map(d => d.uuid));
        const stale = this.accessories.filter(a => !validUuids.has(a.UUID));
        if (stale.length > 0) {
            this.log.info(`Removing ${stale.length} stale accessory(ies): ${stale.map(a => a.displayName).join(', ')}`);
            this.api.unregisterPlatformAccessories(Settings_1.PLUGIN_NAME, Settings_1.PLATFORM_NAME, stale);
            for (const s of stale) {
                const idx = this.accessories.indexOf(s);
                if (idx >= 0)
                    this.accessories.splice(idx, 1);
            }
        }
    }
    getPlatformAccessory(device, name, uuid, category) {
        this.log.info('Adding new accessory:', name);
        const accessory = new this.api.platformAccessory(name || "Unknown Name", uuid, category);
        accessory.context.device = device;
        return accessory;
    }
}
exports.Platform = Platform;
//# sourceMappingURL=Platform.js.map