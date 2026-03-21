# Changelog

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
