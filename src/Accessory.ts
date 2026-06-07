import {API, Logger, Nullable, PlatformAccessory} from "homebridge";
import {Platform} from "./Platform";

export abstract class Accessory<T> {
    protected readonly api: API;
    protected readonly log: Logger;
    protected readonly platform: Platform;
    protected readonly accessory: PlatformAccessory;
    protected readonly device: T;

    protected constructor(
        api: API,
        log: Logger,
        platform: Platform,
        accessory: PlatformAccessory,
        device: T) {
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

    protected async convertToNullable<T>(input: Promise<T | undefined | null>): Promise<Nullable<T>> {
        const result = await input;
        // Only null/undefined map to null. A falsy check here wrongly nulled legitimate values:
        // EcoMode `false` (the normal eco-OFF case) and a 0°C / 0% reading.
        if (result === undefined || result === null) return null;
        return result;
    }
}
