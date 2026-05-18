/**
 * AcFreedomAccessory
 *
 * Exposes a HeaterCooler service with linked Fanv2 and Switch services.
 * Fan speed, preset modes (sleep, health, eco, clean) and display toggle
 * appear as tiles inside the climate card in HomeKit.
 *
 * deviceApi shapes:
 *   { type: 'hybrid', cloudApi, cloudDevice, localApi }   ← preferred
 *   { type: 'local',  api }                               ← local-only
 *   { type: 'cloud',  api, device }                       ← legacy (treated as hybrid)
 */

'use strict';

// Cloud API param keys
const CLOUD = {
  POWER:        'pwr',
  MODE:         'ac_mode',
  TEMP_TARGET:  'temp',
  TEMP_AMBIENT: 'envtemp',
  FAN_SPEED:    'ac_mark',
  SWING_V:      'ac_vdir',
  SWING_H:      'ac_hdir',
  SLEEP:        'ac_slp',
  HEALTH:       'ac_health',
  ECO:          'mldprf',
  CLEAN:        'ac_clean',
  COMFWIND:     'comfwind',
  DISPLAY:      'scrdisp',
};

// Cloud mode values: 0=COOL, 1=HEAT, 2=DRY, 3=FAN, 4=AUTO
const CLOUD_MODE = { AUTO: 4, COOL: 0, HEAT: 1, DRY: 2, FAN: 3 };

// Fan speed values (canonical cloud numbering — stored in state.fanSpeed)
// AUTO=0  LOW=1  MEDIUM=2  HIGH=3  TURBO=4
// Local device uses: AUTO=0  fast=1(=HIGH)  medium=2  slow=3(=LOW)  turbo=4
// Conversion tables applied in pollLocal / sendFanSpeed
const FAN_SPEED = { AUTO: 0, LOW: 1, MEDIUM: 2, HIGH: 3, TURBO: 4 };

// Local ↔ canonical (cloud) fan speed conversion
const LOCAL_TO_CLOUD_FAN = { 0: 0, 1: 3, 2: 2, 3: 1, 4: 4 };
const CLOUD_TO_LOCAL_FAN = { 0: 0, 1: 3, 2: 2, 3: 1, 4: 4 };

class AcFreedomAccessory {
  constructor(platform, accessory, config, deviceApi) {
    this.platform  = platform;
    this.accessory = accessory;
    this.config    = config;
    this.deviceApi = deviceApi;
    this.log       = platform.log;

    this.Service        = platform.api.hap.Service;
    this.Characteristic = platform.api.hap.Characteristic;

    // Current state cache (fan speed always in canonical cloud numbering)
    this.state = {
      power:       false,
      mode:        CLOUD_MODE.AUTO,
      targetTemp:  24,
      currentTemp: 24,
      fanSpeed:    FAN_SPEED.AUTO,
      swingV:      false,
      swingH:      false,
      sleep:       false,
      health:      false,
      eco:         false,
      clean:       false,
      comfwind:    false,
      display:     true,
    };

    this.presetConfigs = {
      sleep:  { label: 'Sleep Mode', cloudKey: CLOUD.SLEEP,  localAttr: 'sleep'  },
      health: { label: 'Health',     cloudKey: CLOUD.HEALTH, localAttr: 'health' },
      eco:    { label: 'Eco',        cloudKey: CLOUD.ECO,    localAttr: 'mildew' },
      clean:  { label: 'Clean',      cloudKey: CLOUD.CLEAN,  localAttr: 'clean'  },
    };

    this.setupAccessoryInfo();
    this.setupHeaterCooler();
    this.setupFanService();
    this.setupPresetSwitches();
    this.setupComfWindSwitch();
    this.setupDisplaySwitch();

    // Start polling
    const interval = (config.pollInterval || 30) * 1000;
    this.pollTimer = setInterval(() => this.pollState(), interval);
    this.pollState();
  }

  // ── Unified API accessors ──────────────────────────────────────
  // These normalise both new hybrid shape and legacy cloud/local shapes.
  get _cloudApi()    { return this.deviceApi.cloudApi    || this.deviceApi.api; }
  get _cloudDevice() { return this.deviceApi.cloudDevice || this.deviceApi.device; }
  get _localApi()    { return this.deviceApi.localApi    || this.deviceApi.api; }

  // Cloud credentials for re-login (platform-level first, then per-device fallback)
  get _cloudCreds() {
    return this.platform.config?.cloud || this.config.cloud;
  }

  // ── Accessory Information ──────────────────────────────────────
  setupAccessoryInfo() {
    const svc = this.accessory.getService(this.Service.AccessoryInformation)
      || this.accessory.addService(this.Service.AccessoryInformation);

    svc.setCharacteristic(this.Characteristic.Manufacturer, 'AUX')
       .setCharacteristic(this.Characteristic.Model,        'AC Freedom')
       .setCharacteristic(this.Characteristic.SerialNumber, this.config.name || 'AC-001');
  }

  // ── HeaterCooler Service ───────────────────────────────────────
  setupHeaterCooler() {
    this.heaterCooler = this.accessory.getService(this.Service.HeaterCooler)
      || this.accessory.addService(this.Service.HeaterCooler, this.config.name);

    const C = this.Characteristic;

    this.heaterCooler.getCharacteristic(C.Active)
      .onGet(() => this.state.power ? C.Active.ACTIVE : C.Active.INACTIVE)
      .onSet(async (value) => {
        this.state.power = value === C.Active.ACTIVE;
        await this.sendPower(this.state.power);
        if (!this.state.power) { this.resetFanToAuto(); this.resetSleep(); }
      });

    this.heaterCooler.getCharacteristic(C.CurrentHeaterCoolerState)
      .onGet(() => {
        if (!this.state.power) return C.CurrentHeaterCoolerState.INACTIVE;
        switch (this.state.mode) {
          case CLOUD_MODE.HEAT: return C.CurrentHeaterCoolerState.HEATING;
          case CLOUD_MODE.COOL: return C.CurrentHeaterCoolerState.COOLING;
          default:              return C.CurrentHeaterCoolerState.IDLE;
        }
      });

    this.heaterCooler.getCharacteristic(C.TargetHeaterCoolerState)
      .setProps({
        validValues: [
          C.TargetHeaterCoolerState.AUTO,
          C.TargetHeaterCoolerState.HEAT,
          C.TargetHeaterCoolerState.COOL,
        ],
      })
      .onGet(() => {
        switch (this.state.mode) {
          case CLOUD_MODE.HEAT: return C.TargetHeaterCoolerState.HEAT;
          case CLOUD_MODE.COOL: return C.TargetHeaterCoolerState.COOL;
          default:              return C.TargetHeaterCoolerState.AUTO;
        }
      })
      .onSet(async (value) => {
        let mode;
        switch (value) {
          case C.TargetHeaterCoolerState.HEAT: mode = CLOUD_MODE.HEAT; break;
          case C.TargetHeaterCoolerState.COOL: mode = CLOUD_MODE.COOL; break;
          default:                             mode = CLOUD_MODE.AUTO; break;
        }
        this.state.mode = mode;
        await this.sendMode(mode);
        this.resetFanToAuto(true);
        this.resetSleep();
      });

    this.heaterCooler.getCharacteristic(C.CurrentTemperature)
      .setProps({ minValue: -20, maxValue: 60 })
      .onGet(() => this.state.currentTemp);

    const step = this.config.tempStep || 0.5;
    this.heaterCooler.getCharacteristic(C.CoolingThresholdTemperature)
      .setProps({ minValue: 16, maxValue: 32, minStep: step })
      .onGet(() => this.state.targetTemp)
      .onSet(async (value) => {
        this.state.targetTemp = value;
        await this.sendTemperature(value);
      });

    this.heaterCooler.getCharacteristic(C.HeatingThresholdTemperature)
      .setProps({ minValue: 16, maxValue: 32, minStep: step })
      .onGet(() => this.state.targetTemp)
      .onSet(async (value) => {
        this.state.targetTemp = value;
        await this.sendTemperature(value);
      });

    this.heaterCooler.getCharacteristic(C.SwingMode)
      .onGet(() => (this.state.swingV || this.state.swingH)
        ? C.SwingMode.SWING_ENABLED
        : C.SwingMode.SWING_DISABLED)
      .onSet(async (value) => {
        const on = value === C.SwingMode.SWING_ENABLED;
        this.state.swingV = on;
        this.state.swingH = on;
        await this.sendSwing(on, on);
      });
  }

  // ── Fan Service ────────────────────────────────────────────────
  setupFanService() {
    // Remove legacy services from old beta versions
    for (const [Svc, id] of [
      [this.Service.SecuritySystem, 'fan'],
      [this.Service.Television, 'fan-tv'],
    ]) {
      const old = this.accessory.getServiceById(Svc, id);
      if (old) this.accessory.removeService(old);
    }
    for (const sid of ['fan-0', 'fan-1', 'fan-2', 'fan-3']) {
      const src = this.accessory.getServiceById(this.Service.InputSource, sid);
      if (src) this.accessory.removeService(src);
    }

    if (this.config.showFan === false) {
      const existing = this.accessory.getServiceById(this.Service.Fanv2, 'fan');
      if (existing) this.accessory.removeService(existing);
      return;
    }

    const C = this.Characteristic;

    this.fanService = this.accessory.getServiceById(this.Service.Fanv2, 'fan')
      || this.accessory.addService(this.Service.Fanv2, 'Fan', 'fan');

    this.fanService.getCharacteristic(C.Active)
      .onGet(() => this.state.power ? C.Active.ACTIVE : C.Active.INACTIVE)
      .onSet(async (value) => {
        this.state.power = value === C.Active.ACTIVE;
        await this.sendPower(this.state.power);
        if (!this.state.power) { this.resetFanToAuto(); this.resetSleep(); }
      });

    // 0=Auto  25=Low  50=Medium  75=High  100=Turbo
    this.fanService.getCharacteristic(C.RotationSpeed)
      .setProps({ minValue: 0, maxValue: 100, minStep: 25 })
      .onGet(() => this.fanSpeedToPercent(this.state.fanSpeed))
      .onSet(async (value) => {
        this.state.fanSpeed = this.percentToFanSpeed(value);
        await this.sendFanSpeed(this.state.fanSpeed);
      });

    this.heaterCooler.addLinkedService(this.fanService);
  }

  // ── Preset Switches ────────────────────────────────────────────
  setupPresetSwitches() {
    const presets = this.config.presets || { sleep: true, health: true, eco: true, clean: true };
    this.presetSwitches = {};

    for (const [key, cfg] of Object.entries(this.presetConfigs)) {
      if (!presets[key]) {
        const existing = this.accessory.getServiceById(this.Service.Switch, key);
        if (existing) this.accessory.removeService(existing);
        continue;
      }

      const svc = this.accessory.getServiceById(this.Service.Switch, key)
        || this.accessory.addService(this.Service.Switch, cfg.label, key);

      svc.setCharacteristic(this.Characteristic.Name, cfg.label);

      svc.getCharacteristic(this.Characteristic.On)
        .onGet(() => this.state[key])
        .onSet(async (value) => {
          if (value) {
            for (const otherKey of Object.keys(this.presetConfigs)) {
              if (otherKey !== key) this.state[otherKey] = false;
            }
          }
          this.state[key] = value;
          await this.sendPreset(key, value);
          this.refreshPresetSwitches(key);
        });

      this.heaterCooler.addLinkedService(svc);
      this.presetSwitches[key] = svc;
    }
  }

  refreshPresetSwitches(exceptKey) {
    for (const [key, svc] of Object.entries(this.presetSwitches)) {
      if (key !== exceptKey) {
        svc.updateCharacteristic(this.Characteristic.On, this.state[key]);
      }
    }
  }

  // ── Comfortable Wind Switch ────────────────────────────────────
  setupComfWindSwitch() {
    if (this.config.showComfWind === false) {
      const existing = this.accessory.getServiceById(this.Service.Switch, 'comfwind');
      if (existing) this.accessory.removeService(existing);
      return;
    }

    this.comfWindSwitch = this.accessory.getServiceById(this.Service.Switch, 'comfwind')
      || this.accessory.addService(this.Service.Switch, 'Comfortable Wind', 'comfwind');

    this.comfWindSwitch.setCharacteristic(this.Characteristic.Name, 'Comfortable Wind');

    this.comfWindSwitch.getCharacteristic(this.Characteristic.On)
      .onGet(() => this.state.comfwind)
      .onSet(async (value) => {
        this.state.comfwind = value;
        await this.sendComfWind(value);
      });

    this.heaterCooler.addLinkedService(this.comfWindSwitch);
  }

  // ── Display Switch ─────────────────────────────────────────────
  setupDisplaySwitch() {
    if (this.config.showDisplay === false) {
      const existing = this.accessory.getServiceById(this.Service.Switch, 'display');
      if (existing) this.accessory.removeService(existing);
      return;
    }

    this.displaySwitch = this.accessory.getServiceById(this.Service.Switch, 'display')
      || this.accessory.addService(this.Service.Switch, 'Display', 'display');

    this.displaySwitch.setCharacteristic(this.Characteristic.Name, 'Display');

    this.displaySwitch.getCharacteristic(this.Characteristic.On)
      .onGet(() => this.state.display)
      .onSet(async (value) => {
        this.state.display = value;
        await this.sendDisplay(value);
      });

    this.heaterCooler.addLinkedService(this.displaySwitch);
  }

  // ── Fan speed helpers ──────────────────────────────────────────
  resetFanToAuto(sendCommand = false) {
    this.state.fanSpeed = FAN_SPEED.AUTO;
    if (this.fanService) {
      this.fanService.updateCharacteristic(this.Characteristic.RotationSpeed, 0);
    }
    if (sendCommand) this.sendFanSpeed(FAN_SPEED.AUTO).catch(() => {});
  }

  resetSleep() {
    if (!this.state.sleep) return;
    this.state.sleep = false;
    if (this.presetSwitches?.sleep) {
      this.presetSwitches.sleep.updateCharacteristic(this.Characteristic.On, false);
    }
    this.sendPreset('sleep', false).catch(() => {});
  }

  // Fan speed ↔ HomeKit percent (canonical cloud numbering)
  // 0=Auto(0%)  1=Low(25%)  2=Medium(50%)  3=High(75%)  4=Turbo(100%)
  fanSpeedToPercent(speed) {
    const map = { 0: 0, 1: 25, 2: 50, 3: 75, 4: 100 };
    return map[speed] ?? 0;
  }

  percentToFanSpeed(pct) {
    if (pct <= 0)  return FAN_SPEED.AUTO;
    if (pct <= 37) return FAN_SPEED.LOW;
    if (pct <= 62) return FAN_SPEED.MEDIUM;
    if (pct <= 87) return FAN_SPEED.HIGH;
    return FAN_SPEED.TURBO;
  }

  // ── Poll state ─────────────────────────────────────────────────
  async pollState() {
    try {
      const t = this.deviceApi.type;
      if (t === 'local') {
        await this.pollLocal();
      } else if (t === 'cloud') {
        await this.pollCloud();
      } else {
        // hybrid: try local first, fall back to cloud
        await this.pollHybrid();
      }
      this.updateCharacteristics();
    } catch (err) {
      this.log.warn('Poll failed: %s', err.message);
    }
  }

  async pollHybrid() {
    if (this.deviceApi.localApi) {
      try {
        await this.pollLocal();
        return;
      } catch (err) {
        this.log.debug('Hybrid: local poll failed (%s), falling back to cloud', err.message);
      }
    }
    await this.pollCloud();
  }

  async pollCloud() {
    try {
      const params = await this._cloudApi.getDeviceParams(this._cloudDevice);
      if (!params) return;

      this.state.power       = !!params[CLOUD.POWER];
      this.state.mode        = params[CLOUD.MODE]       ?? CLOUD_MODE.AUTO;
      this.state.targetTemp  = (params[CLOUD.TEMP_TARGET]  ?? 240) / 10;
      this.state.currentTemp = (params[CLOUD.TEMP_AMBIENT] ?? 240) / 10;
      this.state.fanSpeed    = params[CLOUD.FAN_SPEED]  ?? FAN_SPEED.AUTO;
      this.state.swingV      = !!params[CLOUD.SWING_V];
      this.state.swingH      = !!params[CLOUD.SWING_H];
      this.state.sleep       = !!params[CLOUD.SLEEP];
      this.state.health      = !!params[CLOUD.HEALTH];
      this.state.eco         = !!params[CLOUD.ECO];
      this.state.clean       = !!params[CLOUD.CLEAN];
      this.state.comfwind    = !!params[CLOUD.COMFWIND];
      this.state.display     = !!params[CLOUD.DISPLAY];
    } catch (err) {
      if (err.message?.includes('server busy')) return;
      if (err.message?.includes('token')) {
        const creds = this._cloudCreds;
        if (creds) await this._cloudApi.login(creds.email, creds.password);
      }
      throw err;
    }
  }

  async pollLocal() {
    const api = this._localApi;
    const ok  = await api.update();
    if (!ok) return;

    const s = api.state;
    this.state.power       = !!s.power;
    this.state.targetTemp  = s.temperature;
    this.state.currentTemp = s.ambientTemp;
    // Normalise local fan speed → canonical cloud numbering
    this.state.fanSpeed    = LOCAL_TO_CLOUD_FAN[s.fanSpeed] ?? FAN_SPEED.AUTO;
    this.state.swingV      = s.verticalFixation === 7;
    this.state.swingH      = s.horizontalFixation === 7;
    this.state.sleep       = !!s.sleep;
    this.state.health      = !!s.health;
    this.state.eco         = !!s.mildew;
    this.state.clean       = !!s.clean;
    this.state.comfwind    = !!s.comfwind;
    this.state.display     = !!s.display;

    // AUTO is 0 in the local protocol; 8 is unused (3-bit shift max = 7)
    const modeMap = { 0: CLOUD_MODE.AUTO, 1: CLOUD_MODE.COOL, 2: CLOUD_MODE.DRY, 4: CLOUD_MODE.HEAT, 6: CLOUD_MODE.FAN };
    this.state.mode = modeMap[s.mode] ?? CLOUD_MODE.AUTO;
  }

  updateCharacteristics() {
    const C = this.Characteristic;

    this.heaterCooler.updateCharacteristic(C.Active,
      this.state.power ? C.Active.ACTIVE : C.Active.INACTIVE);

    if (!this.state.power) {
      this.heaterCooler.updateCharacteristic(C.CurrentHeaterCoolerState,
        C.CurrentHeaterCoolerState.INACTIVE);
    } else {
      const hcState = {
        [CLOUD_MODE.HEAT]: C.CurrentHeaterCoolerState.HEATING,
        [CLOUD_MODE.COOL]: C.CurrentHeaterCoolerState.COOLING,
      }[this.state.mode] ?? C.CurrentHeaterCoolerState.IDLE;
      this.heaterCooler.updateCharacteristic(C.CurrentHeaterCoolerState, hcState);
    }

    this.heaterCooler.updateCharacteristic(C.CurrentTemperature,           this.state.currentTemp);
    this.heaterCooler.updateCharacteristic(C.CoolingThresholdTemperature,  this.state.targetTemp);
    this.heaterCooler.updateCharacteristic(C.HeatingThresholdTemperature,  this.state.targetTemp);
    this.heaterCooler.updateCharacteristic(C.SwingMode,
      (this.state.swingV || this.state.swingH) ? C.SwingMode.SWING_ENABLED : C.SwingMode.SWING_DISABLED);

    if (this.fanService) {
      this.fanService.updateCharacteristic(C.Active,
        this.state.power ? C.Active.ACTIVE : C.Active.INACTIVE);
      this.fanService.updateCharacteristic(C.RotationSpeed,
        this.state.power ? this.fanSpeedToPercent(this.state.fanSpeed) : 0);
    }

    for (const [key, svc] of Object.entries(this.presetSwitches || {})) {
      svc.updateCharacteristic(C.On, this.state[key]);
    }

    if (this.comfWindSwitch) {
      this.comfWindSwitch.updateCharacteristic(C.On, this.state.comfwind);
    }
    if (this.displaySwitch) {
      this.displaySwitch.updateCharacteristic(C.On, this.state.display);
    }
  }

  // ── Hybrid send helper ─────────────────────────────────────────
  // Tries local first; falls back to cloud on error.
  async hybridSend(localFn, cloudFn) {
    if (this.deviceApi.localApi) {
      try {
        return await localFn();
      } catch (err) {
        this.log.warn('Hybrid: local command failed (%s) — using cloud', err.message);
      }
    }
    return cloudFn();
  }

  // Routes to local, hybrid, or cloud based on connection type.
  async _send(localFn, cloudFn) {
    const t = this.deviceApi.type;
    if (t === 'local')  return localFn();
    if (t === 'hybrid') return this.hybridSend(localFn, cloudFn);
    return cloudFn(); // legacy 'cloud' type
  }

  // ── Send commands ──────────────────────────────────────────────
  async sendPower(on) {
    return this._send(
      () => { const a = this._localApi; a.state.power = on ? 1 : 0; return a.setState(); },
      () => this.cloudSet({ [CLOUD.POWER]: on ? 1 : 0 }),
    );
  }

  async sendMode(mode) {
    // AUTO is 0 in local protocol (mode=8 would overflow the 3-bit field)
    const localModeMap = {
      [CLOUD_MODE.AUTO]: 0, [CLOUD_MODE.COOL]: 1,
      [CLOUD_MODE.HEAT]: 4, [CLOUD_MODE.DRY]: 2, [CLOUD_MODE.FAN]: 6,
    };
    return this._send(
      () => {
        const a = this._localApi;
        a.state.power = 1;
        a.state.mode  = localModeMap[mode] ?? 0;
        return a.setState();
      },
      () => this.cloudSet({ [CLOUD.POWER]: 1, [CLOUD.MODE]: mode }),
    );
  }

  async sendTemperature(temp) {
    return this._send(
      () => { const a = this._localApi; a.state.temperature = temp; return a.setState(); },
      () => this.cloudSet({ [CLOUD.TEMP_TARGET]: Math.round(temp * 10) }),
    );
  }

  async sendFanSpeed(speed) {
    // speed is canonical cloud numbering; convert for local
    const localSpeed = CLOUD_TO_LOCAL_FAN[speed] ?? 0;
    return this._send(
      () => {
        const a = this._localApi;
        a.state.fanSpeed = localSpeed;
        a.state.turbo    = speed === FAN_SPEED.TURBO ? 1 : 0;
        a.state.mute     = 0;
        return a.setState();
      },
      () => this.cloudSet({ [CLOUD.FAN_SPEED]: speed }),
    );
  }

  async sendSwing(v, h) {
    return this._send(
      () => {
        const a = this._localApi;
        a.state.verticalFixation   = v ? 7 : 0;
        a.state.horizontalFixation = h ? 7 : 0;
        return a.setState();
      },
      () => this.cloudSet({ [CLOUD.SWING_V]: v ? 1 : 0, [CLOUD.SWING_H]: h ? 1 : 0 }),
    );
  }

  async sendPreset(key, on) {
    const cfg = this.presetConfigs[key];
    if (!cfg) return;
    const cloudUpdate = {
      [CLOUD.SLEEP]: 0, [CLOUD.HEALTH]: 0,
      [CLOUD.ECO]: 0,   [CLOUD.CLEAN]: 0,
    };
    if (on) cloudUpdate[cfg.cloudKey] = 1;
    return this._send(
      () => {
        const a = this._localApi;
        a.state.sleep = 0; a.state.health = 0;
        a.state.mildew = 0; a.state.clean = 0;
        if (on) a.state[cfg.localAttr] = 1;
        return a.setState();
      },
      () => this.cloudSet(cloudUpdate),
    );
  }

  async sendComfWind(on) {
    return this._send(
      () => { const a = this._localApi; a.state.comfwind = on ? 1 : 0; return a.setState(); },
      () => this.cloudSet({ [CLOUD.COMFWIND]: on ? 1 : 0 }),
    );
  }

  async sendDisplay(on) {
    return this._send(
      () => { const a = this._localApi; a.state.display = on ? 1 : 0; return a.setState(); },
      () => this.cloudSet({ [CLOUD.DISPLAY]: on ? 1 : 0 }),
    );
  }

  async cloudSet(params) {
    await this._cloudApi.setDeviceParams(this._cloudDevice, params);
  }

  // ── Cleanup ────────────────────────────────────────────────────
  destroy() {
    if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = null; }
    if (this.deviceApi?.localApi?.disconnect) {
      this.deviceApi.localApi.disconnect().catch(() => {});
    }
  }
}

module.exports = { AcFreedomAccessory };
