# Changelog

## 2.3.7

- **Fix inverted swing mode on local connection** (#1) — local Broadlink protocol uses fixation `0` = swinging and `7` = fixed; the plugin had it reversed, so the HomeKit swing toggle showed the opposite of the actual louvre state. Cloud connection was unaffected.

## 2.3.6

- **Config UI: feature toggles redesigned** — checkboxes removed; each feature is now a colour-coded pill: bright green when enabled, muted grey when disabled

## 2.3.5

- **Fix double beep on power-on** — `TargetHeaterCoolerState` command is suppressed when fired within 200 ms of a power command; mode is already included in `sendPower`
- **Fix device turns back on after power-off** — `sendPower(false)` no longer sends a separate sleep or fan command; UI reset is local-only, no extra cloud calls
- **Fix fan not resetting on device** — `sendPower(false)` now includes `fanSpeed=0` in the same API call, so the device restores AUTO fan on next power-on
- **Fix stale poll overriding command** — poll is suppressed for 5 s after any successful user command; a failed command no longer blocks state refresh
- **Fix mode command turning device on** — `sendMode` uses `state.power` instead of hardcoded `power=1`; changing mode while AC is off no longer wakes the device
- **Fix preset switches showing ON when AC is off** — `onGet` and `updateCharacteristics` now gate preset, fan and comfwind values on `state.power`
- **Fix temperature step** — temperature is snapped in `onSet` and pushed back to HomeKit immediately; corrects slider behaviour even when HomeKit has a cached `minStep`
- **Fix temperature out-of-range HAP error** — invalid temperature readings from cloud (e.g. 0°C or 100°C when AC is off) are ignored instead of forwarded to HomeKit
- **Fix unhandled errors in onSet** — all send handlers now use `_trySend()` which catches errors and returns `SERVICE_COMMUNICATION_FAILURE` to HomeKit instead of logging "Unhandled error"
- **Fix cloud error messages** — cloud API errors now extract `payload.message` instead of dumping the full JSON response
- **Fix `connection: "cloud"` trying local** — local connection is only attempted when `connection` is explicitly `"hybrid"`
- **Fix service tile order** — HomeKit climate card always shows tiles in the correct order (Fan → Sleep → Display → Health → Clean → Eco → Comf. Wind) regardless of when each service was first registered
- **Fix crash on command failure** — `_trySend` now correctly references `this.platform.api.hap` instead of the undefined `this.api`
- **Fix malformed device cookie** — cloud API now throws an actionable error instead of crashing with a JSON parse exception
- **Remove Temperature Step and Poll Interval settings** — both are hardcoded (1 °C step, 30 s poll); removed from Config UI and schema to prevent misconfiguration
- **Cleaner startup log** — reduced to one line per device; removed redundant "Restoring / Updating accessory" messages
- **Code cleanup** — `LOCAL_MODE_MAP` and `FAN_REMAP` extracted as module-level constants; cloud API default params moved to `DEVICE_PARAMS` constant

## 2.3.4

- **UI: badge colors** — Cloud (teal), Hybrid (green), Local (yellow) — clearly distinct from each other
- **UI: card colors** — all device cards now use the same neutral color regardless of connection mode
- **UI: Local device numbering** — Local devices now always start from Local #1, independent of cloud device count
- **UI: Poll Interval label** — removed "(seconds)" from the label; dropdown options now show "5 seconds", "10 seconds", etc.
- **UI: English only** — removed all 14 language files; strings are now embedded directly in the UI (no i18n fetch on load)

## 2.3.3

- **Hybrid offline startup** — if cloud is unavailable at Homebridge startup and the device has a local IP + MAC configured, the device now starts in local-only mode instead of failing. Full hybrid mode resumes automatically on the next restart when internet is available.
- **Hybrid endpoint fallback** — if a configured `endpointId` is not found in the cloud device list (e.g. after a cloud outage), the device also falls back to local-only mode when IP + MAC are set.

## 2.3.2

- **Fix AUTO mode byte overflow** — local protocol uses 3-bit mode field; AUTO is now correctly encoded as 0 (not 8, which silently truncated to 0 in the wrong byte position)
- **Fix comfwind local polling** — Comfortable Wind state now read from local Broadlink state
- **Fix fan speed default** — initial `AcState.fanSpeed` corrected from 5 to 0 (AUTO)
- **Fix unhandled Promise rejection** — `discoverDevices()` now has `.catch()` to avoid Node.js ≥18 crash on cloud login failure
- **Fix timer and socket leak** — accessories now expose `destroy()` (clears poll interval + closes UDP socket); platform calls it before recreating accessories
- **Refactor send functions** — unified `_send(localFn, cloudFn)` helper replaces repeated if/else branches in all 8 send methods
- **Fix config.schema.json layout** — `showFan` was incorrectly nested inside the presets fieldset
- **Add peerDependencies** to package.json
- **i18n cleanup** — removed 26 unused keys from all 14 language files; added `fetch`, `cloudDevices`, `localDevices` keys
- **Fix tr.json typo** — "düyməsi" (Azerbaijani) corrected to "düğmesi" (Turkish)

## 2.3.1

- **Config UI overhaul** — complete redesign of the custom Homebridge UI
  - Cloud credentials (Email, Password, Region, Fetch) all on one row
  - **Cloud Devices** section appears only after a successful Fetch
  - **Local Devices** section with full-width Add Device button
  - Device cards: Name + Connection, IP + MAC, Temperature Step + Poll Interval, and Features all wrapped in consistent fieldset style
  - Connection toggle: **Cloud** / **Hybrid** (Hybrid reveals IP + MAC fields)
  - Features row: Fan · Sleep · Display · Health · Clean · Eco · Comf. Wind (all 7 in one line, no icons)
  - Poll Interval changed from free input to fixed dropdown: 5 / 10 / 20 / 30 / 60 s
  - New device defaults: only **Fan** and **Sleep** enabled out of the box
  - Section headers centered, no underline borders
  - Badge (Cloud / Hybrid / Local) moved to the right of the card header next to Remove

> **Upgrading from v2.2?** HomeKit accessories and automations are preserved (UUID is name-based). However, the new UI uses platform-level cloud credentials — open the plugin settings, enter your email/password and press **Fetch** to rediscover your devices.

## 2.3.0

- **New architecture: Hybrid + Local Only connection modes**
  - **Hybrid** (replaces Cloud): single cloud login at platform level → all devices auto-discovered; optional IP + MAC per device for direct Broadlink UDP control (local preferred, cloud fallback)
  - **Local Only**: unchanged — Broadlink UDP only, no cloud needed
  - Old `cloud` connection mode handled transparently as backward compat
- Add **Fetch Devices** button in config UI: logs into AUX Cloud and auto-populates device cards
- Add `homebridge-ui/server.js` backend handler for `/fetchDevices` request
- Move cloud credentials from per-device to platform level (`cloud.email`, `cloud.password`, `cloud.region`)
- Add `endpointId` per-device field (replaces per-device `cloud.deviceId`)
- Normalize fan speed to canonical cloud numbering in state (fixes hybrid local/cloud switching)
- Add 11 new i18n keys in all 14 languages (hybrid, localOnly, cloudCredentials, fetchDevices, etc.)
- Bump purple accent colour for Hybrid badge in config UI

## 2.2.4

- Add localised features hint in config UI (14 languages)
- Fix README configuration examples (was showing outdated `cloudDevices`/`localDevices` format)
- Add `pollInterval` to `config.schema.json`
- Move plugin/platform name constants to `platform.js`
- Remove unused `FAN_SPEED.MUTE` constant

## 2.2.2

- Add custom Homebridge config UI (`homebridge-ui/public/index.html`)
  - Collapsible device cards with Cloud/Local segmented toggle
  - Feature toggle grid (Fan, Sleep, Display / Health, Clean, Eco, Comf. Wind)
  - Auto-save on every change
- Add i18n support with 14 languages (en, tr, ru, de, fr, es, it, ja, ko, zh-CN, ar, nl, pl, pt)

## 2.2.1

- Fan slider snaps to 25% increments only (0 / 25 / 50 / 75 / 100%)
- Fix local device fan speed mapping (Low/High were swapped)
- Fan resets to Auto when AC power toggles or HVAC mode changes
- Sleep preset resets when AC power toggles or HVAC mode changes
- Remove Mute/Silent fan speed option from slider

## 2.1.1

- Mark plugin as compatible with Homebridge v2

## 2.1.0

- Clean up codebase: remove dead code, unused exports, empty config fields
- Set `singular: true` (single platform instance)
- Add Fan toggle to config UI

## 2.0.3

- Remove Poll Interval from config UI — hardcoded to 30 seconds

## 1.2.3

- Revert to section+expandable layout (per-device collapse/expand)
- Fix floating popup bug — replace `oneOf` dropdowns with `enum` + `titleMap`
- Rename switch labels: "Comfortable Wind", "Display"

## 1.2.2

- Remove unused `changelog` field from config.schema.json

## 1.2.1

- Fix floating popup bug — switch from `section` to `tabarray` layout for devices
- Rename "Show Comfortable Wind Switch" → "Comfortable Wind"
- Rename "Show Display Switch" → "Display"

## 1.2.0

- Revert to 1.1.8 config UI layout

## 1.1.9

- Attempt fix for floating popup — move expandable to array level (reverted)

## 1.1.8

- Fix duplicate field rendering in config UI — add `key` to layout fieldsets so nested objects are properly claimed

## 1.1.7

- Fix config UI validation error and duplicate field rendering
- Move conditional logic (cloud/local) to layout only, remove `required` from conditional objects
- Clean up schema: remove redundant titles and conditions from schema-level objects

## 1.1.6

- Fix config UI layout — use proper fieldsets for nested objects (cloud, local, presets)

## 1.1.5

- Make each device individually collapsible in Homebridge config UI
- Add "Add Device" button text

## 1.1.4

- Make device list collapsible in config UI

## 1.1.3

- Add comprehensive README with features, installation, configuration, and troubleshooting

## 1.1.2

- Fix verified plugin checks — add `bugs.url` to package.json
- Fix JSON Schema: use `required` arrays at object level per spec

## 1.1.1

- Add Comfortable Wind (`comfwind`) switch support
- Suppress transient "server busy" poll errors from cloud API

## 1.1.0

- Clean up codebase — remove experimental service-ordering hacks
- Simplify UUID generation (no version suffix)

## 1.0.6

- Fix AES zero-padding bug causing cloud login error `-1005`

## 1.0.5

- Fix cloud login — add Content-Length header to API requests

## 1.0.4

- Attempt service display order fix via accessory migration

## 1.0.3

- Initial HVAC modes configuration support

## 1.0.2

- Initial service ordering attempt

## 1.0.1

- Bug fixes

## 1.0.0

- Initial release
- Cloud (AUX Cloud API) and Local (Broadlink UDP) connection support
- HeaterCooler with auto/heat/cool modes
- Fan speed control (linked Fanv2 service)
- Preset switches: Sleep, Health, Eco, Self Clean
- Display on/off switch
- Configurable poll interval and temperature step
