// -----------------------------------------------------------------------------
// A complete test world: the SDK's fake Gladys, fake Smappee monitors (a real
// HTTP server and a real MQTT broker on loopback addresses,
// tools/fake-smappee.mjs), a fake Smappee cloud, and a temporary /data, with
// the integration wired on top through registerHandlers. No timer runs unless
// asked: the tests publish with `world.hub.pollLocal()`.
// -----------------------------------------------------------------------------

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers } from '../../src/app.js';
import { Store } from '../../src/store.js';
import { FakeSmappeeBroker, FakeSmappeeCloud, FakeSmappeeHttp } from '../../tools/fake-smappee.mjs';

// The integration logs every change; keep the test output readable.
process.env.LOG_LEVEL ??= 'silent';

export const HTTP_HOST = '127.0.0.2';
export const MQTT_HOST = '127.0.0.3';
export const HTTP_SERIAL = '1105000101';
export const MQTT_SERIAL = '5010000101';
export const CLOUD_SERIAL = '1005000202';

export const CLOUD_CONFIG = {
  cloud_client_id: 'gladys-client',
  cloud_client_secret: 'client-secret',
  cloud_username: 'user@example.com',
  cloud_password: 'secret',
};

/** Lets pending socket callbacks and promises run. */
export const settle = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms));

/** Wait until `check()` is true (sockets are asynchronous). */
export async function until(check, ms = 2000) {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) {
      throw new Error('Timed out');
    }
    await settle(10);
  }
}

/**
 * @param {object} [options]
 * @param {boolean} [options.http] start a fake HTTP monitor (Smappee Solar)
 * @param {boolean} [options.mqtt] start a fake MQTT broker (Smappee Genius)
 * @param {boolean} [options.cloud] start a fake cloud and fill in its credentials
 * @param {object} [options.config] raw integration config (merged)
 * @param {Array} [options.created] devices already created in Gladys
 */
export async function createWorld({
  http = false,
  mqtt = false,
  cloud = false,
  config = {},
  created = [],
  connect = true,
  dataDir = mkdtempSync(join(tmpdir(), 'gladys-smappee-')),
  timings = {},
  timers = false,
} = {}) {
  const fakeHttp = http ? await new FakeSmappeeHttp({ host: HTTP_HOST }).start() : null;
  // The HTTP port is closed on the broker's address, and the reverse: each
  // fake answers one way, as a real monitor.
  const fakeBroker = mqtt ? await new FakeSmappeeBroker({ host: MQTT_HOST }).start() : null;
  const fakeCloud = cloud ? await new FakeSmappeeCloud().start() : null;
  if (fakeCloud) {
    // Two complete 5-minute blocks just behind now (the next one, `addBlock`, ends now).
    const now = Date.now();
    fakeCloud.data.consumption.consumptions = [
      { timestamp: now - 15 * 60_000, consumption: 100, solar: 40, alwaysOn: 12 },
      { timestamp: now - 10 * 60_000, consumption: 150, solar: 50, alwaysOn: 12 },
    ];
  }
  const hosts = [http && HTTP_HOST, mqtt && MQTT_HOST].filter(Boolean).join(', ');
  const gladys = createFakeGladys({
    config: { language: 'en', hosts, ...(cloud ? CLOUD_CONFIG : {}), ...config },
    devices: created,
  });
  const app = registerHandlers(gladys, {
    store: new Store(dataDir),
    timers,
    timings,
    network: {
      httpPort: fakeHttp?.port ?? 1,
      mqttPort: fakeBroker?.port ?? 1,
      cloudBaseUrl: fakeCloud?.baseUrl ?? 'http://127.0.0.1:1/dev/v3',
    },
  });
  const world = {
    gladys,
    fake: gladys.fake,
    app,
    hub: app.hub,
    dataDir,
    http: fakeHttp,
    broker: fakeBroker,
    cloud: fakeCloud,
  };
  world.stop = async () => {
    await app.stop();
    await Promise.all([fakeHttp?.stop(), fakeBroker?.stop(), fakeCloud?.stop()]);
  };
  if (connect) {
    await gladys.connect();
    await app.ready;
    if (mqtt) {
      // The broker pushes its configuration on subscription.
      await until(() => world.hub.monitor(MQTT_SERIAL));
      await settle();
      await world.hub.publishDevices();
    }
  }
  return world;
}

/** Add every discovered device in Gladys, as the user would. */
export async function createAll(world) {
  for (const device of world.fake.discoveredDevices) {
    await world.fake.deviceCreated(device);
  }
  await world.hub.idle();
}

export const ids = (gladys, type, platformId) => gladys.externalIds(type, platformId);
