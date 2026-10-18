// -----------------------------------------------------------------------------
// The hub against the fake monitors and cloud (tools/fake-smappee.mjs): what
// each access reads, the commands, the energy indexes, the reachability and
// the scene triggers, the persistence, the logs.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CLOUD_SERIAL,
  HTTP_SERIAL,
  MQTT_SERIAL,
  createAll,
  createWorld,
  ids,
  settle,
  until,
} from './helpers/world.js';

/** Every line the SDK logger writes from now on, at the default level. */
function captureLogs(t) {
  const lines = [];
  const previous = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = 'info';
  t.after(() => {
    process.env.LOG_LEVEL = previous;
  });
  for (const name of ['log', 'info', 'warn', 'error']) {
    t.mock.method(console, name, (...args) => lines.push(args.join(' ')));
  }
  return lines;
}

const device = (world, type, platformId) =>
  world.fake.discoveredDevices.find(
    (entry) => entry.external_id === ids(world.gladys, type, platformId).device,
  );

test('HTTP: a Smappee Solar, its powers, grid exchange, plug and switch', async (t) => {
  const world = await createWorld({ http: true });
  t.after(() => world.stop());
  await createAll(world);
  const monitor = ids(world.gladys, 'monitor', HTTP_SERIAL);
  // emeterConfiguration 17: consumption on CT 0, production on CT 1.
  assert.equal(world.fake.lastState(monitor.feature('power')), 1850);
  assert.equal(world.fake.lastState(monitor.feature('solar-power')), 1400);
  assert.equal(world.fake.lastState(monitor.feature('import-power')), 450);
  assert.equal(world.fake.lastState(monitor.feature('export-power')), 0);
  assert.equal(world.fake.lastState(monitor.feature('energy')), 0);
  assert.equal(device(world, 'monitor', HTTP_SERIAL).name, `Smappee Solar ${HTTP_SERIAL}`);

  // Type 2 is a plug, type 3 a switch; type 7 is not offered.
  const plug = device(world, 'actuator', `${HTTP_SERIAL}-1`);
  const relay = device(world, 'actuator', `${HTTP_SERIAL}-2`);
  assert.equal(plug.name, 'Lave-linge');
  assert.equal(plug.features[0].has_feedback, false);
  assert.equal(relay.features[0].has_feedback, true);
  assert.equal(device(world, 'actuator', `${HTTP_SERIAL}-9`), undefined);
  assert.equal(
    world.fake.lastState(ids(world.gladys, 'actuator', `${HTTP_SERIAL}-1`).feature('switch')),
    1,
  );

  const ack = await world.fake.setValue(relay, relay.features[0], 1);
  assert.equal(ack.success, true, ack.error);
  assert.ok(
    world.http.requests.some(
      (request) => request.body === 'control,{"controllableNodeId":"2","action":"ON"}',
    ),
  );
  assert.equal(world.fake.lastState(relay.features[0].external_id), 1);
  assert.equal(world.http.data.commandControlPublic[1].relayStatus, true);

  // The transport badge: read locally.
  assert.ok(
    world.fake.transports.some(
      (entry) => entry.device_external_id === monitor.device && entry.transport === 'local',
    ),
  );
  assert.equal(world.fake.connectionStatus.connected, true);
});

test('HTTP: the session expires, the hub logs on again by itself', async (t) => {
  const world = await createWorld({ http: true });
  t.after(() => world.stop());
  await createAll(world);
  world.http.sessions.clear();
  world.http.setPowers(900, 0);
  await world.hub.pollLocal();
  const monitor = ids(world.gladys, 'monitor', HTTP_SERIAL);
  assert.equal(world.fake.lastState(monitor.feature('power')), 900);
  assert.equal(world.http.requests.filter((request) => request.command === 'logon').length, 2);
});

test('HTTP: a wrong password is reported, never logged with the password', async (t) => {
  const logs = captureLogs(t);
  const world = await createWorld({ http: true, config: { local_password: 'wrong-pass' } });
  t.after(() => world.stop());
  assert.equal(world.fake.discoveredDevices.length, 0);
  assert.equal(world.fake.connectionStatus.connected, false);
  const ack = await world.fake.action('search', {});
  assert.match(ack.data.message.en, /127\.0\.0\.2: the monitor refused the password/);
  assert.match(ack.data.message.fr, /a refusé le mot de passe/);
  // Said once, even after the search tried again.
  assert.equal(logs.filter((line) => /refused the password/.test(line)).length, 1);
  assert.ok(!logs.some((line) => line.includes('wrong-pass')));
});

test('HTTP: a monitor that stops answering is offline after 3 readings, then back', async (t) => {
  const world = await createWorld({ http: true });
  t.after(() => world.stop());
  await createAll(world);
  const monitor = ids(world.gladys, 'monitor', HTTP_SERIAL);
  world.http.online = false;
  await world.hub.pollLocal();
  await world.hub.pollLocal();
  assert.equal(world.fake.sceneEvents.length, 0);
  await world.hub.pollLocal();
  await world.hub.idle();
  assert.deepEqual(world.fake.sceneEvents, [
    {
      key: 'monitor_offline',
      data: { device: monitor.device, name: `Smappee Solar ${HTTP_SERIAL}` },
    },
  ]);
  assert.equal(world.fake.connectionStatus.connected, false);
  world.http.online = true;
  await world.hub.pollLocal();
  await world.hub.idle();
  assert.equal(world.fake.sceneEvents[1].key, 'monitor_online');
});

test('MQTT: a Genius, its sub-meters, voltages, switch and plug', async (t) => {
  const world = await createWorld({ mqtt: true });
  t.after(() => world.stop());
  world.broker.realtime();
  await settle();
  await world.hub.pollLocal();
  await createAll(world);
  const monitor = ids(world.gladys, 'monitor', MQTT_SERIAL);
  assert.equal(world.fake.lastState(monitor.feature('power')), 2450);
  assert.equal(world.fake.lastState(monitor.feature('solar-power')), 1000);
  assert.equal(world.fake.lastState(monitor.feature('import-power')), 1450);
  assert.equal(world.fake.lastState(monitor.feature('voltage-l3')), 232);

  // Sub-meters named in the Smappee app, by lowest channel.
  const pump = device(world, 'submeter', `${MQTT_SERIAL}-4`);
  assert.equal(pump.name, 'Pompe à chaleur');
  const pumpIds = ids(world.gladys, 'submeter', `${MQTT_SERIAL}-4`);
  assert.equal(world.fake.lastState(pumpIds.feature('power')), 1000);
  assert.equal(world.fake.lastState(pumpIds.feature('current')), 4.3);
  assert.equal(device(world, 'submeter', `${MQTT_SERIAL}-6`).name, 'Four');

  // Only the Smappee Switches (4006...) and the plugs.
  assert.equal(device(world, 'actuator', `${MQTT_SERIAL}-8`), undefined);
  const boiler = device(world, 'actuator', `${MQTT_SERIAL}-3`);
  const ack = await world.fake.setValue(boiler, boiler.features[0], 1);
  assert.equal(ack.success, true, ack.error);
  await until(() => world.broker.published.length > 0);
  assert.deepEqual(world.broker.published.at(-1), {
    topic: `servicelocation/${world.broker.data.uuid}/plug/3/setstate`,
    payload: '{"value":"ON"}',
  });
  // The broker answers with the new state.
  world.broker.publish('plug/3/state', { value: 'OFF' });
  await until(() => world.fake.lastState(boiler.features[0].external_id) === 0);
});

test('MQTT: a silent broker makes the monitor offline, a lost one is reconnected', async (t) => {
  const world = await createWorld({ mqtt: true, timings: { mqttStaleMs: 50 } });
  t.after(() => world.stop());
  world.broker.realtime();
  await settle();
  await createAll(world);
  await settle(80);
  await world.hub.pollLocal();
  await world.hub.idle();
  assert.equal(world.fake.sceneEvents.at(-1).key, 'monitor_offline');

  world.broker.dropAll();
  await until(() => [...world.hub.hosts.values()][0].type === null);
  await world.hub.reconnect();
  assert.equal([...world.hub.hosts.values()][0].type, 'mqtt');
  world.broker.realtime();
  await until(() => world.fake.sceneEvents.at(-1).key === 'monitor_online');
});

test('MQTT: the indexes add up power x time, and survive a restart in /data', async (t) => {
  const world = await createWorld({ mqtt: true });
  t.after(() => world.stop());
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  world.broker.realtime({ totalPower: 3600 });
  await settle();
  t.mock.timers.tick(60_000);
  world.broker.realtime({ totalPower: 3600 });
  await settle();
  const monitor = world.hub.monitor(MQTT_SERIAL);
  // 3600 W for one minute: 0.06 kWh.
  assert.equal(Math.round(monitor.meters.consumption.kwh * 1000), 60);
  t.mock.timers.reset();
  await world.stop();
  const saved = JSON.parse(readFileSync(join(world.dataDir, 'smappee-state.json'), 'utf8'));
  assert.equal(Math.round(saved.records[`monitor:${MQTT_SERIAL}`].meters.consumption * 1000), 60);

  const again = await createWorld({ mqtt: true, dataDir: world.dataDir });
  t.after(() => again.stop());
  assert.equal(Math.round(again.hub.monitor(MQTT_SERIAL).meters.consumption.kwh * 1000), 60);
});

test('cloud: a site, its 5-minute blocks, its Comfort Plug', async (t) => {
  const world = await createWorld({ cloud: true });
  t.after(() => world.stop());
  await createAll(world);
  const monitor = ids(world.gladys, 'monitor', CLOUD_SERIAL);
  // The last block: 150 Wh in 5 minutes = 1800 W; the first read sets the start.
  assert.equal(world.fake.lastState(monitor.feature('power')), 1800);
  assert.equal(world.fake.lastState(monitor.feature('solar-power')), 600);
  assert.equal(world.fake.lastState(monitor.feature('energy')), 0);
  assert.ok(
    world.fake.transports.some(
      (entry) => entry.device_external_id === monitor.device && entry.transport === 'cloud',
    ),
  );
  // The site without a monitor serial is left out; the output module has no on/off state.
  assert.equal(world.fake.discoveredDevices.length, 2);

  world.cloud.addBlock(200, 80);
  await world.hub.pollCloud();
  const meter = world.hub.monitor(CLOUD_SERIAL).meters;
  assert.equal(meter.consumption.kwh, 0.2);
  assert.equal(Math.round(meter.production.kwh * 1000), 80);
  assert.equal(Math.round(meter.import.kwh * 1000), 120);

  const plug = device(world, 'actuator', `${CLOUD_SERIAL}-1`);
  assert.equal(plug.name, 'Garage');
  const ack = await world.fake.setValue(plug, plug.features[0], 1);
  assert.equal(ack.success, true, ack.error);
  assert.equal(world.cloud.actuators[1], 'ON_ON');
  // Never the password in a URL.
  assert.ok(
    world.cloud.requests.every((request) => !JSON.stringify(request.query).includes('secret')),
  );
});

test('cloud: refused credentials are reported, without the secrets', async (t) => {
  const logs = captureLogs(t);
  const world = await createWorld({ cloud: true, config: { cloud_client_id: 'unknown' } });
  t.after(() => world.stop());
  assert.equal(world.hub.cloudStatus, 'refused');
  assert.equal(world.fake.connectionStatus.connected, false);
  const ack = await world.fake.action('search', {});
  assert.match(ack.data.message.en, /Smappee cloud: credentials refused/);
  assert.ok(logs.some((line) => /ClientId not found/.test(line)));
  assert.ok(!logs.some((line) => /client-secret|user@example\.com|\bsecret\b/.test(line)));
});

test('cloud: an expired token is asked again', async (t) => {
  const world = await createWorld({ cloud: true });
  t.after(() => world.stop());
  world.hub.cloud.token.access = 'expired';
  world.cloud.addBlock(100, 0);
  await world.hub.pollCloud();
  assert.equal(world.hub.cloudStatus, 'ok');
  assert.equal(world.hub.monitor(CLOUD_SERIAL).meters.consumption.kwh, 0.1);
});

test('a monitor read locally is not read again through the cloud', async (t) => {
  const world = await createWorld({ http: true, cloud: true, connect: false });
  t.after(() => world.stop());
  world.cloud.data.serviceLocations.serviceLocations[0].deviceSerialNumber = HTTP_SERIAL;
  await world.gladys.connect();
  await world.app.ready;
  assert.equal(world.hub.monitor(HTTP_SERIAL).access, 'http');
  assert.equal(world.hub.records.get(`actuator:${HTTP_SERIAL}-1`).access, 'http');
  assert.ok(!world.cloud.requests.some((request) => request.path.endsWith('/consumption')));
});

test('controls off: the switches are read only and refuse commands', async (t) => {
  const world = await createWorld({ http: true, config: { controls: false } });
  t.after(() => world.stop());
  await createAll(world);
  const relay = device(world, 'actuator', `${HTTP_SERIAL}-2`);
  assert.equal(relay.features[0].read_only, true);
  const ack = await world.fake.setValue(relay, relay.features[0], 1);
  assert.equal(ack.success, false);
  assert.match(ack.error, /turned off in the configuration/);
});

test('the hub timer publishes by itself, without any poll from Gladys', async (t) => {
  const world = await createWorld({ http: true });
  t.after(() => world.stop());
  await createAll(world);
  assert.ok(world.fake.discoveredDevices.every((entry) => entry.should_poll === false));
  world.http.setPowers(1234, 0);
  world.hub.timersEnabled = true;
  world.hub.timings.pollMs = 30;
  world.hub.startTimers();
  const feature = ids(world.gladys, 'monitor', HTTP_SERIAL).feature('power');
  await until(() => world.fake.lastState(feature) === 1234);
});

test('a normal run writes nothing at the info level', async (t) => {
  const world = await createWorld({ http: true, mqtt: true, cloud: true });
  t.after(() => world.stop());
  await createAll(world);
  const logs = captureLogs(t);
  for (let round = 0; round < 3; round += 1) {
    world.broker.realtime({ totalPower: 1000 + round });
    world.http.setPowers(500 + round, 100);
    await settle();
    await world.hub.pollLocal();
    await world.hub.pollCloud();
  }
  await world.fake.widgetGet('energy_flow', { language: 'en' });
  assert.deepEqual(logs, []);
});

test('a device created in Gladys gets every state at once', async (t) => {
  const world = await createWorld({ http: true });
  t.after(() => world.stop());
  const monitor = device(world, 'monitor', HTTP_SERIAL);
  const before = world.fake.widgetRefreshes.length;
  await world.fake.deviceCreated(monitor);
  await world.hub.idle();
  for (const feature of monitor.features) {
    assert.notEqual(world.fake.lastState(feature.external_id), undefined, feature.name);
  }
  assert.ok(world.fake.widgetRefreshes.length > before);
});

test('new cloud credentials take effect without a restart', async (t) => {
  const world = await createWorld({ cloud: true, config: { cloud_password: 'wrong' } });
  t.after(() => world.stop());
  assert.equal(world.hub.cloudStatus, 'refused');
  // Refused: not asked again at every reconnection round.
  const logins = () => world.cloud.requests.filter((r) => r.path === 'oauth2/token').length;
  const before = logins();
  await world.hub.reconnect();
  assert.equal(logins(), before);
  await world.fake.configUpdated({ ...world.gladys.fake.config, cloud_password: 'secret' });
  await world.hub.idle();
  assert.equal(world.hub.cloudStatus, 'ok');
  assert.ok(world.hub.monitor(CLOUD_SERIAL).reachable);
});

test('cloud: a plug answering 404 does not stop the readings', async (t) => {
  const world = await createWorld({ cloud: true });
  t.after(() => world.stop());
  await createAll(world);
  world.hub.records.get(`actuator:${CLOUD_SERIAL}-1`).id = '77';
  world.cloud.addBlock(300, 0);
  await world.hub.pollCloud();
  assert.equal(world.hub.cloudStatus, 'ok');
  const monitor = ids(world.gladys, 'monitor', CLOUD_SERIAL);
  assert.equal(world.fake.lastState(monitor.feature('power')), 3600);
});

test('a removed address: the monitor is no longer read locally', async (t) => {
  const world = await createWorld({ http: true });
  t.after(() => world.stop());
  await world.fake.configUpdated({ ...world.gladys.fake.config, hosts: '' });
  await world.hub.idle();
  assert.equal(world.hub.monitor(HTTP_SERIAL).access, null);
  assert.equal(world.fake.discoveredDevices.length, 0);
});

test('HTTP: a refused command is an error, the state does not change', async (t) => {
  const world = await createWorld({ http: true });
  t.after(() => world.stop());
  await createAll(world);
  const relay = device(world, 'actuator', `${HTTP_SERIAL}-2`);
  world.http.data.commandControlPublic = world.http.data.commandControlPublic.filter(
    (entry) => entry.key !== '2',
  );
  const handle = world.http.handle.bind(world.http);
  world.http.server.removeAllListeners('request');
  world.http.server.on('request', (req, res) => {
    if (req.url.endsWith('commandControlPublic') && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        if (body.startsWith('control,')) {
          res.end(JSON.stringify({ error: 'Unknown node' }));
        } else {
          res.end(JSON.stringify(world.http.data.commandControlPublic));
        }
      });
      return;
    }
    handle(req, res);
  });
  const ack = await world.fake.setValue(relay, relay.features[0], 1);
  assert.equal(ack.success, false);
  assert.equal(world.hub.records.get(`actuator:${HTTP_SERIAL}-2`).on, false);
});

test('overlapping reconnections share one run', async (t) => {
  const world = await createWorld({ mqtt: true });
  t.after(() => world.stop());
  const a = world.hub.reconnect();
  const b = world.hub.reconnect();
  assert.equal(a, b);
  await a;
});
