"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Accessory = void 0;
class Accessory {
    constructor(api, log, platform, accessory, device) {
        this.platform = platform;
        this.log = log;
        this.api = api;
        this.accessory = accessory;
        this.device = device;
        // Set info on the accessory's REAL AccessoryInformation service (the previous code built a
        // throwaway service and discarded it, so Manufacturer/Model/Serial were never applied).
        const info = this.accessory.getService(this.api.hap.Service.AccessoryInformation)
            || this.accessory.addService(this.api.hap.Service.AccessoryInformation);
        info.setCharacteristic(this.platform.Characteristic.Manufacturer, 'Nest')
            .setCharacteristic(this.platform.Characteristic.Model, 'Nest Device')
            .setCharacteristic(this.platform.Characteristic.SerialNumber, this.accessory.UUID);
    }
    async convertToNullable(input) {
        const result = await input;
        // Only null/undefined map to null. A falsy check here wrongly nulled legitimate values:
        // EcoMode `false` (the normal eco-OFF case) and a 0°C / 0% reading.
        if (result === undefined || result === null)
            return null;
        return result;
    }
}
exports.Accessory = Accessory;
//# sourceMappingURL=Accessory.js.map