# Smappee

> **Developed without the hardware: feedback welcome.** This integration was written from the
> Smappee library of Home Assistant (pysmappee) and the official API, and tested against simulated
> monitors. If something looks wrong with your Smappee, please open an issue:
> https://github.com/guim31/gladys-smappee/issues

## Overview

This integration brings your **Smappee** energy monitors into Gladys: home consumption, solar
production, grid import and export, sub-meters, Smappee Switches and Comfort Plugs. It reads the
monitors on your local network first, and through the Smappee cloud the ones whose address you do not type.

| Monitor                             | Read through                                |
| ----------------------------------- | ------------------------------------------- |
| Smappee Energy, Solar, Pro/Plus     | local web API (HTTP), every 5 to 60 seconds |
| Smappee Infinity, Genius, Connect   | local MQTT broker (port 1883), pushed live  |
| Any monitor of your Smappee account | Smappee cloud (optional), every 5 minutes   |

## Requirements

- Gladys Assistant 5.1 or later (5.2 for the energy tab).
- For local access: the IP address of each monitor, on the network of Gladys. Give it a fixed
  address in your router. Energy, Solar and Pro need the password of their local web interface
  (`admin` unless you changed it).
- For the cloud (optional): an API client id and secret, which Smappee gives on request (ask the
  Smappee support for "API access"), and the user name and password of your Smappee account.

## Configuration

### Local access

In **Integrations → Smappee → Configuration**, type the IP addresses of your monitors, separated by
commas. For each address the integration tries the local web API, then the MQTT broker. The
**Local web interface password** is only used by Energy, Solar and Pro; leave it empty for the
factory password.

### Cloud access

Fill in the four fields of the **Smappee cloud** section to read the monitors that are not on your
network, and to control the plugs known to the cloud. A monitor whose address is typed is read locally only, never through the cloud: remove its address to read it through the cloud. With three fields out of four, the cloud stays off.

### Options

- **Local refresh interval**: how often the local readings are sent to Gladys (10 seconds by
  default). The energy indexes are always computed from every reading.
- **Control the Smappee plugs and switches**: off, they are shown read only.
- **Language of the device names**: the names given to the features when a device is added.

Then open the **Discovery** tab and add the devices you want.

## Devices

### Monitor

One device per monitor, named after its model and serial number (`Smappee Genius 5010000101`):

- **Consumption** (W) and **Consumption index** (kWh): the whole home;
- with solar panels: **Solar production** and **Solar production index**, **Grid import** and **Grid export** (W), **Grid import index** and **Grid export index** (kWh), deduced from consumption minus production. The **Grid import index** is then the billed counter, and **Consumption index** the home use (shown, not priced);
- Infinity, Genius and Connect: **Voltage L1** to **Voltage L3**.

The monitors give powers, not counters, over their local API: the integration adds up power ×
time into the indexes, kept in its data volume. A gap of more than 3 minutes (Gladys or the monitor
stopped) is not filled in. Through the cloud, the indexes add up the 5-minute totals of Smappee.
The indexes start at 0 the first time.

### Sub-meters

Infinity, Genius and Connect: one device per sub-circuit set up in the Smappee app (CT clamps),
named as in the app, or **Smappee sub-meter** and its channel number: **Power**, **Energy index**
and **Current**.

### Plugs and switches

One device per Smappee Switch, Comfort Plug or cloud output module, with an **On/Off** feature
(named as in the app, else **Smappee plug** and its number). A Comfort Plug (433 MHz) never tells
its state: Gladys shows the last command sent.

## Energy tab

The energy tab of Gladys 5.2 prices what the grid delivers: the **Consumption index** of a monitor without solar panels, the **Grid import index** of a monitor with solar panels (its **Consumption index**, which includes the solar energy used at home, is shown but not priced). The **Energy index** of the sub-meters is a consumption counter too, and the **Solar production index** a production counter.
Set the sub-meters as children of the monitor in the energy settings, so they are not counted twice.
The grid export is shown, never added up again.

## Widget

**Smappee energy flow** shows one site (the first monitor, or the one chosen in its settings):
**Home**, and with solar panels **Solar**, **Import** and **Export**, the grid as a gauge (**Grid**,
import to the right, export to the left) and the **Self-use** share of the production, with the
state of the monitor.

## Scene triggers

- **A Smappee monitor goes offline**: the monitor stops answering (3 local readings in a row, one
  minute without MQTT message, or 30 minutes without new cloud data).
- **A Smappee monitor is back online**: it answers again.

Both can be limited to one monitor, and give its name as a variable. For a **high consumption**,
use the standard trigger of Gladys on a device value: "Consumption" of the monitor above, for
example, 6000 W.

## Actions

**Search for Smappee monitors** (Configuration tab): connects again to the addresses and the cloud,
and tells what answered, how, and what went wrong (password, address, cloud credentials).

## Scene examples

- When **Consumption** of the monitor is above 6000 W, turn off the Smappee Switch of the water
  heater and send a message.
- When **Grid export** is above 1500 W, turn on the Comfort Plug of the pool pump.
- When **A Smappee monitor goes offline**, send a message (power cut, Wi-Fi down).

## Troubleshooting

- **No device in Discovery**: run **Search for Smappee monitors** and read its report.
- "refused the password": type the password of the monitor's local web interface.
- "no Smappee answers there": check the address; an Infinity, Genius or Connect must accept
  connections on port 1883 from Gladys's network.
- "waiting for the monitor's configuration": the MQTT broker answers but has not sent its
  configuration yet; wait a minute, then search again.
- "credentials refused": check the client id and secret given by Smappee, and your account.
- Detailed logs: start the integration with `LOG_LEVEL=debug`.

## Limits

- Developed without the hardware: the message formats come from pysmappee and the official
  documentation. Feedback welcome.
- Energy, Solar and Pro give no voltage and no sub-meter over their local API.
- Local indexes are computed by the integration: they may drift a little from the Smappee app.
- The cloud gives 5-minute data: powers are 5-minute averages, read every 5 minutes.
- No automatic discovery: type the addresses.
- Not affiliated with Smappee.
