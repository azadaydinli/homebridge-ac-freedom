/**
 * Homebridge custom UI server-side handler.
 *
 * Provides a /fetchDevices endpoint so the config UI can log in to the
 * AUX Cloud API and return the list of discovered devices without
 * restarting Homebridge.
 *
 * Uses @homebridge/plugin-ui-utils (required by homebridge-config-ui-x v5+).
 */

'use strict';

const { HomebridgePluginUiServer } = require('@homebridge/plugin-ui-utils');

class AcFreedomUiServer extends HomebridgePluginUiServer {
  constructor() {
    super();
    this.onRequest('/fetchDevices', this.fetchDevices.bind(this));
    this.ready();
  }

  async fetchDevices(payload) {
    // Lazy-require so a load-time error never blocks the UI
    const { AuxCloudAPI } = require('../src/cloud-api');

    const { email, password, region } = payload || {};

    if (!email || !password) {
      throw new Error('Email and password are required');
    }

    const api = new AuxCloudAPI(region || 'eu');
    await api.login(email, password);

    const families = await api.getFamilies();
    const devices  = [];

    for (const fam of families) {
      const devs = await api.getDevices(fam.familyid);
      devices.push(...devs);
    }

    return {
      devices: devices.map(d => ({
        endpointId: d.endpointId,
        name:       d.friendlyName || 'AUX AC',
      })),
    };
  }
}

(() => { return new AcFreedomUiServer(); })();
