/**
 * AcFreedomPlatform
 *
 * Creates accessories for each configured device.
 *
 * Connection modes:
 *   hybrid    – Cloud login at platform level; devices auto-discovered.
 *               Each device may optionally have a local IP + MAC for
 *               direct Broadlink UDP control (preferred over cloud when
 *               available, falls back to cloud automatically).
 *   local     – Broadlink UDP only; no cloud credentials required.
 *
 * Backward compat: devices with connection === 'cloud' are treated as
 * hybrid using their per-device cloud credentials.
 */

'use strict';

const { AcFreedomAccessory } = require('./ac-accessory');
const { AuxCloudAPI }        = require('./cloud-api');
const { BroadlinkAcApi }    = require('./broadlink-api');

const PLUGIN_NAME   = 'homebridge-ac-freedom';
const PLATFORM_NAME = 'AcFreedom';

class AcFreedomPlatform {
  constructor(log, config, api) {
    this.log       = log;
    this.config    = config || {};
    this.api       = api;
    this.accessories = new Map();
    this.instances   = new Map(); // uuid → AcFreedomAccessory

    if (!api || !config) return;

    this.api.on('didFinishLaunching', () => {
      this.log.info('AC Freedom platform loaded');
      this.discoverDevices().catch(err => this.log.error('Fatal: %s', err.message));
    });
  }

  configureAccessory(accessory) {
    this.log.info('Restoring cached accessory: %s', accessory.displayName);
    this.accessories.set(accessory.UUID, accessory);
  }

  // ── Device discovery ───────────────────────────────────────────
  async discoverDevices() {
    const devices = this.config.devices || [];

    // Cloud login once for all hybrid devices
    let sharedCloud = null;
    const hasHybrid = devices.some(d =>
      !d.connection || d.connection === 'hybrid' || d.connection === 'cloud',
    );

    if (hasHybrid && this.config.cloud?.email) {
      sharedCloud = await this.setupSharedCloud(this.config.cloud);
    }

    for (const deviceConfig of devices) {
      try {
        await this.setupDevice(deviceConfig, sharedCloud);
      } catch (err) {
        this.log.error('Failed to setup device %s: %s', deviceConfig.name, err.message);
      }
    }
  }

  // ── Shared cloud session ───────────────────────────────────────
  async setupSharedCloud(cloudCreds) {
    const api = new AuxCloudAPI(cloudCreds.region || 'eu');
    try {
      await api.login(cloudCreds.email, cloudCreds.password);
      this.log.info('Cloud login successful: %s', cloudCreds.email);

      const families = await api.getFamilies();
      const allDevices = [];
      for (const fam of families) {
        const devs = await api.getDevices(fam.familyid);
        allDevices.push(...devs);
      }
      this.log.info('Found %d cloud device(s)', allDevices.length);
      return { api, devices: allDevices };
    } catch (err) {
      this.log.error('Cloud login failed: %s', err.message);
      return null;
    }
  }

  // ── Per-device setup ───────────────────────────────────────────
  async setupDevice(deviceConfig, sharedCloud) {
    const conn = deviceConfig.connection || 'hybrid';
    const isLocal = conn === 'local';

    const uuid = this.api.hap.uuid.generate(
      isLocal
        ? `ac-freedom-local-${deviceConfig.local?.ip}-${deviceConfig.local?.mac}`
        : `ac-freedom-hybrid-${deviceConfig.endpointId || deviceConfig.cloud?.deviceId || deviceConfig.name}`,
    );

    let deviceApi;
    if (isLocal) {
      deviceApi = await this.setupLocalDevice(deviceConfig);
    } else {
      // 'hybrid' and legacy 'cloud' both go through hybrid path
      deviceApi = await this.setupHybridDevice(deviceConfig, sharedCloud);
    }

    if (!deviceApi) return;

    // Destroy any existing instance to clear its poll timer and socket
    this.instances.get(uuid)?.destroy();

    const existingAccessory = this.accessories.get(uuid);
    if (existingAccessory) {
      this.log.info('Updating existing accessory: %s', deviceConfig.name);
      const instance = new AcFreedomAccessory(this, existingAccessory, deviceConfig, deviceApi);
      this.instances.set(uuid, instance);
      this.api.updatePlatformAccessories([existingAccessory]);
    } else {
      this.log.info('Adding new accessory: %s', deviceConfig.name);
      const accessory = new this.api.platformAccessory(deviceConfig.name, uuid);
      const instance = new AcFreedomAccessory(this, accessory, deviceConfig, deviceApi);
      this.instances.set(uuid, instance);
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      this.accessories.set(uuid, accessory);
    }
  }

  // ── Hybrid device (cloud + optional local) ─────────────────────
  async setupHybridDevice(deviceConfig, sharedCloud) {
    // Backward compat: per-device cloud credentials (old 'cloud' format)
    if (!sharedCloud && deviceConfig.cloud?.email) {
      const legacyCreds = {
        email:    deviceConfig.cloud.email,
        password: deviceConfig.cloud.password,
        region:   deviceConfig.cloud.region || 'eu',
      };
      sharedCloud = await this.setupSharedCloud(legacyCreds);
    }

    if (!sharedCloud) {
      // Cloud unavailable — fall back to local if IP+MAC is configured
      if (deviceConfig.local?.ip && deviceConfig.local?.mac) {
        this.log.warn(
          'Hybrid device %s: cloud unavailable — starting in local-only mode at %s',
          deviceConfig.name, deviceConfig.local.ip,
        );
        return this.setupLocalDevice(deviceConfig);
      }
      this.log.error(
        'Hybrid device %s: cloud unavailable and no local IP/MAC configured',
        deviceConfig.name,
      );
      return null;
    }

    // Resolve endpoint
    const endpointId = deviceConfig.endpointId || deviceConfig.cloud?.deviceId;
    let cloudDevice;
    if (endpointId) {
      cloudDevice = sharedCloud.devices.find(d => d.endpointId === endpointId);
      if (!cloudDevice) {
        // endpointId not found in cloud — fall back to local if available
        if (deviceConfig.local?.ip && deviceConfig.local?.mac) {
          this.log.warn(
            'Hybrid device %s: endpointId "%s" not found in cloud — starting in local-only mode',
            deviceConfig.name, endpointId,
          );
          return this.setupLocalDevice(deviceConfig);
        }
        this.log.error(
          'Hybrid device %s: endpointId "%s" not found among cloud devices',
          deviceConfig.name, endpointId,
        );
        return null;
      }
    } else {
      cloudDevice = sharedCloud.devices[0];
      if (!cloudDevice) {
        this.log.error('Hybrid device %s: no cloud devices found', deviceConfig.name);
        return null;
      }
    }

    // Try local connection (optional)
    let localApi = null;
    const localCfg = deviceConfig.local;
    if (localCfg?.ip && localCfg?.mac) {
      const broadlink = new BroadlinkAcApi(localCfg.ip, localCfg.mac);
      try {
        const connected = await broadlink.connect();
        if (connected) {
          this.log.info(
            'Hybrid device %s: local connected at %s (preferred)',
            deviceConfig.name, localCfg.ip,
          );
          localApi = broadlink;
        } else {
          this.log.warn(
            'Hybrid device %s: local connect failed at %s — using cloud fallback',
            deviceConfig.name, localCfg.ip,
          );
        }
      } catch (err) {
        this.log.warn(
          'Hybrid device %s: local connect error (%s) — using cloud fallback',
          deviceConfig.name, err.message,
        );
      }
    }

    this.log.info(
      'Hybrid device %s: %s (%s) via %s',
      deviceConfig.name,
      cloudDevice.friendlyName || 'AUX AC',
      cloudDevice.endpointId,
      localApi ? 'local+cloud' : 'cloud only',
    );

    return {
      type:        'hybrid',
      cloudApi:    sharedCloud.api,
      cloudDevice,
      localApi,
    };
  }

  // ── Local-only device ──────────────────────────────────────────
  async setupLocalDevice(config) {
    const local = config.local;
    if (!local?.ip || !local?.mac) {
      this.log.error('Local device %s: missing ip/mac in config', config.name);
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

module.exports = { AcFreedomPlatform, PLUGIN_NAME, PLATFORM_NAME };
