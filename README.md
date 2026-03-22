<p align="center">
  <a href="https://homebridge.io"><img src="https://raw.githubusercontent.com/homebridge/branding/master/logos/homebridge-wordmark-logo-horizontal.png" height="60"></a>
</p>

# homebridge-ac-freedom

[![verified-by-homebridge](https://img.shields.io/badge/homebridge-verified-blueviolet?color=%23491F59&style=flat&logoColor=%23FFFFFF&logo=homebridge)](https://github.com/homebridge/homebridge/wiki/Verified-Plugins)
[![npm](https://img.shields.io/npm/v/homebridge-ac-freedom)](https://www.npmjs.com/package/homebridge-ac-freedom)
[![npm](https://img.shields.io/npm/dt/homebridge-ac-freedom)](https://www.npmjs.com/package/homebridge-ac-freedom)
[![GitHub](https://img.shields.io/github/license/azadaydinli/homebridge-ac-freedom)](https://github.com/azadaydinli/homebridge-ac-freedom/blob/main/LICENSE)

A [Homebridge](https://homebridge.io) plugin for controlling **AUX-based air conditioners** (AUX, Ballu, Centek, Dunham Bush, Kenwood, Rinnai, Rcool, Tornado, and other brands using the **AC Freedom** app) via **Apple HomeKit**.

Supports both **Cloud** (AUX Cloud API) and **Local** (Broadlink UDP) connections.

## Features

- **HeaterCooler** service with Auto, Cool, and Heat modes
- **Fan speed** control (Auto, Mute, Low, Medium, High, Turbo) via linked Fanv2 service
- **Swing** mode (vertical + horizontal)
- **Preset switches** inside the climate card:
  - Sleep Mode
  - Health / Ionizer
  - Eco / Mildew Prevention
  - Self Clean
  - Comfortable Wind
- **Display** switch (LED display on/off)
- **Dual connection modes:**
  - **Cloud** -- AUX Cloud API (AC Freedom app account), no local network access needed
  - **Local** -- Direct Broadlink UDP control, no internet required
- **Auto-discovery** of cloud devices (or specify a Device ID)
- **Temperature step** selection (0.5 or 1 degree)
- **Configurable poll interval** (5--300 seconds)

## Supported Brands

Any air conditioner that works with the **AC Freedom** app is supported. Known brands include:

| Brand | Brand | Brand |
|-------|-------|-------|
| AUX | Ballu | Centek |
| Dunham Bush | Kenwood | Rinnai |
| Rcool | Tornado | Akai |
| Hyundai | Hisense | Royal Clima |

## Requirements

- [Homebridge](https://homebridge.io) v1.6.0 or later
- Node.js v18.0.0 or later
- An AUX-compatible AC with Wi-Fi (Broadlink module)
- **Cloud mode:** AC Freedom app account (email registration)
- **Local mode:** AC's IP and MAC address on your local network

## Installation

### Via Homebridge UI (Recommended)

1. Open the Homebridge UI
2. Go to **Plugins**
3. Search for `homebridge-ac-freedom`
4. Click **Install**

### Via Command Line

```bash
npm install -g homebridge-ac-freedom
```

## Configuration

### Using Homebridge UI

The easiest way to configure the plugin is through the Homebridge UI settings page. All options are available with descriptions.

### Manual Configuration

Add the following to your Homebridge `config.json`:

#### Cloud Mode

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

#### Local Mode

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

### Configuration Options

#### Device Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `name` | string | `"AC Freedom"` | Device name shown in HomeKit |
| `connection` | string | `"cloud"` | Connection mode: `"cloud"` or `"local"` |
| `pollInterval` | integer | `30` | State polling interval in seconds (5--300) |
| `tempStep` | number | `0.5` | Temperature adjustment step: `0.5` or `1` |

#### Cloud Options

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `email` | string | Yes | AC Freedom app email |
| `password` | string | Yes | AC Freedom app password |
| `region` | string | No | Server region: `"eu"`, `"usa"`, `"cn"`, `"rus"` (default: `"eu"`) |
| `deviceId` | string | No | Specific device endpoint ID (leave empty for auto-detect) |

#### Local Options

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `ip` | string | Yes | AC unit's IP address on your local network |
| `mac` | string | Yes | AC unit's MAC address (`AA:BB:CC:DD:EE:FF` format) |

#### Feature Switches

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `presets.sleep` | boolean | `true` | Show Sleep Mode switch |
| `presets.health` | boolean | `true` | Show Health / Ionizer switch |
| `presets.eco` | boolean | `true` | Show Eco / Mildew Prevention switch |
| `presets.clean` | boolean | `true` | Show Self Clean switch |
| `showComfWind` | boolean | `true` | Show Comfortable Wind switch |
| `showDisplay` | boolean | `true` | Show Display (LED) switch |

## HomeKit Climate Card

Once configured, the AC appears as a **HeaterCooler** tile in the Home app. Tapping on it reveals:

- **Temperature control** with heating/cooling thresholds
- **Mode selector** (Auto / Heat / Cool)
- **Fan speed** slider
- **Swing** toggle
- **Preset switches** (Sleep, Health, Eco, Clean, Comfortable Wind, Display)

All linked services appear as tiles inside the climate card for quick access.

## Cloud vs Local

| Feature | Cloud | Local |
|---------|-------|-------|
| Internet required | Yes | No |
| Setup complexity | Easy (email + password) | Moderate (IP + MAC) |
| Response speed | ~1-2 seconds | ~0.5 seconds |
| Works outside home | Yes | No |
| Firmware updates | Via AC Freedom app | N/A |

## Troubleshooting

### Cloud login fails
- Verify your credentials work in the **AC Freedom** app
- Make sure you registered with an **email** (phone number login is not supported)
- Check the **region** setting matches your account
- Logging in via the AC Freedom app may invalidate the plugin session -- restart Homebridge after using the app

### Device not found
- For cloud: leave `deviceId` empty to auto-detect, or find it in Homebridge logs
- For local: ensure the AC is connected to your Wi-Fi and the IP/MAC are correct

### Poll errors ("server busy")
- Transient cloud server errors are automatically suppressed
- If persistent, try increasing `pollInterval` to 60 or higher

### AC not responding to commands
- Check if the AC is powered on and connected to Wi-Fi
- For local mode: ensure Homebridge and the AC are on the same network
- Try restarting Homebridge

## Contributing

Contributions are welcome! Please open an [issue](https://github.com/azadaydinli/homebridge-ac-freedom/issues) or submit a pull request.

## License

MIT -- see [LICENSE](LICENSE) for details.
