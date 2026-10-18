// -----------------------------------------------------------------------------
// Docker check: run inside the integration image, in the Gladys sandbox
// (--cap-drop ALL --read-only --memory 256m), against the fake Smappee of
// tools/fake-smappee.mjs --serve at FAKE_HOST. Drives the real hub through the
// SDK's fake Gladys: local HTTP, local MQTT, cloud, a command each, /data.
//   node tools/docker-check.mjs        (FAKE_HOST=<address of the fake>)
// -----------------------------------------------------------------------------

import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers } from '../src/app.js';
import { Store } from '../src/store.js';

const host = process.env.FAKE_HOST;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function run(label, config, network) {
  const gladys = createFakeGladys({ config: { language: 'fr', ...config } });
  const app = registerHandlers(gladys, { store: new Store('/data'), timers: false, network });
  await gladys.connect();
  await app.ready;
  await wait(1500); // MQTT configuration and a few realtime messages
  await app.hub.publishDevices();
  for (const device of gladys.fake.discoveredDevices) {
    await gladys.fake.deviceCreated(device);
  }
  await app.hub.pollLocal();
  await app.hub.pollCloud();
  await app.hub.idle();
  const devices = gladys.fake.discoveredDevices;
  const actuator = devices.find((device) => device.external_id.includes(':actuator:'));
  const ack = actuator ? await gladys.fake.setValue(actuator, actuator.features[0], 1) : null;
  const report = await gladys.fake.action('search', {});
  console.log(`--- ${label}`);
  console.log(`devices: ${devices.map((device) => device.name).join(' | ')}`);
  console.log(`states: ${gladys.fake.states.length}, command: ${ack ? ack.success : 'n/a'}`);
  console.log(`report: ${report.data?.message?.en}`);
  await app.stop();
  return devices.length;
}

const results = [
  await run('local HTTP', { hosts: host }, { httpPort: 80 }),
  await run('local MQTT', { hosts: host }, { httpPort: 81, mqttPort: 1883 }),
  await run(
    'cloud',
    {
      cloud_client_id: 'gladys-client',
      cloud_client_secret: 'x',
      cloud_username: 'user',
      cloud_password: 'secret',
    },
    { cloudBaseUrl: `http://${host}:8080/dev/v3` },
  ),
  await run('wrong password', { hosts: host, local_password: 'nope' }, { httpPort: 80 }),
];
const memory = process.memoryUsage();
console.log(`devices per run: ${results.join(', ')}`);
console.log(`rss ${Math.round(memory.rss / 1e6)} MB, heap ${Math.round(memory.heapUsed / 1e6)} MB`);
process.exit(results[0] > 0 && results[1] > 0 && results[2] > 0 && results[3] === 0 ? 0 : 1);
