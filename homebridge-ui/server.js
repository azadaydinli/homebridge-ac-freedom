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

const FETCH_TIMEOUT_MS = 20000;

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

    // Overall timeout: ensures the server always responds even if a
    // network call hangs at the DNS or TCP-connect stage (req.setTimeout
    // only fires after the socket is open, so it cannot guard against DNS hangs).
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Request timed out — check your region setting and internet connection')), FETCH_TIMEOUT_MS)
    );

    return Promise.race([this._doFetch(AuxCloudAPI, email, password, region), timeoutPromise]);
  }

  async _doFetch(AuxCloudAPI, email, password, region) {
    const api = new AuxCloudAPI(region || 'eu');
    await api.login(email, password);

    const families = await api.getFamilies();
    const devices  = [];

    for (const fam of families) {
      const devs = await api.getDevices(fam.familyid, { fetchParams: false });
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
