# Smappee for Gladys Assistant

A [Gladys Assistant](https://gladysassistant.com) external integration for the
[Smappee](https://www.smappee.com) energy monitors: home consumption, solar
production, grid import and export, sub-meters, Smappee Switches and Comfort
Plugs. It reads the monitors on the local network first, and through the
official Smappee cloud API for the ones out of reach.

> **Developed without the hardware: feedback welcome.** Built from the message
> formats of [pysmappee](https://github.com/smappee/pysmappee) (the library of
> the Home Assistant integration) and the official API, and tested against
> simulated monitors, not a real one. Please report what works and what does
> not on the [Gladys forum](https://community.gladysassistant.com) or in the
> [issues](https://github.com/guim31/gladys-smappee/issues).

## Features

- **Local web API** (Smappee Energy, Solar, Pro/Plus): consumption and solar
  powers, plugs and switches, read every 5 to 60 seconds.
- **Local MQTT broker** (Smappee Infinity, Genius, Connect, port 1883):
  consumption, solar, phase voltages, one device per sub-meter (CT clamps),
  plugs and switches, pushed about every second.
- **Smappee cloud** (optional): any monitor of the account, 5-minute data,
  plugs and output modules.
- One Gladys device per monitor, keyed on its serial number: consumption,
  production and grid exchange, as power and as energy indexes for the energy
  tab of Gladys 5.2 (computed from the powers and kept in `/data`, or added up
  from the cloud's 5-minute totals).
- Smappee Switches, Comfort Plugs and output modules switched on and off from
  Gladys (can be turned off in the configuration).
- Scene triggers: a monitor goes offline, a monitor is back online.
- Dashboard widget **Smappee energy flow**: home, solar, a grid gauge and the
  self-use share.
- Texts and documentation in English, French, German and Spanish.

## Requirements

- Gladys Assistant 5.1 or later (5.2 for the energy tab).
- The IP address of each monitor, on the network of Gladys; the password of
  the local web interface for Energy, Solar and Pro (`admin` by default).
- For the cloud: an API client id and secret, given by the Smappee support on
  request, and the Smappee account's user name and password.

## Installation

In Gladys: **Integrations → Install from GitHub**, then the address of this
repository: `https://github.com/guim31/gladys-smappee`. Fill in the
configuration, then add the devices from the **Discovery** tab.

The full user guide is in [docs/en.md](docs/en.md) (also in
[French](docs/fr.md), [German](docs/de.md) and [Spanish](docs/es.md)).

## Limits

- Energy, Solar and Pro give no voltage and no sub-meter over their local API.
- The energy indexes of local monitors are computed by the integration (power
  × time); a gap of more than 3 minutes is not filled.
- The cloud gives 5-minute data, read every 5 minutes.
- No automatic discovery: the addresses are typed.

## Development

```bash
npm ci
npm test            # node --test, against the SDK's fake Gladys and tools/fake-smappee.mjs
npm run lint
npm run format:check
```

`tools/fake-smappee.mjs` simulates a Smappee Solar (local web API), a Genius
(local MQTT broker) and the cloud API; `node tools/fake-smappee.mjs --serve`
runs them for a Docker check. See [CLAUDE.md](CLAUDE.md) for the project
rules.

## Credits

- [pysmappee](https://github.com/smappee/pysmappee) (Apache-2.0, Smappee) and
  the [Home Assistant Smappee integration](https://www.home-assistant.io/integrations/smappee/)
  (Apache-2.0): the local and cloud API calls, the meaning of the MQTT
  messages and the channel configurations this integration follows.
- Cover: the Smappee logo, taken from the header of
  [smappee.com](https://www.smappee.com) (a trademark of Smappee), in white on
  the brand green.
- The MQTT client comes from
  [gladys-bambulab](https://github.com/guim31/gladys-bambulab).

## License

[Apache-2.0](LICENSE). Not affiliated with Smappee. Smappee is a trademark of
its owner.
