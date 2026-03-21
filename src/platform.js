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
    const uuid = this.api.hap.uuid.generate(
      deviceConfig.connection === 'cloud'
        ? `ac-freedom-cloud-${deviceConfig.cloudEmail}-${deviceConfig.cloudDeviceId || 'auto'}`
        : `ac-freedom-local-${deviceConfig.localIp}-${deviceConfig.localMac}`,
    );

    const existingAccessory = this.accessories.get(uuid);
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
      const accessory = new this.api.platformAccessory(deviceConfig.name, uuid);
      new AcFreedomAccessory(this, accessory, deviceConfig, deviceApi);
      this.api.registerPlatformAccessories('homebridge-ac-freedom', 'AcFreedom', [accessory]);
      this.accessories.set(uuid, accessory);
    }
  }

  async setupCloudDevice(config) {
    if (!config.cloudEmail || !config.cloudPassword) {
      this.log.error('Cloud config missing email/password');
      return null;
    }

    const api = new AuxCloudAPI(config.cloudRegion || 'eu');
    try {
      await api.login(config.cloudEmail, config.cloudPassword);
      this.log.info('Cloud login successful: %s', config.cloudEmail);

      const families = await api.getFamilies();
      let devices = [];
      for (const fam of families) {
        const devs = await api.getDevices(fam.familyid);
        devices.push(...devs);
      }

      if (config.cloudDeviceId) {
        devices = devices.filter(d => d.endpointId === config.cloudDeviceId);
      }

      if (devices.length === 0) {
        this.log.error('No cloud devices found');
        return null;
      }

      const device = devices[0];
      this.log.info('Cloud device: %s (%s)', device.friendlyName || 'AUX AC', device.endpointId);
      return { type: 'cloud', api, device };
    } catch (err) {
      this.log.error('Cloud login failed: %s', err.message);
      return null;
    }
  }

  async setupLocalDevice(config) {
    if (!config.localIp || !config.localMac) {
      this.log.error('Local config missing ip/mac');
      return null;
    }

    const api = new BroadlinkAcApi(config.localIp, config.localMac);
    try {
      const connected = await api.connect();
      if (!connected) {
        this.log.error('Failed to connect to local device at %s', local.ip);
        return null;
      }
      this.log.info('Local device connected: %s', config.localIp);
      return { type: 'local', api };
    } catch (err) {
      this.log.error('Local connection failed: %s', err.message);
      return null;
    }
  }
}

module.exports = { AcFreedomPlatform };
