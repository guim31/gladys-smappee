# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

## [1.0.1] - 2026-10-22

### Security

- Rebuilt on Node.js 24.22.1, the October 2026 security release (remote code
  execution in the Brotli decoder, CVE-2026-111497; TLS hostname and DNS
  fixes).

## [1.0.0] - 2026-10-18

### Added

- Smappee energy monitors in Gladys, read locally first: the local web API of
  the Smappee Energy, Solar and Pro/Plus, the local MQTT broker of the
  Infinity, Genius and Connect, and the Smappee cloud (optional, OAuth2 with
  an API client id and secret) for the monitors out of reach.
- One device per monitor: consumption, solar production, grid import and
  export, phase voltages (MQTT). The energy tab of Gladys 5.2 prices what the
  grid delivers: the home consumption without solar panels, the grid import
  with them (the home consumption is then shown, not priced).
- One device per sub-meter (CT clamps of an Infinity / Genius) and per Smappee
  Switch, Comfort Plug or output module, switched on and off from Gladys
  (can be turned off in the configuration).
- Energy indexes computed from the powers (kept in `/data`), or added up from
  the 5-minute cloud totals.
- Scene triggers: a monitor goes offline, a monitor is back online.
- Dashboard widget: the energy flow of a site (home, solar, grid gauge,
  self-use).
- "Search for Smappee monitors" action, with a report of what answers.
- Documentation in English, French, German and Spanish.

[Unreleased]: https://github.com/guim31/gladys-smappee/compare/v1.0.1...HEAD
[1.0.1]: https://github.com/guim31/gladys-smappee/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/guim31/gladys-smappee/releases/tag/v1.0.0
