// -----------------------------------------------------------------------------
// Simulated Smappee monitors and cloud, built on the fixtures of
// test/fixtures/smappee (shapes of pysmappee and the official API):
//   - FakeSmappeeHttp: the local HTTP API of a Smappee Energy / Solar
//     (password, session, instantaneous values, plug commands);
//   - FakeSmappeeBroker: the local MQTT broker of a Genius (config, channel and
//     plug configuration, realtime readings, `setstate` answered by `state`);
//   - FakeSmappeeCloud: the cloud API (password grant, sites, metering
//     configuration, 5-minute consumption, actuators).
// Used by the tests (loopback addresses) and by the Docker check
// (`node tools/fake-smappee.mjs --serve`).
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import net from 'node:net';
import { publishPacket, readPublish, splitPackets } from '../src/smappee/mqtt.js';

const fixture = (name) =>
  JSON.parse(
    readFileSync(new URL(`../test/fixtures/smappee/${name}.json`, import.meta.url), 'utf8'),
  );

const listen = (server, host, port) =>
  new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolve(server.address().port));
  });

const close = (server) => new Promise((resolve) => server.close(() => resolve()));

export class FakeSmappeeHttp {
  constructor({ host = '127.0.0.2', port = 0, password = 'admin' } = {}) {
    this.data = fixture('http-solar');
    this.host = host;
    this.port = port;
    this.password = password;
    this.sessions = new Set();
    this.requests = [];
    this.online = true;
    this.server = createServer((req, res) => this.handle(req, res));
  }

  async start() {
    this.port = await listen(this.server, this.host, this.port);
    return this;
  }

  stop() {
    this.server.closeAllConnections?.();
    return close(this.server);
  }

  /** Set the power of the consumption and production clamps (W). */
  setPowers(consumption, production) {
    this.data.instantaneous = [
      { key: 'phase0ActivePower', value: String(consumption * 1000) },
      { key: 'phase1ActivePower', value: String(-production * 1000) },
    ];
  }

  handle(req, res) {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      const command = req.url.replace(/^\/gateway\/apipublic\//, '');
      this.requests.push({ command, body });
      if (!this.online) {
        req.socket.destroy();
        return;
      }
      const send = (answer) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(answer));
      };
      if (req.method !== 'POST' || !req.url.startsWith('/gateway/apipublic/')) {
        res.writeHead(404);
        res.end();
        return;
      }
      if (command === 'logon') {
        if (body !== this.password) {
          send({ error: 'Logon failed: wrong password' });
          return;
        }
        const session = `s${this.sessions.size + 1}`;
        this.sessions.add(session);
        res.setHeader('Set-Cookie', `JSESSIONID=${session}; Path=/`);
        send(this.data.logon);
        return;
      }
      const cookie = /JSESSIONID=(\w+)/.exec(req.headers.cookie ?? '')?.[1];
      if (!this.sessions.has(cookie)) {
        send({ error: 'Error not authenticated. Use Logon first!' });
        return;
      }
      if (command === 'commandControlPublic' && body.startsWith('control,')) {
        const { controllableNodeId, action } = JSON.parse(body.slice('control,'.length));
        const item = this.data.commandControlPublic.find(
          (entry) => entry.key === controllableNodeId,
        );
        if (item) {
          item.relayStatus = action === 'ON';
        }
        send({ success: 'ok' });
        return;
      }
      const answer = {
        advancedConfigPublic: this.data.advancedConfigPublic,
        configPublic: this.data.configPublic,
        commandControlPublic: this.data.commandControlPublic,
        instantaneous: this.data.instantaneous,
        channelsConfigPublic: { inputChannels: [] },
      }[command];
      if (answer === undefined) {
        send({ error: 'Unknown command' });
        return;
      }
      send(answer);
    });
  }
}

export class FakeSmappeeBroker {
  constructor({ host = '127.0.0.3', port = 0 } = {}) {
    this.data = fixture('mqtt-genius');
    this.host = host;
    this.port = port;
    this.clients = new Set();
    this.published = [];
    // Pushed on subscription, as the retained messages of a real broker.
    this.retained = ['config', 'channelConfigV2', 'homeControlConfig'];
    this.server = net.createServer((socket) => this.accept(socket));
  }

  async start() {
    this.port = await listen(this.server, this.host, this.port);
    return this;
  }

  stop() {
    for (const client of this.clients) {
      client.socket.destroy();
    }
    return close(this.server);
  }

  /** Drop every connection (the monitor rebooted). */
  dropAll() {
    for (const client of this.clients) {
      client.socket.destroy();
    }
  }

  topic(rest) {
    return `servicelocation/${this.data.uuid}/${rest}`;
  }

  publish(rest, payload) {
    const data = publishPacket(this.topic(rest), JSON.stringify(payload));
    for (const client of this.clients) {
      client.socket.write(data);
    }
  }

  /** One realtime reading (the fixture's, with optional overrides). */
  realtime(overrides = {}) {
    this.publish('realtime', { ...this.data.realtime, ...overrides });
  }

  accept(socket) {
    const client = { socket, buffer: Buffer.alloc(0) };
    socket.on('error', () => {});
    socket.on('close', () => this.clients.delete(client));
    socket.on('data', (chunk) => {
      client.buffer = Buffer.concat([client.buffer, chunk]);
      const { packets, rest } = splitPackets(client.buffer);
      client.buffer = Buffer.from(rest);
      for (const packet of packets) {
        this.onPacket(client, packet);
      }
    });
  }

  onPacket(client, { type, flags, body }) {
    const { socket } = client;
    switch (type) {
      case 1: // CONNECT: no authentication on the local broker
        socket.write(Buffer.from([0x20, 2, 0, 0]));
        return;
      case 8: {
        // SUBSCRIBE
        socket.write(
          Buffer.concat([Buffer.from([0x90, 3]), body.subarray(0, 2), Buffer.from([0])]),
        );
        this.clients.add(client);
        for (const rest of this.retained) {
          socket.write(publishPacket(this.topic(rest), JSON.stringify(this.data[rest])));
        }
        return;
      }
      case 3: {
        const { topic, payload } = readPublish(flags, body);
        this.published.push({ topic, payload: payload.toString('utf8') });
        const match = /plug\/(\d+)\/setstate$/.exec(topic);
        if (match) {
          const { value } = JSON.parse(payload.toString('utf8'));
          this.publish(`plug/${match[1]}/state`, { value });
        }
        return;
      }
      case 12:
        socket.write(Buffer.from([0xd0, 0]));
        return;
      case 14:
        socket.end();
        return;
      default:
    }
  }
}

export class FakeSmappeeCloud {
  constructor({ host = '127.0.0.1', port = 0, clientId = 'gladys-client' } = {}) {
    this.data = fixture('cloud');
    this.host = host;
    this.port = port;
    this.clientId = clientId;
    this.requests = [];
    this.actuators = { 1: 'OFF_OFF' };
    this.server = createServer((req, res) => this.handle(req, res));
  }

  async start() {
    this.port = await listen(this.server, this.host, this.port);
    return this;
  }

  stop() {
    this.server.closeAllConnections?.();
    return close(this.server);
  }

  get baseUrl() {
    return `http://${this.host}:${this.port}/dev/v3`;
  }

  handle(req, res) {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      const url = new URL(req.url, 'http://fake');
      const path = url.pathname.replace(/^\/dev\/v3\//, '');
      this.requests.push({
        method: req.method,
        path,
        query: Object.fromEntries(url.searchParams),
        body,
      });
      const send = (status, answer, type = 'application/json') => {
        res.writeHead(status, { 'Content-Type': type });
        res.end(type === 'application/json' ? JSON.stringify(answer) : answer);
      };
      if (path === 'oauth2/token') {
        const form = new URLSearchParams(body);
        if (form.get('client_id') !== this.clientId) {
          send(400, this.data.tokenRefused);
          return;
        }
        if (form.get('grant_type') === 'password' && form.get('password') !== 'secret') {
          send(401, { error: 'Bad credentials' });
          return;
        }
        send(200, this.data.token);
        return;
      }
      if (req.headers.authorization !== `Bearer ${this.data.token.access_token}`) {
        send(401, '<html>Error 401 Unauthorized</html>', 'text/html');
        return;
      }
      if (path === 'servicelocation') {
        send(200, this.data.serviceLocations);
        return;
      }
      const match = /^servicelocation\/(\d+)\/(.+)$/.exec(path);
      if (!match || match[1] !== '20202') {
        send(404, { error: 'Not found' });
        return;
      }
      const rest = match[2];
      if (rest === 'meteringconfiguration') {
        send(200, this.data.meteringConfiguration);
      } else if (rest === 'consumption') {
        const from = Number(url.searchParams.get('from'));
        const to = Number(url.searchParams.get('to'));
        send(200, {
          ...this.data.consumption,
          consumptions: this.data.consumption.consumptions.filter(
            (block) => block.timestamp >= from && block.timestamp <= to,
          ),
        });
      } else if (/^actuator\/\d+\/state$/.test(rest)) {
        const id = rest.split('/')[1];
        send(200, this.actuators[id] ?? 'OFF_OFF', 'text/plain');
      } else if (/^actuator\/\d+\/(ON_ON|OFF_OFF)$/.test(rest) && req.method === 'POST') {
        const [, id, state] = rest.split('/');
        this.actuators[id] = state;
        send(200, '', 'text/plain');
      } else {
        send(404, { error: 'Not found' });
      }
    });
  }

  /** A new 5-minute block, `minutes` after the last one. */
  addBlock(consumption, solar, minutes = 5) {
    const blocks = this.data.consumption.consumptions;
    const at = blocks[blocks.length - 1].timestamp + minutes * 60_000;
    blocks.push({ timestamp: at, consumption, solar, alwaysOn: 12 });
    return at;
  }
}

// `node tools/fake-smappee.mjs --serve`: an HTTP monitor on port 80, a broker on
// 1883 sending a reading every second, and the cloud on 8080 (Docker check).
if (process.argv.includes('--serve')) {
  const http = await new FakeSmappeeHttp({ host: '0.0.0.0', port: 80 }).start();
  const broker = await new FakeSmappeeBroker({ host: '0.0.0.0', port: 1883 }).start();
  const cloud = await new FakeSmappeeCloud({ host: '0.0.0.0', port: 8080 }).start();
  setInterval(() => broker.realtime(), 1000);
  console.log(`fake Smappee: HTTP ${http.port}, MQTT ${broker.port}, cloud ${cloud.port}`);
}
