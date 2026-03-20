/**
 * AcFreedomPlatform
 *
 * Creates accessories for each configured device (cloud or local).
 */

'use strict';

const { AcFreedomAccessory } = require('./ac-accessory');
const { AuxCloudAPI } = require('./cloud-api');
const { BroadlinkAcApi } = require('./broadlink-api');

class AcFreedomPlatform {
  constructor(log, config, api) {
    this.log = log;
    this.config = config || {};
    this.api = api;
    this.accessories = new Map();

    if (!api || !config) return;

    this.api.on('didFinishLaunching', () => {
      this.log.info('AC Freedom platform loaded');
      this.discoverDevices();
    });
  }

  configureAccessory(accessory) {
    this.log.info('Restoring cached accessory: %s', accessory.displayName);
    this.accessories.set(accessory.UUID, accessory);
  }

  async discoverDevices() {
    const devices = this.config.devices || [];

    for (const deviceConfig of devices) {
      try {
        await this.setupDevice(deviceConfig);
      } catch (err) {
        this.log.error('Failed to setup device %s: %s', deviceConfig.name, err.message);
      }
    }
  }

  async setupDevice(deviceConfig) {
    // Layout version embedded in the UUID seed so that changing it
    // forces HomeKit to create a brand-new accessory with the
    // correct linked-service order.  Bump this when the service
    // layout changes.
    const LAYOUT_VERSION = 2;

    const seed = deviceConfig.connection === 'cloud'
      ? `ac-freedom-cloud-${deviceConfig.cloud?.email}-${deviceConfig.cloud?.deviceId || 'auto'}`
      : `ac-freedom-local-${deviceConfig.local?.ip}-${deviceConfig.local?.mac}`;

    const uuid = this.api.hap.uuid.generate(`${seed}-v${LAYOUT_VERSION}`);

    // Clean up any accessory with the OLD UUID (before version suffix)
    const oldUuid = this.api.hap.uuid.generate(seed);
    const staleAccessory = this.accessories.get(oldUuid);
    if (staleAccessory) {
      this.log.info('Removing old accessory (layout migration): %s', deviceConfig.name);
      this.api.unregisterPlatformAccessories('homebridge-ac-freedom', 'AcFreedom', [staleAccessory]);
      this.accessories.delete(oldUuid);
    }
    // Also clean up v1 UUID if present
    const v1Uuid = this.api.hap.uuid.generate(`${seed}-v1`);
    const v1Accessory = this.accessories.get(v1Uuid);
    if (v1Accessory) {
      this.log.info('Removing v1 accessory (layout migration): %s', deviceConfig.name);
      this.api.unregisterPlatformAccessories('homebridge-ac-freedom', 'AcFreedom', [v1Accessory]);
      this.accessories.delete(v1Uuid);
    }

    let existingAccessory = this.accessories.get(uuid);
    let deviceApi;

    if (deviceConfig.connection === 'cloud') {
      deviceApi = await this.setupCloudDevice(deviceConfig);
    } else {
      deviceApi = await this.setupLocalDevice(deviceConfig);
    }

    if (!deviceApi) return;

    if (existingAccessory) {
      this.log.info('Updating existing accessory: %s', deviceConfig.name);
      new AcFreedomAccessory(this, existingAccessory, deviceConfig, deviceApi);
      this.api.updatePlatformAccessories([existingAccessory]);
    } else {
      this.log.info('Adding new accessory: %s', deviceConfig.name);
      const accessory = new this.api.platformAccessory(
        deviceConfig.name,
        uuid,
      );
      new AcFreedomAccessory(this, accessory, deviceConfig, deviceApi);
      this.api.registerPlatformAccessories('homebridge-ac-freedom', 'AcFreedom', [accessory]);
      this.accessories.set(uuid, accessory);
    }
  }

  async setupCloudDevice(config) {
    const cloud = config.cloud;
    if (!cloud || !cloud.email || !cloud.password) {
      this.log.error('Cloud config missing email/password');
      return null;
    }

    const api = new AuxCloudAPI(cloud.region || 'eu');
    try {
      await api.login(cloud.email, cloud.password);
      this.log.info('Cloud login successful: %s', cloud.email);

      const families = await api.getFamilies();
      let devices = [];
      for (const fam of families) {
        const devs = await api.getDevices(fam.familyid);
        devices.push(...devs);
      }

      if (cloud.deviceId) {
        devices = devices.filter(d => d.endpointId === cloud.deviceId);
      }

      if (devices.length === 0) {
        this.log.error('No cloud devices found');
        return null;
      }

      // Use first matching device
      const device = devices[0];
      this.log.info('Cloud device: %s (%s)', device.friendlyName || 'AUX AC', device.endpointId);
      return { type: 'cloud', api, device };
    } catch (err) {
      this.log.error('Cloud login failed: %s', err.message);
      return null;
    }
  }

  async setupLocalDevice(config) {
    const local = config.local;
    if (!local || !local.ip || !local.mac) {
      this.log.error('Local config missing ip/mac');
      return null;
    }

    const api = new BroadlinkAcApi(local.ip, local.mac);
    try {
      const connected = await api.connect();
      if (!connected) {
        this.log.error('Failed to connect to local device at %s', local.ip);
        return null;
      }
      this.log.info('Local device connected: %s', local.ip);
      return { type: 'local', api };
    } catch (err) {
      this.log.error('Local connection failed: %s', err.message);
      return null;
    }
  }
}

module.exports = { AcFreedomPlatform };
