/**
 * homebridge-ac-freedom
 *
 * Homebridge plugin for AUX air conditioners via Broadlink (local) and AUX Cloud API.
 * Exposes HeaterCooler with linked Switch services for presets inside the climate card.
 */

const { AcFreedomPlatform } = require('./src/platform');

const PLUGIN_NAME = 'homebridge-ac-freedom';
const PLATFORM_NAME = 'AcFreedom';

module.exports = (api) => {
  api.registerPlatform(PLUGIN_NAME, PLATFORM_NAME, AcFreedomPlatform);
};
