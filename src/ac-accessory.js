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

// Local ↔ cloud fan speed remap (mapping is self-inverse: 1↔3, others unchanged)
const FAN_REMAP = { 0: 0, 1: 3, 2: 2, 3: 1, 4: 4 };

// Cloud mode → local protocol mode byte (AUTO=0 avoids 3-bit overflow at value 8)
const LOCAL_MODE_MAP = {
  [4]: 0, // AUTO
  [0]: 1, // COOL
  [1]: 4, // HEAT
  [2]: 2, // DRY
  [3]: 6, // FAN
};

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
    this._reorderServices();

    // Start polling
    const interval = 30000;
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
        const newPower = value === C.Active.ACTIVE;
        if (newPower === this.state.power) return;
        this.state.power = newPower;
        if (!newPower) this._powerOffReset();
        this._powerJustChanged = true;
        setTimeout(() => { this._powerJustChanged = false; }, 300);
        await this._trySend(() => this.sendPower(newPower));
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
        // Wait for Active.onSet to fire first — HomeKit sends both in the same
        // batch but order is not guaranteed; 200 ms covers the race window.
        await new Promise(r => setTimeout(r, 200));
        if (this._powerJustChanged) return;
        await this._trySend(() => this.sendMode(mode));
      });

    this.heaterCooler.getCharacteristic(C.CurrentTemperature)
      .setProps({ minValue: -20, maxValue: 60 })
      .onGet(() => this.state.currentTemp);

    const snapTemp = (v) => Math.round(v);

    this.heaterCooler.getCharacteristic(C.CoolingThresholdTemperature)
      .setProps({ minValue: 16, maxValue: 32, minStep: 1 })
      .onGet(() => snapTemp(this.state.targetTemp))
      .onSet(async (value) => {
        const snapped = snapTemp(value);
        this.state.targetTemp = snapped;
        if (snapped !== value) {
          this.heaterCooler.updateCharacteristic(C.CoolingThresholdTemperature, snapped);
          this.heaterCooler.updateCharacteristic(C.HeatingThresholdTemperature, snapped);
        }
        await this._trySend(() => this.sendTemperature(snapped));
      });

    this.heaterCooler.getCharacteristic(C.HeatingThresholdTemperature)
      .setProps({ minValue: 16, maxValue: 32, minStep: 1 })
      .onGet(() => snapTemp(this.state.targetTemp))
      .onSet(async (value) => {
        const snapped = snapTemp(value);
        this.state.targetTemp = snapped;
        if (snapped !== value) {
          this.heaterCooler.updateCharacteristic(C.CoolingThresholdTemperature, snapped);
          this.heaterCooler.updateCharacteristic(C.HeatingThresholdTemperature, snapped);
        }
        await this._trySend(() => this.sendTemperature(snapped));
      });

    this.heaterCooler.getCharacteristic(C.SwingMode)
      .onGet(() => (this.state.swingV || this.state.swingH)
        ? C.SwingMode.SWING_ENABLED
        : C.SwingMode.SWING_DISABLED)
      .onSet(async (value) => {
        const on = value === C.SwingMode.SWING_ENABLED;
        this.state.swingV = on;
        this.state.swingH = on;
        await this._trySend(() => this.sendSwing(on, on));
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
        const newPower = value === C.Active.ACTIVE;
        if (newPower === this.state.power) return;
        this.state.power = newPower;
        if (!newPower) this._powerOffReset();
        this._powerJustChanged = true;
        setTimeout(() => { this._powerJustChanged = false; }, 300);
        await this._trySend(() => this.sendPower(newPower));
      });

    // 0=Auto  25=Low  50=Medium  75=High  100=Turbo
    this.fanService.getCharacteristic(C.RotationSpeed)
      .setProps({ minValue: 0, maxValue: 100, minStep: 25 })
      .onGet(() => this.state.power ? this.fanSpeedToPercent(this.state.fanSpeed) : 0)
      .onSet(async (value) => {
        this.state.fanSpeed = this.percentToFanSpeed(value);
        await this._trySend(() => this.sendFanSpeed(this.state.fanSpeed));
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
        .onGet(() => this.state.power && this.state[key])
        .onSet(async (value) => {
          if (value) {
            for (const otherKey of Object.keys(this.presetConfigs)) {
              if (otherKey !== key) this.state[otherKey] = false;
            }
          }
          this.state[key] = value;
          await this._trySend(() => this.sendPreset(key, value));
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
      .onGet(() => this.state.power && this.state.comfwind)
      .onSet(async (value) => {
        this.state.comfwind = value;
        await this._trySend(() => this.sendComfWind(value));
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
        await this._trySend(() => this.sendDisplay(value));
      });

    this.heaterCooler.addLinkedService(this.displaySwitch);
  }

  // ── Power-off UI reset ─────────────────────────────────────────
  // Updates HomeKit display only. No cloud commands — avoids interfering
  // with the power-off command and prevents spurious device wake-up.
  _powerOffReset() {
    this.state.fanSpeed = FAN_SPEED.AUTO;
    this.state.sleep    = false;
    if (this.fanService)
      this.fanService.updateCharacteristic(this.Characteristic.RotationSpeed, 0);
    if (this.presetSwitches?.sleep)
      this.presetSwitches.sleep.updateCharacteristic(this.Characteristic.On, false);
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
    if (this._pollLockUntil && Date.now() < this._pollLockUntil) return;
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
      const rawTarget  = (params[CLOUD.TEMP_TARGET]  ?? 240) / 10;
      const rawAmbient = (params[CLOUD.TEMP_AMBIENT] ?? 240) / 10;
      if (rawTarget  >= 16 && rawTarget  <= 32) this.state.targetTemp  = rawTarget;
      if (rawAmbient >= 0  && rawAmbient <= 60) this.state.currentTemp = rawAmbient;
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
    this.state.fanSpeed    = FAN_REMAP[s.fanSpeed] ?? FAN_SPEED.AUTO;
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

    const snapped = Math.round(this.state.targetTemp);
    this.heaterCooler.updateCharacteristic(C.CurrentTemperature,           this.state.currentTemp);
    this.heaterCooler.updateCharacteristic(C.CoolingThresholdTemperature,  snapped);
    this.heaterCooler.updateCharacteristic(C.HeatingThresholdTemperature,  snapped);
    this.heaterCooler.updateCharacteristic(C.SwingMode,
      (this.state.swingV || this.state.swingH) ? C.SwingMode.SWING_ENABLED : C.SwingMode.SWING_DISABLED);

    if (this.fanService) {
      this.fanService.updateCharacteristic(C.Active,
        this.state.power ? C.Active.ACTIVE : C.Active.INACTIVE);
      this.fanService.updateCharacteristic(C.RotationSpeed,
        this.state.power ? this.fanSpeedToPercent(this.state.fanSpeed) : 0);
    }

    for (const [key, svc] of Object.entries(this.presetSwitches || {})) {
      svc.updateCharacteristic(C.On, this.state.power && this.state[key]);
    }

    if (this.comfWindSwitch) {
      this.comfWindSwitch.updateCharacteristic(C.On, this.state.power && this.state.comfwind);
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

  // Wraps a send call for use inside onSet handlers.
  // Suppresses poll for 5 s after any command to avoid stale cloud state overriding UI.
  // Logs the error and throws HapStatusError so HomeKit shows failure correctly.
  async _trySend(fn) {
    try {
      await fn();
      this._pollLockUntil = Date.now() + 5000;
    } catch (err) {
      this.log.warn('%s: command failed: %s', this.config.name, err.message);
      throw new this.platform.api.hap.HapStatusError(
        this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE,
      );
    }
  }

  // ── Send commands ──────────────────────────────────────────────
  async sendPower(on) {
    return this._send(
      () => {
        const a = this._localApi;
        a.state.power = on ? 1 : 0;
        if (on)  a.state.mode     = LOCAL_MODE_MAP[this.state.mode] ?? 0;
        if (!on) a.state.fanSpeed = 0;
        return a.setState();
      },
      () => {
        const p = { [CLOUD.POWER]: on ? 1 : 0 };
        if (on)  p[CLOUD.MODE]      = this.state.mode;
        if (!on) p[CLOUD.FAN_SPEED] = 0;
        return this.cloudSet(p);
      },
    );
  }

  async sendMode(mode) {
    const pwr = this.state.power ? 1 : 0;
    return this._send(
      () => {
        const a = this._localApi;
        a.state.power = pwr;
        a.state.mode  = LOCAL_MODE_MAP[mode] ?? 0;
        return a.setState();
      },
      () => this.cloudSet({ [CLOUD.POWER]: pwr, [CLOUD.MODE]: mode }),
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
    const localSpeed = FAN_REMAP[speed] ?? 0;
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

  // ── Service ordering ───────────────────────────────────────────
  // Sorts accessory.services so HomeKit always shows tiles in the
  // correct order regardless of when each service was first added.
  _reorderServices() {
    const rank = (svc) => {
      const s = svc.subtype;
      if (svc.UUID === this.Service.AccessoryInformation.UUID) return 0;
      if (svc.UUID === this.Service.HeaterCooler.UUID)         return 1;
      if (s === 'fan')      return 2;
      if (s === 'sleep')    return 3;
      if (s === 'display')  return 4;
      if (s === 'health')   return 5;
      if (s === 'clean')    return 6;
      if (s === 'eco')      return 7;
      if (s === 'comfwind') return 8;
      return 99;
    };
    this.accessory.services.sort((a, b) => rank(a) - rank(b));

    // Rebuild linkedServices explicitly in the desired order so the HAP
    // "linked" array is sent correctly regardless of IID values.
    const linked = [
      this.fanService,
      this.presetSwitches?.sleep,
      this.displaySwitch,
      this.presetSwitches?.health,
      this.presetSwitches?.clean,
      this.presetSwitches?.eco,
      this.comfWindSwitch,
    ].filter(Boolean);
    this.heaterCooler.linkedServices.length = 0;
    for (const svc of linked) this.heaterCooler.linkedServices.push(svc);
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
