/**
 * AcFreedomAccessory
 *
 * Exposes a HeaterCooler service with linked Fanv2 and Switch services.
 * Fan speed, preset modes (sleep, health, eco, clean) and display toggle
 * appear as tiles inside the climate card in HomeKit.
 */

'use strict';

// Cloud API param keys
const CLOUD = {
  POWER: 'pwr',
  MODE: 'ac_mode',
  TEMP_TARGET: 'temp',
  TEMP_AMBIENT: 'envtemp',
  FAN_SPEED: 'ac_mark',
  SWING_V: 'ac_vdir',
  SWING_H: 'ac_hdir',
  SLEEP: 'ac_slp',
  HEALTH: 'ac_health',
  ECO: 'mldprf',
  CLEAN: 'ac_clean',
  COMFWIND: 'comfwind',
  DISPLAY: 'scrdisp',
};

// Cloud mode values: 0=COOL, 1=HEAT, 2=DRY, 3=FAN, 4=AUTO
const CLOUD_MODE = { AUTO: 4, COOL: 0, HEAT: 1, DRY: 2, FAN: 3 };

// Fan speed values
const FAN_SPEED = { AUTO: 0, LOW: 1, MEDIUM: 2, HIGH: 3, TURBO: 4, MUTE: 5 };

class AcFreedomAccessory {
  constructor(platform, accessory, config, deviceApi) {
    this.platform = platform;
    this.accessory = accessory;
    this.config = config;
    this.deviceApi = deviceApi;
    this.log = platform.log;

    this.Service = platform.api.hap.Service;
    this.Characteristic = platform.api.hap.Characteristic;

    // Current state cache
    this.state = {
      power: false,
      mode: CLOUD_MODE.AUTO,
      targetTemp: 24,
      currentTemp: 24,
      fanSpeed: FAN_SPEED.AUTO,
      swingV: false,
      swingH: false,
      sleep: false,
      health: false,
      eco: false,
      clean: false,
      comfwind: false,
      display: true,
    };

    this.presetConfigs = {
      sleep: { label: 'Sleep Mode', cloudKey: CLOUD.SLEEP, localAttr: 'sleep' },
      health: { label: 'Health', cloudKey: CLOUD.HEALTH, localAttr: 'health' },
      eco: { label: 'Eco', cloudKey: CLOUD.ECO, localAttr: 'mildew' },
      clean: { label: 'Clean', cloudKey: CLOUD.CLEAN, localAttr: 'clean' },
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

  // ── Accessory Information ──────────────────────────────────────
  setupAccessoryInfo() {
    const infoService = this.accessory.getService(this.Service.AccessoryInformation)
      || this.accessory.addService(this.Service.AccessoryInformation);

    infoService
      .setCharacteristic(this.Characteristic.Manufacturer, 'AUX')
      .setCharacteristic(this.Characteristic.Model, 'AC Freedom')
      .setCharacteristic(this.Characteristic.SerialNumber, this.config.name || 'AC-001');
  }

  // ── HeaterCooler Service ───────────────────────────────────────
  setupHeaterCooler() {
    this.heaterCooler = this.accessory.getService(this.Service.HeaterCooler)
      || this.accessory.addService(this.Service.HeaterCooler, this.config.name);

    const C = this.Characteristic;

    // Active (on/off)
    this.heaterCooler.getCharacteristic(C.Active)
      .onGet(() => this.state.power ? C.Active.ACTIVE : C.Active.INACTIVE)
      .onSet(async (value) => {
        this.state.power = value === C.Active.ACTIVE;
        await this.sendPower(this.state.power);
      });

    // Current state
    this.heaterCooler.getCharacteristic(C.CurrentHeaterCoolerState)
      .onGet(() => {
        if (!this.state.power) return C.CurrentHeaterCoolerState.INACTIVE;
        switch (this.state.mode) {
          case CLOUD_MODE.HEAT: return C.CurrentHeaterCoolerState.HEATING;
          case CLOUD_MODE.COOL: return C.CurrentHeaterCoolerState.COOLING;
          default: return C.CurrentHeaterCoolerState.IDLE;
        }
      });

    // Target state – all HVAC modes always enabled (auto/heat/cool)
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
          default: return C.TargetHeaterCoolerState.AUTO;
        }
      })
      .onSet(async (value) => {
        let mode;
        switch (value) {
          case C.TargetHeaterCoolerState.HEAT: mode = CLOUD_MODE.HEAT; break;
          case C.TargetHeaterCoolerState.COOL: mode = CLOUD_MODE.COOL; break;
          default: mode = CLOUD_MODE.AUTO; break;
        }
        this.state.mode = mode;
        await this.sendMode(mode);
      });

    // Current temperature
    this.heaterCooler.getCharacteristic(C.CurrentTemperature)
      .setProps({ minValue: -20, maxValue: 60 })
      .onGet(() => this.state.currentTemp);

    // Cooling threshold temperature
    const step = this.config.tempStep || 0.5;
    this.heaterCooler.getCharacteristic(C.CoolingThresholdTemperature)
      .setProps({ minValue: 16, maxValue: 32, minStep: step })
      .onGet(() => this.state.targetTemp)
      .onSet(async (value) => {
        this.state.targetTemp = value;
        await this.sendTemperature(value);
      });

    // Heating threshold temperature
    this.heaterCooler.getCharacteristic(C.HeatingThresholdTemperature)
      .setProps({ minValue: 16, maxValue: 32, minStep: step })
      .onGet(() => this.state.targetTemp)
      .onSet(async (value) => {
        this.state.targetTemp = value;
        await this.sendTemperature(value);
      });

    // Swing mode
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

  // ── Fan Service (linked to HeaterCooler) ────────────────────────
  setupFanService() {
    const C = this.Characteristic;

    this.fanService = this.accessory.getServiceById(this.Service.Fanv2, 'fan')
      || this.accessory.addService(this.Service.Fanv2, 'Fan', 'fan');

    // Fan Active follows AC power
    this.fanService.getCharacteristic(C.Active)
      .onGet(() => this.state.power ? C.Active.ACTIVE : C.Active.INACTIVE)
      .onSet(async (value) => {
        this.state.power = value === C.Active.ACTIVE;
        await this.sendPower(this.state.power);
      });

    // Rotation speed: 0=auto, 20=mute, 40=low, 60=med, 80=high, 100=turbo
    this.fanService.getCharacteristic(C.RotationSpeed)
      .setProps({ minValue: 0, maxValue: 100, minStep: 1 })
      .onGet(() => this.fanSpeedToPercent(this.state.fanSpeed))
      .onSet(async (value) => {
        this.state.fanSpeed = this.percentToFanSpeed(value);
        await this.sendFanSpeed(this.state.fanSpeed);
      });

    // Link fan to HeaterCooler so it appears inside the climate card
    this.heaterCooler.addLinkedService(this.fanService);
  }

  // ── Preset Switches (linked to HeaterCooler) ──────────────────
  setupPresetSwitches() {
    const presets = this.config.presets || { sleep: true, health: true, eco: true, clean: true };

    this.presetSwitches = {};

    for (const [key, cfg] of Object.entries(this.presetConfigs)) {
      if (!presets[key]) continue;

      const switchService = this.accessory.getServiceById(this.Service.Switch, key)
        || this.accessory.addService(this.Service.Switch, cfg.label, key);

      switchService.setCharacteristic(this.Characteristic.Name, cfg.label);

      switchService.getCharacteristic(this.Characteristic.On)
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

      this.heaterCooler.addLinkedService(switchService);
      this.presetSwitches[key] = switchService;
    }
  }

  refreshPresetSwitches(exceptKey) {
    for (const [key, svc] of Object.entries(this.presetSwitches)) {
      if (key !== exceptKey) {
        svc.updateCharacteristic(this.Characteristic.On, this.state[key]);
      }
    }
  }

  // ── Comfortable Wind Switch (linked to HeaterCooler) ────────────
  setupComfWindSwitch() {
    if (this.config.showComfWind === false) return;

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

  // ── Display Switch (linked to HeaterCooler) ────────────────────
  setupDisplaySwitch() {
    if (this.config.showDisplay === false) return;

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

  // ── Fan speed mapping ──────────────────────────────────────────
  fanSpeedToPercent(speed) {
    const map = { 0: 0, 5: 20, 1: 40, 2: 60, 3: 80, 4: 100 };
    return map[speed] ?? 0;
  }

  percentToFanSpeed(pct) {
    if (pct <= 0) return FAN_SPEED.AUTO;
    if (pct <= 20) return FAN_SPEED.MUTE;
    if (pct <= 40) return FAN_SPEED.LOW;
    if (pct <= 60) return FAN_SPEED.MEDIUM;
    if (pct <= 80) return FAN_SPEED.HIGH;
    return FAN_SPEED.TURBO;
  }

  // ── Poll state ─────────────────────────────────────────────────
  async pollState() {
    try {
      if (this.deviceApi.type === 'cloud') {
        await this.pollCloud();
      } else {
        await this.pollLocal();
      }
      this.updateCharacteristics();
    } catch (err) {
      this.log.warn('Poll failed: %s', err.message);
    }
  }

  async pollCloud() {
    const { api, device } = this.deviceApi;
    try {
      const params = await api.getDeviceParams(device);
      if (!params) return;

      this.state.power = !!params[CLOUD.POWER];
      this.state.mode = params[CLOUD.MODE] ?? CLOUD_MODE.AUTO;
      this.state.targetTemp = (params[CLOUD.TEMP_TARGET] ?? 240) / 10;
      this.state.currentTemp = (params[CLOUD.TEMP_AMBIENT] ?? 240) / 10;
      this.state.fanSpeed = params[CLOUD.FAN_SPEED] ?? FAN_SPEED.AUTO;
      this.state.swingV = !!params[CLOUD.SWING_V];
      this.state.swingH = !!params[CLOUD.SWING_H];
      this.state.sleep = !!params[CLOUD.SLEEP];
      this.state.health = !!params[CLOUD.HEALTH];
      this.state.eco = !!params[CLOUD.ECO];
      this.state.clean = !!params[CLOUD.CLEAN];
      this.state.comfwind = !!params[CLOUD.COMFWIND];
      this.state.display = !!params[CLOUD.DISPLAY];
    } catch (err) {
      // Transient "server busy" errors — silently skip this cycle
      if (err.message && err.message.includes('server busy')) return;
      // Re-login on token expiry
      if (err.message && err.message.includes('token')) {
        const cloud = this.config.cloud;
        await api.login(cloud.email, cloud.password);
      }
      throw err;
    }
  }

  async pollLocal() {
    const { api } = this.deviceApi;
    const ok = await api.update();
    if (!ok) return;

    const s = api.state;
    this.state.power = !!s.power;
    this.state.targetTemp = s.temperature;
    this.state.currentTemp = s.ambientTemp;
    this.state.fanSpeed = s.fanSpeed;
    this.state.swingV = s.verticalFixation === 7;
    this.state.swingH = s.horizontalFixation === 7;
    this.state.sleep = !!s.sleep;
    this.state.health = !!s.health;
    this.state.eco = !!s.mildew;
    this.state.clean = !!s.clean;
    this.state.display = !!s.display;

    // Map local mode to cloud mode values
    const modeMap = { 1: CLOUD_MODE.COOL, 2: CLOUD_MODE.DRY, 4: CLOUD_MODE.HEAT, 6: CLOUD_MODE.FAN, 8: CLOUD_MODE.AUTO };
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
      switch (this.state.mode) {
        case CLOUD_MODE.HEAT:
          this.heaterCooler.updateCharacteristic(C.CurrentHeaterCoolerState,
            C.CurrentHeaterCoolerState.HEATING);
          break;
        case CLOUD_MODE.COOL:
          this.heaterCooler.updateCharacteristic(C.CurrentHeaterCoolerState,
            C.CurrentHeaterCoolerState.COOLING);
          break;
        default:
          this.heaterCooler.updateCharacteristic(C.CurrentHeaterCoolerState,
            C.CurrentHeaterCoolerState.IDLE);
      }
    }

    this.heaterCooler.updateCharacteristic(C.CurrentTemperature, this.state.currentTemp);
    this.heaterCooler.updateCharacteristic(C.CoolingThresholdTemperature, this.state.targetTemp);
    this.heaterCooler.updateCharacteristic(C.HeatingThresholdTemperature, this.state.targetTemp);
    this.heaterCooler.updateCharacteristic(C.SwingMode,
      (this.state.swingV || this.state.swingH) ? C.SwingMode.SWING_ENABLED : C.SwingMode.SWING_DISABLED);

    if (this.fanService) {
      this.fanService.updateCharacteristic(C.Active,
        this.state.power ? C.Active.ACTIVE : C.Active.INACTIVE);
      this.fanService.updateCharacteristic(C.RotationSpeed,
        this.fanSpeedToPercent(this.state.fanSpeed));
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

  // ── Send commands ──────────────────────────────────────────────
  async sendPower(on) {
    if (this.deviceApi.type === 'cloud') {
      await this.cloudSet({ [CLOUD.POWER]: on ? 1 : 0 });
    } else {
      this.deviceApi.api.state.power = on ? 1 : 0;
      await this.deviceApi.api.setState();
    }
  }

  async sendMode(mode) {
    if (this.deviceApi.type === 'cloud') {
      await this.cloudSet({ [CLOUD.POWER]: 1, [CLOUD.MODE]: mode });
    } else {
      const localModeMap = {
        [CLOUD_MODE.AUTO]: 8, [CLOUD_MODE.COOL]: 1,
        [CLOUD_MODE.HEAT]: 4, [CLOUD_MODE.DRY]: 2, [CLOUD_MODE.FAN]: 6,
      };
      const api = this.deviceApi.api;
      api.state.power = 1;
      api.state.mode = localModeMap[mode] ?? 8;
      await api.setState();
    }
  }

  async sendTemperature(temp) {
    if (this.deviceApi.type === 'cloud') {
      await this.cloudSet({ [CLOUD.TEMP_TARGET]: Math.round(temp * 10) });
    } else {
      this.deviceApi.api.state.temperature = temp;
      await this.deviceApi.api.setState();
    }
  }

  async sendFanSpeed(speed) {
    if (this.deviceApi.type === 'cloud') {
      await this.cloudSet({ [CLOUD.FAN_SPEED]: speed });
    } else {
      const api = this.deviceApi.api;
      api.state.fanSpeed = speed;
      api.state.turbo = speed === FAN_SPEED.TURBO ? 1 : 0;
      api.state.mute = speed === FAN_SPEED.MUTE ? 1 : 0;
      await api.setState();
    }
  }

  async sendSwing(v, h) {
    if (this.deviceApi.type === 'cloud') {
      await this.cloudSet({ [CLOUD.SWING_V]: v ? 1 : 0, [CLOUD.SWING_H]: h ? 1 : 0 });
    } else {
      const api = this.deviceApi.api;
      api.state.verticalFixation = v ? 7 : 0;
      api.state.horizontalFixation = h ? 7 : 0;
      await api.setState();
    }
  }

  async sendPreset(key, on) {
    const cfg = this.presetConfigs[key];
    if (!cfg) return;

    if (this.deviceApi.type === 'cloud') {
      const update = {
        [CLOUD.SLEEP]: 0,
        [CLOUD.HEALTH]: 0,
        [CLOUD.ECO]: 0,
        [CLOUD.CLEAN]: 0,
      };
      if (on) update[cfg.cloudKey] = 1;
      await this.cloudSet(update);
    } else {
      const api = this.deviceApi.api;
      api.state.sleep = 0;
      api.state.health = 0;
      api.state.mildew = 0;
      api.state.clean = 0;
      if (on) api.state[cfg.localAttr] = 1;
      await api.setState();
    }
  }

  async sendComfWind(on) {
    if (this.deviceApi.type === 'cloud') {
      await this.cloudSet({ [CLOUD.COMFWIND]: on ? 1 : 0 });
    } else {
      this.deviceApi.api.state.comfwind = on ? 1 : 0;
      await this.deviceApi.api.setState();
    }
  }

  async sendDisplay(on) {
    if (this.deviceApi.type === 'cloud') {
      await this.cloudSet({ [CLOUD.DISPLAY]: on ? 1 : 0 });
    } else {
      this.deviceApi.api.state.display = on ? 1 : 0;
      await this.deviceApi.api.setState();
    }
  }

  async cloudSet(params) {
    const { api, device } = this.deviceApi;
    await api.setDeviceParams(device, params);
  }
}

module.exports = { AcFreedomAccessory };
