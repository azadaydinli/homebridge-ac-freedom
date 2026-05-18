<p align="center">
  <img src="https://raw.githubusercontent.com/azadaydinli/homebridge-ac-freedom/main/banner.svg" width="800">
</p>

<span align="center">

# Homebridge AC Freedom

A [Homebridge](https://homebridge.io) plugin for controlling **AUX-based air conditioners** via **Apple HomeKit**. Works with any AC that uses the **AC Freedom** app. Supports **Hybrid** (AUX Cloud + optional local Broadlink UDP) and **Local** (Broadlink UDP only) connection modes — no extra hub required.

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
- **Auto-reset** — fan and sleep reset to default when AC turns on/off or mode changes
- **Hybrid** — single cloud login at platform level; optional IP + MAC per device for local Broadlink UDP (local preferred, cloud fallback)
- **Local** — Direct Broadlink UDP only, no internet required
- **Multi-device** — configure as many ACs as needed
- **Custom config UI** — built-in Homebridge UI with Fetch Devices button
- Homebridge v1 & v2 compatible
- English UI

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
- **Hybrid:** AC Freedom app account (email registration)
- **Local:** AC's IP and MAC address on your local network

---

## Installation

**Via Homebridge UI (recommended):**

1. Open the Homebridge UI → **Plugins**
2. Search for `homebridge-ac-freedom`
3. Click **Install**
4. Open plugin settings, enter your cloud credentials and press **Fetch** to auto-discover your devices

**Via terminal:**

```bash
npm install -g homebridge-ac-freedom
```

---

## Connection Modes

### Hybrid (recommended)

Cloud credentials are configured **once at platform level**. All your devices are auto-discovered via the cloud. Optionally add an IP + MAC per device for direct local Broadlink UDP control — local is used when available and automatically falls back to cloud.

### Local Only

Direct Broadlink UDP communication only. No cloud account needed, but Homebridge must be on the same network as the AC.

---

## Configuration

The easiest way to configure is through the **Homebridge UI** — enter your credentials and press **Fetch** to auto-populate your devices.

For manual JSON configuration:

### Hybrid Mode

```json
{
  "platforms": [
    {
      "platform": "AcFreedom",
      "name": "AC Freedom",
      "cloud": {
        "email": "your-email@example.com",
        "password": "your-password",
        "region": "eu"
      },
      "devices": [
        {
          "name": "Living Room AC",
          "connection": "hybrid",
          "endpointId": "your-device-endpoint-id"
        }
      ]
    }
  ]
}
```

### Hybrid Mode with Local Override

```json
{
  "platforms": [
    {
      "platform": "AcFreedom",
      "name": "AC Freedom",
      "cloud": {
        "email": "your-email@example.com",
        "password": "your-password",
        "region": "eu"
      },
      "devices": [
        {
          "name": "Living Room AC",
          "connection": "hybrid",
          "endpointId": "your-device-endpoint-id",
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

### Local Only Mode

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

### Platform-level Cloud Credentials (`cloud` object)

Required for Hybrid mode. Configured once, shared by all hybrid devices.

| Option | Type | Required | Default | Description |
|--------|------|----------|---------|-------------|
| `email` | string | Yes | — | AC Freedom app email |
| `password` | string | Yes | — | AC Freedom app password |
| `region` | string | No | `"eu"` | Server region: `eu`, `usa`, `cn`, `rus` |

### Device Options

| Option | Type | Required | Default | Description |
|--------|------|----------|---------|-------------|
| `name` | string | Yes | — | Device name in HomeKit |
| `connection` | string | No | `"hybrid"` | `"hybrid"` or `"local"` |
| `endpointId` | string | No | — | Cloud device ID (auto-detected if empty) |
| `pollInterval` | integer | No | `30` | Polling interval in seconds (5–300) |
| `tempStep` | number | No | `0.5` | Temperature step: `0.5` or `1` |

### Local Settings (`local` object, per device)

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `ip` | string | Yes | AC unit's local IP address |
| `mac` | string | Yes | AC unit's MAC address (`AA:BB:CC:DD:EE:FF`) |

### Feature Switches

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `showFan` | boolean | `true` | Fan speed slider |
| `presets.sleep` | boolean | `true` | Sleep Mode switch |
| `presets.health` | boolean | `false` | Health / Ionizer switch |
| `presets.eco` | boolean | `false` | Eco / Mildew Prevention switch |
| `presets.clean` | boolean | `false` | Self Clean switch |
| `showComfWind` | boolean | `false` | Comfortable Wind switch |
| `showDisplay` | boolean | `false` | Display (LED) switch |

> **Tip:** For a clean HomeKit appearance, enable **Fan** and only one preset mode — **Sleep** is the recommended choice.

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

## Hybrid vs Local

| | Hybrid | Local Only |
|---|---|---|
| Internet required | For setup only¹ | No |
| Setup | Easy — Fetch button auto-fills | Moderate (IP + MAC required) |
| Response time | ~1–2 s (cloud) / ~0.5 s (local) | ~0.5 s |
| Works remotely | Yes | No |
| Local fallback | Yes (when IP + MAC configured) | — |

> ¹ **Hybrid + IP/MAC:** if internet is unavailable at startup, the device starts in local-only mode automatically. Full hybrid resumes on the next restart when internet is available.

---

## Troubleshooting

**Cloud login fails**
- Verify credentials work in the AC Freedom app
- Phone number login is not supported — use email registration
- Check the `region` matches your account region
- Logging into the AC Freedom app may invalidate the plugin session — restart Homebridge after using the app

**Device not found**
- Leave `endpointId` empty for auto-detection (first discovered device is used)
- Use the **Fetch** button in the Homebridge UI to discover and auto-fill your device IDs

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
