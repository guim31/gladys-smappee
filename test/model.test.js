// -----------------------------------------------------------------------------
// Pure functions: the configuration, the reading of the Smappee answers
// (fixtures of test/fixtures/smappee) and the energy indexes.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeConfig, parseHosts } from '../src/config.js';
import { MAX_GAP_MS, accumulate, createMeter } from '../src/energy.js';
import {
  CHARGING_STATE,
  CONNECTOR_STATUS,
  chargerSession,
  cloudActuators,
  cloudBlocks,
  cloudChannelEnergy,
  cloudChargers,
  cloudSessions,
  cloudState,
  httpActuators,
  httpChannels,
  instantaneousPowers,
  modelOf,
  mqttChannels,
  mqttRealtime,
  normalizeSerial,
  serialFromAdvancedConfig,
} from '../src/smappee/model.js';

const fixture = (name) =>
  JSON.parse(readFileSync(new URL(`./fixtures/smappee/${name}.json`, import.meta.url), 'utf8'));

test('configuration: addresses, defaults, the cloud only with its four fields', () => {
  assert.deepEqual(parseHosts('http://192.168.001.50/ , smappee.lan;300.1.1.1'), {
    hosts: ['192.168.1.50', 'smappee.lan'],
    invalid: ['300.1.1.1'],
  });
  const config = normalizeConfig({});
  assert.equal(config.localPassword, 'admin');
  assert.equal(config.cloud, null);
  assert.equal(config.pollSeconds, 10);
  assert.equal(config.controls, true);
  assert.equal(config.language, 'fr');
  const partial = normalizeConfig({ cloud_client_id: 'id', cloud_username: 'me' });
  assert.equal(partial.cloud, null);
  assert.equal(partial.cloudIncomplete, true);
  assert.equal(normalizeConfig({ controls: 'false', poll_interval: '7' }).controls, false);
  assert.equal(normalizeConfig({ poll_interval: '7' }).pollSeconds, 10);
});

test('models and serial numbers', () => {
  assert.equal(modelOf('1005000202'), 'Smappee Energy');
  assert.equal(modelOf('1105000101'), 'Smappee Solar');
  assert.equal(modelOf('5010000101'), 'Smappee Genius');
  assert.equal(modelOf('5130000001'), 'Smappee Ethernet Connect');
  assert.equal(normalizeSerial('Smappee1006000212'), '1006000212');
  assert.equal(normalizeSerial('smappee'), null);
  assert.equal(serialFromAdvancedConfig(fixture('http-solar').advancedConfigPublic), '1105000101');
});

test('HTTP: the power channels of each monitor family', () => {
  const data = fixture('http-solar');
  assert.deepEqual(httpChannels('1105000101', { config: data.configPublic }), {
    consumption: [0],
    production: [1],
  });
  assert.deepEqual(
    httpChannels('1105000101', { config: [{ key: 'emeterConfiguration', value: '11' }] }),
    {
      consumption: [0, 1, 2],
      production: [3, 4, 5],
    },
  );
  assert.deepEqual(httpChannels('1005000202'), { consumption: [0, 1, 2], production: [] });
  assert.deepEqual(
    httpChannels('2000000001', {
      channels: {
        inputChannels: [
          { ctInput: 0, inputChannelConnection: 'GRID', inputChannelType: 'CONSUMPTION' },
          { ctInput: 2, inputChannelConnection: 'GRID', inputChannelType: 'PRODUCTION' },
          { ctInput: 3, inputChannelConnection: 'SUBMETER', inputChannelType: 'CONSUMPTION' },
        ],
      },
    }),
    { consumption: [0], production: [2] },
  );
  // Milliwatts in strings; a production clamp may read negative.
  assert.deepEqual(
    instantaneousPowers(
      [
        { key: 'phase0ActivePower', value: '1850000' },
        { key: 'phase1ActivePower', value: '-1400000' },
      ],
      { consumption: [0], production: [1] },
    ),
    { consumption: 1850, production: 1400 },
  );
  assert.deepEqual(instantaneousPowers(null, { consumption: [0], production: [] }), {
    consumption: null,
    production: null,
  });
  assert.deepEqual(
    httpActuators(data.commandControlPublic).map(({ id, kind, on }) => [id, kind, on]),
    [
      ['1', 'plug', true],
      ['2', 'switch', false],
    ],
  );
});

test('MQTT: channels, sub-meters and realtime readings', () => {
  const data = fixture('mqtt-genius');
  const channels = mqttChannels(data.channelConfigV2);
  assert.deepEqual(channels.grid, [0, 1, 2]);
  assert.deepEqual(channels.solar, [3]);
  assert.deepEqual(channels.submeters, [
    { id: '4', name: 'Pompe à chaleur', indexes: [4, 5] },
    { id: '6', name: 'Four', indexes: [6] },
  ]);
  const reading = mqttRealtime(data.realtime);
  assert.equal(reading.total, 2450);
  assert.deepEqual(reading.voltages, [231, 229, 232]);
  // Current in tenths of an ampere.
  assert.deepEqual(reading.channels.get(4), { power: 600, current: 2.6 });
});

test('cloud: actuators that switch, blocks, states', () => {
  const data = fixture('cloud');
  assert.deepEqual(cloudActuators(data.meteringConfiguration), [
    { id: '1', name: 'Garage', kind: 'plug', on: null, connected: null },
  ]);
  assert.deepEqual(
    cloudBlocks({ consumptions: [...data.consumption.consumptions].reverse() }).map((b) => b.at),
    [1760000000000, 1760000300000],
  );
  assert.equal(cloudState('"ON_ON"'), true);
  assert.equal(cloudState('OFF_OFF'), false);
  assert.equal(cloudState(''), null);
});

test('energy: trapezoids in kWh, no bridge over a gap, never down', () => {
  const meter = createMeter();
  accumulate(meter, 1000, 0);
  accumulate(meter, 3000, 3600_000 / 60); // one minute, 2000 W average
  assert.equal(Math.round(meter.kwh * 1e6), 33333);
  accumulate(meter, 3000, 3600_000 / 60 + MAX_GAP_MS + 1);
  assert.equal(Math.round(meter.kwh * 1e6), 33333);
  accumulate(meter, -500, 3600_000 / 60 + MAX_GAP_MS + 60_001);
  assert.ok(meter.kwh > 0.033);
  accumulate(meter, null, 0);
  assert.equal(meter.at, null);
  assert.equal(createMeter(-3).kwh, 0);
});

test('cloud charging stations: the serials, the channels, the sessions', () => {
  const cloud = fixture('cloud');
  const chargers = cloudChargers(cloud.meteringConfiguration);
  assert.deepEqual(chargers, [
    { id: '5820000001', station: '6201000001', position: 1, name: 'Allée', channels: [0] },
  ]);
  assert.deepEqual(cloudChargers({ chargingStations: [{ serialNumber: 'x' }] }), []);
  // `from` and `to` in seconds, as the real API, or in ms, as its documentation.
  const seconds = cloudSessions(cloud.sessions, chargers[0]);
  assert.equal(seconds[0].from, 1760000000_000);
  assert.equal(seconds[0].to, 1760024347_000);
  assert.equal(seconds[0].energy, 32.844);
  const ms = cloudSessions([{ serialNumber: '5820000001', from: 1760000000_000 }], chargers[0]);
  assert.equal(ms[0].from, 1760000000_000);
  // Another connector of the station, by serial or by position.
  assert.deepEqual(cloudSessions([{ serialNumber: '5820000002', from: 1 }], chargers[0]), []);
  assert.equal(cloudSessions([{ connector: 1, from: 1 }], chargers[0]).length, 1);
  assert.deepEqual(cloudSessions({ error: 'no' }, chargers[0]), []);
});

test('a session under way: no meter nor energy yet, measured on the channel', () => {
  const cloud = fixture('cloud');
  const [charger] = cloudChargers(cloud.meteringConfiguration);
  const [session] = cloudSessions([cloud.activeSession], charger);
  assert.equal(session.to, null);
  assert.equal(session.stop, null);
  assert.equal(session.energy, null);
  // A real block: 400.8 Wh in the 5 minutes where the session began after 89 s.
  const from = 1000_000 + 89_000;
  const blocks = (active) => ({
    consumptions: [
      { timestamp: 700_000, consumption: 1, active: [0.2] },
      { timestamp: 1000_000, consumption: 1, active: [400.8] },
      { timestamp: 1300_000, consumption: 1, active: [570.5, -40] },
    ].map((block) => (active ? block : { ...block, active: undefined })),
  });
  assert.equal(Math.round(cloudChannelEnergy(blocks(true), [0], from) * 1000), 971);
  // A negative channel (a grid exporting) never lowers it.
  assert.equal(Math.round(cloudChannelEnergy(blocks(true), [1], from) * 1000), 0);
  assert.equal(cloudChannelEnergy(blocks(false), [0], from), null);
});

test('charger state: every session status, the meter never goes down', () => {
  const session = (status, extra = {}) => ({
    from: 1000,
    to: null,
    status,
    stop: null,
    energy: null,
    ...extra,
  });
  const charging = (status) => chargerSession({}, [], [session(status)], 61_000).charging;
  assert.equal(charging('CHARGING'), CHARGING_STATE.CHARGING);
  assert.equal(charging('STARTED'), CHARGING_STATE.EV_CONNECTED);
  assert.equal(charging('SUSPENDED'), CHARGING_STATE.PAUSED_BY_CHARGER);
  assert.equal(charging('STOPPED'), CHARGING_STATE.IDLE);

  const running = chargerSession({ total: 900, energy: 5 }, [], [session('CHARGING')], 61_000);
  assert.equal(running.connector, CONNECTOR_STATUS.OCCUPIED);
  assert.equal(running.minutes, 1);
  // No energy in the answer: the last known one stays.
  assert.equal(running.energy, 5);

  const done = session('STOPPED', { to: 121_000, stop: 800, energy: 3 });
  const idle = chargerSession({ total: 900 }, [done], []);
  assert.equal(idle.connector, CONNECTOR_STATUS.AVAILABLE);
  assert.equal(idle.charging, CHARGING_STATE.IDLE);
  assert.equal(idle.total, 900);
  assert.equal(idle.energy, 3);
  assert.equal(idle.minutes, 2);
  assert.equal(idle.lastFrom, 1000);
  // Nothing read: only the connector and the state are known.
  assert.deepEqual(chargerSession({}, [], []), {
    connector: CONNECTOR_STATUS.AVAILABLE,
    charging: CHARGING_STATE.IDLE,
  });
});
