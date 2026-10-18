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
  cloudActuators,
  cloudBlocks,
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
