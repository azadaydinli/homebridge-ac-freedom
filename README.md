<p align="center">
  <img src="https://raw.githubusercontent.com/azadaydinli/homebridge-ac-freedom/main/banner.svg" width="800">
</p>

<span align="center">

# Homebridge AC Freedom

A [Homebridge](https://homebridge.io) plugin for controlling **AUX-based air conditioners** via **Apple HomeKit**. Works with any AC that uses the **AC Freedom** app. Supports **Cloud** (AUX API) and **Local** (Broadlink UDP) connections — no extra hub required.

[![verified-by-homebridge](https://img.shields.io/badge/homebridge-verified-blueviolet?color=%23491F59&style=flat&logoColor=%23FFFFFF&logo=homebridge)](https://github.com/homebridge/homebridge/wiki/Verified-Plugins)
[![npm](https://img.shields.io/npm/v/homebridge-ac-freedom)](https://www.npmjs.com/package/homebridge-ac-freedom)
[![npm](https://img.shields.io/npm/dw/homebridge-ac-freedom)](https://www.npmjs.com/package/homebridge-ac-freedom)
[![npm](https://img.shields.io/npm/dt/homebridge-ac-freedom)](https://www.npmjs.com/package/homebridge-ac-freedom)
[![Ko-fi](https://img.shields.io/badge/Support%20on-Ko--fi-FF5E5B?logo=ko-fi&logoColor=white)](https://ko-fi.com/azadaydinli)
[![GitHub Sponsors](https://img.shields.io/badge/Sponsor-%E2%9D%A4-ea4aaa?logo=github)](https://github.com/sponsors/azadaydinli)

</span>

---

## Features

- **HeaterCooler** tile — Auto, Heat, Cool modes
- **Fan speed** control — Auto / Low / Medium / High / Turbo (25% steps)
- **Swing** mode — vertical + horizontal
- **Preset switches** inside the climate card:
  - Sleep Mode
  - Health / Ionizer
  - Eco / Mildew Prevention
  - Self Clean
  - Comfortable Wind
- **Display** switch — LED display on/off
- **Auto-reset** — fan and sleep reset to default when AC turns on or off
- **Cloud** — AUX Cloud API via AC Freedom app credentials
- **Local** — Direct Broadlink UDP, no internet required
- **Multi-device** — configure as many ACs as needed
- Homebridge v1 & v2 compatible

---

## Supported Brands

Any air conditioner compatible with the **AC Freedom** app is supported:

| | | | |
|---|---|---|---|
| AUX | Ballu | Centek | Dunham Bush |
| Kenwood | Rinnai | Rcool | Tornado |
| Akai | Hyundai | Hisense | Royal Clima |

---

## Requirements

- [Homebridge](https://homebridge.io) v1.6.0 or later (v2 supported)
- Node.js v18.0.0 or later
- An AUX-compatible AC with Wi-Fi (Broadlink module)
- **Cloud:** AC Freedom app account (email registration)
- **Local:** AC's IP and MAC address on your local network

---

## Installation

**Via Homebridge UI (recommended):**

1. Open the Homebridge UI → **Plugins**
2. Search for `homebridge-ac-freedom`
3. Click **Install**

**Via terminal:**

```bash
npm install -g homebridge-ac-freedom
```

---

## Configuration

### Cloud Mode

```json
{
  "platforms": [
    {
      "platform": "AcFreedom",
      "name": "AC Freedom",
      "devices": [
        {
          "name": "Living Room AC",
          "connection": "cloud",
          "cloud": {
            "email": "your-email@example.com",
            "password": "your-password",
            "region": "eu"
          }
        }
      ]
    }
  ]
}
```

### Local Mode

```json
{
  "platforms": [
    {
      "platform": "AcFreedom",
      "name": "AC Freedom",
      "devices": [
        {
          "name": "Bedroom AC",
          "connection": "local",
          "local": {
            "ip": "192.168.1.100",
            "mac": "AA:BB:CC:DD:EE:FF"
          }
        }
      ]
    }
  ]
}
```

---

## Configuration Options

### Device Options (all modes)

| Option | Type | Required | Default | Description |
|--------|------|----------|---------|-------------|
| `name` | string | Yes | — | Device name in HomeKit |
| `connection` | string | Yes | `"cloud"` | Connection mode: `cloud` or `local` |
| `pollInterval` | integer | No | `30` | Polling interval in seconds (5–300) |
| `tempStep` | number | No | `0.5` | Temperature step: `0.5` or `1` |

### Cloud Settings (`cloud` object)

| Option | Type | Required | Default | Description |
|--------|------|----------|---------|-------------|
| `email` | string | Yes | — | AC Freedom app email |
| `password` | string | Yes | — | AC Freedom app password |
| `region` | string | No | `"eu"` | Server region: `eu`, `usa`, `cn`, `rus` |
| `deviceId` | string | No | — | Specific device ID (leave empty to auto-detect) |

### Local Settings (`local` object)

| Option | Type | Required | Default | Description |
|--------|------|----------|---------|-------------|
| `ip` | string | Yes | — | AC unit's local IP address |
| `mac` | string | Yes | — | AC unit's MAC address (`AA:BB:CC:DD:EE:FF`) |

### Feature Switches

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `presets.sleep` | boolean | `true` | Sleep Mode switch |
| `presets.health` | boolean | `true` | Health / Ionizer switch |
| `presets.eco` | boolean | `true` | Eco / Mildew Prevention switch |
| `presets.clean` | boolean | `true` | Self Clean switch |
| `showComfWind` | boolean | `true` | Comfortable Wind switch |
| `showDisplay` | boolean | `true` | Display (LED) switch |
| `showFan` | boolean | `true` | Fan speed slider |

---

## HomeKit Climate Card

Once configured, the AC appears as a **HeaterCooler** tile. Tapping it reveals:

- Temperature control with heating/cooling thresholds
- Mode selector — Auto / Heat / Cool
- Fan speed slider — 0% Auto · 25% Low · 50% Medium · 75% High · 100% Turbo
- Swing toggle
- Preset switches — Sleep, Health, Eco, Clean, Comfortable Wind, Display

All linked services appear as tiles inside the climate card.

---

## Cloud vs Local

| | Cloud | Local |
|---|---|---|
| Internet required | Yes | No |
| Setup | Easy (email + password) | Moderate (IP + MAC) |
| Response time | ~1–2 s | ~0.5 s |
| Works remotely | Yes | No |

---

## Troubleshooting

**Cloud login fails**
- Verify credentials work in the AC Freedom app
- Phone number login is not supported — use email registration
- Check the `region` matches your account region
- Logging into the AC Freedom app may invalidate the plugin session — restart Homebridge after using the app

**Device not found**
- Cloud: leave `deviceId` empty for auto-detect, or find it in Homebridge logs
- Local: confirm the AC is on your Wi-Fi and the IP/MAC are correct

**"Server busy" errors**
- These are transient and automatically suppressed
- If persistent, increase `pollInterval` to 60 or higher

**AC not responding**
- Check the AC is powered on and connected to Wi-Fi
- Local mode: Homebridge and AC must be on the same network
- Try restarting Homebridge

---

## Support

If this plugin is useful to you, consider supporting its development:

[![Ko-fi](https://img.shields.io/badge/Support%20on-Ko--fi-FF5E5B?logo=ko-fi&logoColor=white)](https://ko-fi.com/azadaydinli)
[![GitHub Sponsors](https://img.shields.io/badge/Sponsor-%E2%9D%A4-ea4aaa?logo=github)](https://github.com/sponsors/azadaydinli)

---

## Contributing

Contributions are welcome! Please open an [issue](https://github.com/azadaydinli/homebridge-ac-freedom/issues) or submit a pull request.

---

## License

MIT © [Azad Aydınlı](https://github.com/azadaydinli)
