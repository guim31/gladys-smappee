// -----------------------------------------------------------------------------
// The Smappee hub: finds the monitors at the typed addresses and in the cloud
// account, keeps their readings, publishes devices and states to Gladys, runs
// the plug commands and fires the scene triggers.
//
// Three ways in, the local ones first (pysmappee's order):
//   - local HTTP (Smappee Energy, Solar, Pro/Plus): read every `pollSeconds`;
//   - local MQTT (Infinity, Genius, Connect): the monitor pushes a reading
//     about every second; the hub integrates the energy at each one and
//     publishes at the configured pace;
//   - cloud (any monitor, when the four cloud fields are filled in): 5-minute
//     aggregates, read every 5 minutes, for the monitors not read locally.
// Gladys never polls these devices (should_poll: false).
// -----------------------------------------------------------------------------

import net from 'node:net';
import { randomBytes } from 'node:crypto';
import { createLogger } from '@gladysassistant/integration-sdk';
import {
  ACTUATOR_KEYS,
  SUBMETER_KEYS,
  buildDevice,
  deviceIds,
  deviceName,
  deviceValues,
  isSlow,
  monitorKeys,
} from './devices.js';
import { accumulate, createMeter } from './energy.js';
import { SmappeeCloud } from './smappee/cloud.js';
import { HTTP_PORT, SmappeeHttp } from './smappee/http.js';
import {
  cloudActuators,
  cloudBlocks,
  cloudHasSolar,
  cloudState,
  httpActuators,
  httpChannels,
  instantaneousPowers,
  isPlusSeries,
  isSolarSeries,
  mqttActuators,
  mqttChannels,
  mqttConfig,
  mqttRealtime,
  normalizeSerial,
  serialFromAdvancedConfig,
  splitTopic,
} from './smappee/model.js';
import { MqttSession } from './smappee/mqtt.js';
import { CONNECTION_TEXT, localError } from './texts.js';

const logger = createLogger({ name: 'smappee-hub' });

export const WIDGET_KEY = 'energy_flow';
export const TRIGGERS = { OFFLINE: 'monitor_offline', ONLINE: 'monitor_online' };
export const MQTT_PORT = 1883;

export const HUB_TIMINGS = {
  // Cloud aggregates are 5-minute blocks: no use reading them more often.
  cloudPollMs: 5 * 60_000,
  // The metering configuration (plugs, solar) of the cloud sites is read again this often.
  cloudConfigMs: 6 * 3600_000,
  // A cloud monitor whose last block is older than this is offline.
  cloudStaleMs: 30 * 60_000,
  // Local readings in a row without answer before a monitor is "offline".
  unreachableAfter: 3,
  // An MQTT monitor silent this long is offline (it pushes every second).
  mqttStaleMs: 60_000,
  // A lost MQTT connection, or a typed address without a Smappee, is tried again this often.
  reconnectMs: 30_000,
  // Slow features (indexes, voltages, currents) are published at most this often.
  slowPublishMs: 60_000,
  // An unchanged value is re-sent this often, so it stays recently dated.
  heartbeatMs: 30 * 60_000,
  // The widget shows computed values: nudge it at most this often.
  widgetNudgeMs: 10_000,
  // States a minute for all the devices, under the 300 Gladys accepts.
  stateBudget: 240,
  // The energy indexes are written to /data at most this often.
  saveMs: 60_000,
};

const recordKey = (kind, serial, id) =>
  kind === 'monitor' ? `monitor:${serial}` : `${kind}:${serial}-${id}`;

export class SmappeeHub {
  /**
   * @param {object} options
   * @param {object} options.gladys GladysIntegration (or the SDK's fake)
   * @param {object} options.store persistence (src/store.js)
   * @param {boolean} [options.timers] periodic timers (off in tests)
   * @param {object} [options.timings] HUB_TIMINGS overrides
   * @param {object} [options.network] test seams: `{ httpPort, mqttPort, cloudBaseUrl }`
   */
  constructor({ gladys, store, timers = true, timings, network = {} }) {
    this.gladys = gladys;
    this.store = store;
    this.timersEnabled = timers;
    this.timings = { ...HUB_TIMINGS, ...timings };
    this.network = network;
    this.config = null;
    /** @type {Map<string, object>} monitors, sub-meters and actuators, by recordKey */
    this.records = new Map();
    /** @type {Map<string, object>} typed addresses: `{ address, type, client, session, serial, problem }` */
    this.hosts = new Map();
    this.cloud = null;
    // 'off' | 'ok' | 'refused' | 'down' | 'incomplete'
    this.cloudStatus = 'off';
    this.cloudConfigAt = 0;
    // A failing cloud is asked again later and later (never faster than its data).
    this.cloudRetryAt = 0;
    this.cloudFailures = 0;
    this.reconnecting = null;
    this.publishOffset = 0;
    this.pending = new Set();
    this.timers = [];
    this.polling = null;
    this.cloudPolling = null;
    this.lastWidgetNudge = 0;
    this.lastSave = 0;
    this.devicesDirty = false;
    this.backgroundFailing = false;
    this.spent = [];
    this.stopped = false;
  }

  // --- Lifecycle -------------------------------------------------------------

  async start(config) {
    this.config = config;
    try {
      await this.restore();
      await this.connectAll();
      await this.publishEverything();
    } finally {
      this.startTimers();
    }
  }

  /** Gladys came back (restart, network): it may have lost what was published. */
  async resync(config) {
    this.config = config;
    this.gladys.forgetPublishedStates();
    for (const record of this.records.values()) {
      record.sent = {};
    }
    await this.publishEverything();
  }

  async reconfigure(config) {
    const previous = this.config;
    this.config = config;
    if (JSON.stringify(previous?.cloud) !== JSON.stringify(config.cloud)) {
      // New credentials (or account): a new client, without the old token.
      this.cloud = null;
      this.cloudStatus = 'off';
      this.cloudRetryAt = 0;
      this.cloudFailures = 0;
    }
    this.disconnectAll();
    await this.connectAll();
    await this.publishEverything();
    this.startTimers();
  }

  async publishEverything() {
    await this.publishDevices();
    await this.publishAllStates();
    await this.publishTransports();
    await this.publishConnectionStatus();
    this.requestWidgetRefresh(true);
  }

  startTimers() {
    for (const timer of this.timers) {
      clearInterval(timer);
    }
    this.timers = [];
    if (!this.timersEnabled || this.stopped) {
      return;
    }
    const every = (ms, task) => {
      const timer = setInterval(() => this.track(this.timerTask(task())), ms);
      this.timers.push(timer);
    };
    every(this.timings.pollMs ?? this.config.pollSeconds * 1000, () => this.pollLocal());
    every(this.timings.cloudPollMs, () => this.pollCloud());
    every(this.timings.reconnectMs, () => this.reconnect());
  }

  /** Timer work: a failure is logged once, then again when it works. */
  async timerTask(promise) {
    try {
      await promise;
    } catch (err) {
      if (this.backgroundFailing) {
        logger.debug(`Still failing: ${err.message}`);
      } else {
        this.backgroundFailing = true;
        logger.warn(`Cannot update Gladys: ${err.message} (retried at the next readings)`);
      }
      return;
    }
    if (this.backgroundFailing) {
      this.backgroundFailing = false;
      logger.info('Gladys is updated again');
    }
  }

  async stop() {
    this.stopped = true;
    for (const timer of this.timers) {
      clearInterval(timer);
    }
    this.disconnectAll();
    await this.idle();
    await this.save();
    await this.store.flush();
  }

  track(promise) {
    const tracked = Promise.resolve(promise)
      .catch((err) => logger.error('Background task failed', err))
      .finally(() => this.pending.delete(tracked));
    this.pending.add(tracked);
    return tracked;
  }

  async idle() {
    while (this.pending.size > 0) {
      await Promise.all([...this.pending]);
    }
  }

  // --- Persistence -----------------------------------------------------------

  async restore() {
    const data = await this.store.load();
    for (const saved of Object.values(data.records ?? {})) {
      const serial = normalizeSerial(saved?.serial);
      if (!serial || !['monitor', 'submeter', 'actuator'].includes(saved.kind)) {
        continue;
      }
      if (saved.kind !== 'monitor' && !/^\d{1,9}$/.test(String(saved.id ?? ''))) {
        continue;
      }
      const record = this.ensureRecord(saved.kind, serial, saved.id);
      record.name = typeof saved.name === 'string' ? saved.name : null;
      record.access = ['http', 'mqtt', 'cloud'].includes(saved.access) ? saved.access : null;
      record.address = typeof saved.address === 'string' ? saved.address : null;
      record.actuatorKind = saved.actuatorKind === 'plug' ? 'plug' : 'switch';
      record.locationId = saved.locationId ?? null;
      if (Array.isArray(saved.keys)) {
        record.keys = saved.keys.filter((key) => typeof key === 'string');
      }
      for (const [name, kwh] of Object.entries(saved.meters ?? {})) {
        record.meters[name] = createMeter(kwh);
      }
      record.cloudAt = Number.isFinite(saved.cloudAt) ? saved.cloudAt : null;
    }
  }

  save() {
    const records = {};
    for (const [key, record] of this.records) {
      records[key] = {
        kind: record.kind,
        serial: record.serial,
        id: record.id,
        name: record.name,
        access: record.access,
        address: record.address,
        actuatorKind: record.actuatorKind,
        locationId: record.locationId,
        keys: record.keys,
        meters: Object.fromEntries(
          Object.entries(record.meters).map(([name, meter]) => [name, meter.kwh]),
        ),
        cloudAt: record.cloudAt,
      };
    }
    this.lastSave = Date.now();
    return this.store.save({ records });
  }

  // --- Records ---------------------------------------------------------------

  ensureRecord(kind, serial, id = null) {
    const key = recordKey(kind, serial, id);
    let record = this.records.get(key);
    if (!record) {
      record = {
        kind,
        serial,
        id: kind === 'monitor' ? null : String(id),
        name: null,
        access: null,
        address: null,
        actuatorKind: 'switch',
        locationId: null,
        keys:
          kind === 'submeter' ? [...SUBMETER_KEYS] : kind === 'actuator' ? [...ACTUATOR_KEYS] : [],
        live: {},
        meters: {},
        on: null,
        connected: null,
        // null until the first reading or the first failure.
        reachable: null,
        failures: 0,
        lastReadingAt: 0,
        cloudAt: null,
        sent: {},
      };
      this.records.set(key, record);
    }
    return record;
  }

  monitor(serial) {
    return this.records.get(recordKey('monitor', serial)) ?? null;
  }

  childrenOf(serial) {
    return [...this.records.values()].filter(
      (record) => record.kind !== 'monitor' && record.serial === serial,
    );
  }

  meter(record, name) {
    record.meters[name] ??= createMeter();
    return record.meters[name];
  }

  /** Grow the features of a record (never shrink: the structure must not blink). */
  setKeys(record, keys) {
    const merged = [...record.keys];
    for (const key of keys) {
      if (!merged.includes(key)) {
        merged.push(key);
      }
    }
    if (merged.length !== record.keys.length) {
      record.keys = merged;
      this.devicesDirty = true;
      this.track(this.save());
      return true;
    }
    return false;
  }

  /** A monitor seen through one access: the local ones win over the cloud. */
  adoptMonitor(serial, { access, address = null, solar = false, phases = 0 }) {
    const record = this.ensureRecord('monitor', serial);
    const before = `${record.access}|${record.address}`;
    if (access !== 'cloud' || !record.access || record.access === 'cloud') {
      if (record.access !== access && record.access) {
        logger.info(`Smappee ${serial} now read through ${access}`);
      }
      record.access = access;
      record.address = address;
    }
    // Solar unknown (MQTT before its channel configuration): no feature yet,
    // or a monitor would get both the solar and the non-solar features.
    if (solar !== null) {
      this.setKeys(record, monitorKeys({ solar, phases }));
    }
    if (`${record.access}|${record.address}` !== before) {
      this.devicesDirty = true;
    }
    return record;
  }

  /** The actuators of a monitor, from the access that lists them. */
  adoptActuators(serial, actuators, via) {
    for (const found of actuators) {
      const record = this.ensureRecord('actuator', serial, found.id);
      if (record.access && record.access !== via && via === 'cloud') {
        continue; // already controlled locally
      }
      const name = found.name ?? record.name;
      if (record.name !== name || record.access !== via || record.actuatorKind !== found.kind) {
        this.devicesDirty = true;
      }
      record.name = name;
      record.access = via;
      record.actuatorKind = found.kind;
      if (typeof found.on === 'boolean') {
        record.on = found.on;
      }
      if (typeof found.connected === 'boolean') {
        record.connected = found.connected;
      }
    }
  }

  // --- Local access ---------------------------------------------------------------

  async connectAll() {
    await Promise.all(this.config.hosts.map((address) => this.connectHost(address)));
    // A monitor whose address was removed from the configuration is no longer
    // read locally: the cloud may take it over, else it leaves the list.
    for (const record of this.records.values()) {
      if (
        ['http', 'mqtt'].includes(record.access) &&
        !this.config.hosts.includes(this.monitor(record.serial)?.address ?? record.address)
      ) {
        record.access = null;
        record.reachable = null;
        record.live = {};
        this.devicesDirty = true;
      }
    }
    await this.connectCloud();
    await this.save();
  }

  disconnectAll() {
    for (const entry of this.hosts.values()) {
      entry.closing = true;
      entry.session?.close();
    }
    this.hosts.clear();
  }

  /** Who answers at a typed address: the HTTP API, else the MQTT broker. */
  async connectHost(address) {
    const entry = this.hosts.get(address) ?? { address, type: null, problem: null };
    this.hosts.set(address, entry);
    if (entry.connecting) {
      return;
    }
    entry.connecting = true;
    try {
      await this.probeHost(entry);
    } finally {
      entry.connecting = false;
    }
  }

  async probeHost(entry) {
    const { address } = entry;
    const client = new SmappeeHttp({
      host: address,
      port: this.network.httpPort ?? HTTP_PORT,
      password: this.config.localPassword,
    });
    try {
      await client.logon();
      const serial = serialFromAdvancedConfig(await client.advancedConfig());
      if (!serial) {
        throw Object.assign(new Error(`${address} gave no serial number`), { kind: 'invalid' });
      }
      const channels = httpChannels(serial, {
        config: isSolarSeries(serial) ? await client.config() : undefined,
        channels: isPlusSeries(serial) ? await client.channelsConfig() : undefined,
      });
      Object.assign(entry, { type: 'http', client, serial, channels, problem: null });
      this.adoptMonitor(serial, {
        access: 'http',
        address,
        solar: channels.production.length > 0,
      });
      this.adoptActuators(serial, httpActuators(await client.commandControl()), 'http');
      logger.info(`Smappee ${serial} found at ${address} (local HTTP API)`);
      await this.readHttp(entry);
      return;
    } catch (err) {
      if (err.kind === 'unauthorized') {
        // Maybe a wrong password; maybe a web server of an MQTT monitor: try MQTT first.
        await this.connectMqtt(entry, { quiet: true });
        if (entry.type !== 'mqtt') {
          if (entry.problem !== 'password') {
            logger.warn(`Smappee at ${address} refused the password of its local web interface`);
          }
          entry.problem = 'password';
        }
        return;
      }
      logger.debug(`No Smappee HTTP API at ${address}: ${err.message}`);
    }
    await this.connectMqtt(entry);
  }

  async connectMqtt(entry, { quiet = false } = {}) {
    const { address } = entry;
    const session = new MqttSession({
      connect: () => net.connect({ host: address, port: this.network.mqttPort ?? MQTT_PORT }),
      clientId: `gladys-smappee-${randomBytes(4).toString('hex')}`,
      topic: 'servicelocation/#',
      keepalive: 30,
      connectTimeout: 5000,
    });
    try {
      await session.open();
    } catch (err) {
      logger.debug(`No Smappee MQTT broker at ${address}: ${err.message}`);
      if (quiet) {
        return;
      }
      if (entry.problem !== 'noSmappee') {
        logger.warn(`No Smappee answers at ${address} (HTTP or MQTT), tried again later`);
      }
      entry.problem = 'noSmappee';
      entry.type = null;
      return;
    }
    if (entry.closing || this.stopped) {
      // Removed (reconfiguration, stop) while connecting.
      session.close();
      return;
    }
    Object.assign(entry, { type: 'mqtt', session, problem: entry.serial ? null : 'waiting' });
    logger.info(`Connected to the Smappee MQTT broker at ${address}`);
    session.on('message', (topic, payload) => {
      try {
        this.onMqttMessage(entry, topic, payload);
      } catch (err) {
        logger.debug(`Smappee message on ${topic} ignored: ${err.message}`);
      }
    });
    session.on('close', (error) => {
      if (entry.closing || this.stopped || entry.session !== session) {
        return;
      }
      logger.info(
        `Connection to the Smappee MQTT broker at ${address} lost${error ? `: ${error.message}` : ''}`,
      );
      entry.session = null;
      entry.type = null;
    });
  }

  /** Every `reconnectMs`: lost brokers, addresses without an answer, the cloud configuration. */
  reconnect() {
    // One at a time: an address without answer takes about 10 s.
    this.reconnecting ??= this.runReconnect().finally(() => {
      this.reconnecting = null;
    });
    return this.reconnecting;
  }

  async runReconnect() {
    for (const entry of this.hosts.values()) {
      if (!entry.type && !entry.closing) {
        await this.connectHost(entry.address);
      }
    }
    if (
      this.config.cloud &&
      Date.now() >= this.cloudRetryAt &&
      (this.cloudStatus !== 'ok' || Date.now() - this.cloudConfigAt > this.timings.cloudConfigMs)
    ) {
      await this.connectCloud();
    }
    if (this.devicesDirty) {
      await this.publishDevices();
    }
  }

  onMqttMessage(entry, topic, raw) {
    const parts = splitTopic(topic);
    if (!parts) {
      return;
    }
    const { rest } = parts;
    const plug = /^plug\/(\d{1,9})\/(state|connectionState)$/.exec(rest);
    if (!['config', 'channelConfigV2', 'homeControlConfig', 'realtime'].includes(rest) && !plug) {
      return;
    }
    const payload = JSON.parse(raw.toString('utf8'));
    if (rest === 'config') {
      const config = mqttConfig(payload);
      if (config.serial) {
        const known = entry.serial === config.serial;
        entry.serial = config.serial;
        entry.uuid = config.uuid ?? parts.uuid;
        entry.problem = null;
        this.adoptMonitor(config.serial, {
          access: 'mqtt',
          address: entry.address,
          solar: entry.channels ? entry.channels.solar.length > 0 : null,
        });
        if (!known) {
          logger.info(`Smappee ${config.serial} found at ${entry.address} (local MQTT)`);
          this.applyPendingMqtt(entry);
        }
      }
      return;
    }
    if (!entry.serial) {
      // Not known yet: keep the last configuration messages for the config one.
      entry.early ??= {};
      if (rest !== 'realtime' && !plug) {
        entry.early[rest] = payload;
      }
      return;
    }
    this.applyMqtt(entry, rest, plug, payload);
  }

  applyPendingMqtt(entry) {
    for (const [rest, payload] of Object.entries(entry.early ?? {})) {
      this.applyMqtt(entry, rest, null, payload);
    }
    entry.early = null;
  }

  applyMqtt(entry, rest, plug, payload) {
    const { serial } = entry;
    if (rest === 'channelConfigV2') {
      entry.channels = mqttChannels(payload);
      this.adoptMonitor(serial, {
        access: 'mqtt',
        address: entry.address,
        solar: entry.channels.solar.length > 0,
      });
      for (const sub of entry.channels.submeters) {
        const record = this.ensureRecord('submeter', serial, sub.id);
        if (record.name !== sub.name) {
          record.name = sub.name;
          this.devicesDirty = true;
        }
        record.access = 'mqtt';
        record.indexes = sub.indexes;
      }
      return;
    }
    if (rest === 'homeControlConfig') {
      this.adoptActuators(serial, mqttActuators(payload), 'mqtt');
      return;
    }
    if (plug) {
      const record = this.records.get(recordKey('actuator', serial, plug[1]));
      if (!record) {
        return;
      }
      const value = String(payload?.value ?? '').toUpperCase();
      if (plug[2] === 'state' && (value === 'ON' || value === 'OFF')) {
        record.on = value === 'ON';
        this.track(this.publishStates(record));
      } else if (plug[2] === 'connectionState') {
        const connected = value === 'CONNECTED';
        if (record.connected !== connected) {
          record.connected = connected;
          this.track(this.publishTransports([record]));
        }
      }
      return;
    }
    // realtime
    const reading = mqttRealtime(payload);
    const monitor = this.monitor(serial);
    if (!monitor || monitor.access !== 'mqtt') {
      return;
    }
    const at = Date.now();
    const channels = entry.channels ?? { grid: [], solar: [], submeters: [] };
    const sum = (indexes, field) => {
      const values = indexes
        .map((index) => reading.channels.get(index)?.[field])
        .filter((v) => typeof v === 'number');
      return values.length === 0 ? null : values.reduce((a, b) => a + b, 0);
    };
    const production = channels.solar.length > 0 ? sum(channels.solar, 'power') : null;
    monitor.live = {
      consumption: reading.total,
      production: production === null ? null : Math.abs(production),
      voltages: reading.voltages,
    };
    if (reading.voltages.length > 0) {
      this.setKeys(
        monitor,
        monitorKeys({ solar: channels.solar.length > 0, phases: reading.voltages.length }),
      );
    }
    this.integrateMonitor(monitor, at);
    for (const sub of channels.submeters) {
      const record = this.records.get(recordKey('submeter', serial, sub.id));
      if (!record) {
        continue;
      }
      const power = sum(sub.indexes, 'power');
      record.live = { power, current: sum(sub.indexes, 'current') };
      accumulate(this.meter(record, 'consumption'), power === null ? null : Math.abs(power), at);
      record.lastReadingAt = at;
    }
    monitor.lastReadingAt = at;
    if (monitor.reachable !== true) {
      this.track(this.setReachable(monitor, true));
    }
  }

  /** Add the energy of the monitor's live powers to its indexes. */
  integrateMonitor(monitor, at) {
    const { consumption, production } = monitor.live;
    accumulate(this.meter(monitor, 'consumption'), consumption, at);
    if (monitor.keys.includes('solar-power')) {
      accumulate(this.meter(monitor, 'production'), production, at);
      const net =
        typeof consumption === 'number' && typeof production === 'number'
          ? consumption - production
          : null;
      accumulate(this.meter(monitor, 'import'), net === null ? null : Math.max(net, 0), at);
      accumulate(this.meter(monitor, 'export'), net === null ? null : Math.max(-net, 0), at);
    }
  }

  async readHttp(entry) {
    const monitor = this.monitor(entry.serial);
    if (!monitor || monitor.access !== 'http') {
      return;
    }
    let powers;
    let actuators = null;
    try {
      powers = instantaneousPowers(await entry.client.instantaneous(), entry.channels);
      if (this.childrenOf(entry.serial).some((record) => record.kind === 'actuator')) {
        actuators = httpActuators(await entry.client.commandControl());
      }
    } catch (err) {
      logger.debug(`Cannot read the Smappee at ${entry.address}: ${err.message}`);
      await this.readFailed(monitor);
      return;
    }
    const at = Date.now();
    monitor.live = { consumption: powers.consumption, production: powers.production, voltages: [] };
    this.integrateMonitor(monitor, at);
    monitor.lastReadingAt = at;
    monitor.failures = 0;
    if (actuators) {
      this.adoptActuators(entry.serial, actuators, 'http');
    }
    if (monitor.reachable !== true) {
      await this.setReachable(monitor, true);
    }
  }

  async readFailed(monitor) {
    monitor.failures += 1;
    if (monitor.failures >= this.timings.unreachableAfter || monitor.reachable === null) {
      monitor.live = {};
      await this.setReachable(monitor, false);
    }
  }

  /** The timer: read the HTTP monitors, check the MQTT ones, publish what changed. */
  pollLocal() {
    this.polling ??= (async () => {
      for (const entry of this.hosts.values()) {
        if (entry.type === 'http') {
          await this.readHttp(entry);
        }
      }
      const now = Date.now();
      for (const record of this.records.values()) {
        if (
          record.kind === 'monitor' &&
          record.access === 'mqtt' &&
          record.reachable !== false &&
          now - record.lastReadingAt > this.timings.mqttStaleMs
        ) {
          // Neither the values nor the indexes bridge the silence.
          for (const silent of [record, ...this.childrenOf(record.serial)]) {
            if (silent.kind !== 'actuator') {
              silent.live = {};
            }
            for (const meter of Object.values(silent.meters)) {
              meter.at = null;
            }
          }
          await this.setReachable(record, false);
        }
      }
      await this.publishRound();
    })().finally(() => {
      this.polling = null;
    });
    return this.polling;
  }

  async publishRound() {
    if (this.devicesDirty) {
      await this.publishDevices();
    }
    let widget = false;
    // A rotating start: when the state budget runs out, not always the same devices wait.
    const records = [...this.records.values()];
    this.publishOffset = (this.publishOffset + 1) % Math.max(records.length, 1);
    const ordered = [...records.slice(this.publishOffset), ...records.slice(0, this.publishOffset)];
    for (const record of ordered) {
      const sent = await this.publishStates(record);
      if (record.kind === 'monitor' && sent.length > 0) {
        widget = true;
      }
    }
    if (widget) {
      this.requestWidgetRefresh();
    }
    if (Date.now() - this.lastSave >= this.timings.saveMs) {
      this.track(this.save());
    }
  }

  // --- Cloud -------------------------------------------------------------------------

  async connectCloud() {
    if (!this.config.cloud) {
      this.cloud = null;
      this.cloudStatus = this.config.cloudIncomplete ? 'incomplete' : 'off';
      return;
    }
    this.cloud ??= new SmappeeCloud({
      credentials: this.config.cloud,
      baseUrl: this.network.cloudBaseUrl,
    });
    try {
      const answer = await this.cloud.serviceLocations();
      for (const location of answer?.serviceLocations ?? []) {
        const serial = normalizeSerial(location?.deviceSerialNumber);
        if (!serial || location.serviceLocationId === undefined) {
          continue;
        }
        const config = await this.cloud.meteringConfiguration(location.serviceLocationId);
        const local = this.monitor(serial);
        const record = this.adoptMonitor(serial, { access: 'cloud', solar: cloudHasSolar(config) });
        record.locationId = String(location.serviceLocationId);
        if (!local || local.access === 'cloud') {
          this.adoptActuators(serial, cloudActuators(config), 'cloud');
          for (const actuator of this.childrenOf(serial)) {
            if (actuator.kind === 'actuator' && actuator.access === 'cloud') {
              actuator.locationId = record.locationId;
            }
          }
        }
      }
      if (this.cloudStatus !== 'ok') {
        logger.info('Connected to the Smappee cloud');
      }
      this.cloudStatus = 'ok';
      this.cloudFailures = 0;
      this.cloudConfigAt = Date.now();
      await this.pollCloud();
    } catch (err) {
      this.cloudFailed(err);
    }
  }

  cloudFailed(err) {
    const status = err.kind === 'unauthorized' ? 'refused' : 'down';
    if (this.cloudStatus !== status) {
      logger.warn(`Smappee cloud: ${err.message}`);
    } else {
      logger.debug(`Smappee cloud: ${err.message}`);
    }
    this.cloudStatus = status;
    this.cloudFailures += 1;
    // Refused credentials: once an hour (no account lock-out); otherwise 5, 10, 20, 30 min.
    this.cloudRetryAt =
      Date.now() +
      (status === 'refused'
        ? 3600_000
        : Math.min(this.timings.cloudPollMs * 2 ** (this.cloudFailures - 1), 30 * 60_000));
  }

  /** Every 5 minutes: the new aggregates of the monitors read through the cloud. */
  pollCloud() {
    if (!this.cloud || this.cloudStatus !== 'ok') {
      return Promise.resolve();
    }
    this.cloudPolling ??= this.readCloud().finally(() => {
      this.cloudPolling = null;
    });
    return this.cloudPolling;
  }

  async readCloud() {
    const now = Date.now();
    // One site or plug answering badly (a 404...) does not stop the others; a
    // refused token or a cloud down does.
    const each = async (label, task) => {
      try {
        await task();
        return true;
      } catch (err) {
        if (err.kind === 'invalid') {
          logger.debug(`Smappee cloud, ${label}: ${err.message}`);
          return true;
        }
        this.cloudFailed(err);
        return false;
      }
    };
    for (const monitor of [...this.records.values()]) {
      if (monitor.kind !== 'monitor' || monitor.access !== 'cloud' || !monitor.locationId) {
        continue;
      }
      const ok = await each(`site ${monitor.locationId}`, async () => {
        // The first time, the last hour sets the starting point (no energy added).
        // Never more than a day back (the 5-minute data are kept a few days only).
        const from =
          monitor.cloudAt === null
            ? now - 3600_000
            : Math.max(monitor.cloudAt + 1, now - 86_400_000);
        // A block still filling (its 5 minutes not over) waits for the next read.
        const blocks = cloudBlocks(
          await this.cloud.consumption(monitor.locationId, from, now),
        ).filter((block) => block.at + 5 * 60_000 <= now);
        this.applyCloudBlocks(monitor, blocks);
        const fresh =
          monitor.cloudAt !== null && now - monitor.cloudAt <= this.timings.cloudStaleMs;
        if (!fresh) {
          monitor.live = {};
        }
        if (monitor.reachable !== fresh) {
          await this.setReachable(monitor, fresh);
        }
      });
      if (!ok) {
        return;
      }
    }
    for (const actuator of [...this.records.values()]) {
      if (actuator.kind !== 'actuator' || actuator.access !== 'cloud' || !actuator.locationId) {
        continue;
      }
      const ok = await each(`plug ${actuator.id}`, async () => {
        const state = cloudState(await this.cloud.actuatorState(actuator.locationId, actuator.id));
        if (state !== null) {
          actuator.on = state;
        }
      });
      if (!ok) {
        return;
      }
    }
    await this.publishRound();
  }

  applyCloudBlocks(monitor, blocks) {
    const first = monitor.cloudAt === null;
    const solar = monitor.keys.includes('solar-power');
    // The indexes exist from the first read (at 0), so Gladys gets a value.
    for (const name of solar
      ? ['consumption', 'production', 'import', 'export']
      : ['consumption']) {
      this.meter(monitor, name);
    }
    for (const block of blocks) {
      if (monitor.cloudAt !== null && block.at <= monitor.cloudAt) {
        continue;
      }
      if (!first) {
        const consumption = Math.max(block.consumption, 0) / 1000;
        this.meter(monitor, 'consumption').kwh += consumption;
        if (solar && block.solar !== null) {
          const production = Math.max(block.solar, 0) / 1000;
          this.meter(monitor, 'production').kwh += production;
          const net = consumption - production;
          this.meter(monitor, 'import').kwh += Math.max(net, 0);
          this.meter(monitor, 'export').kwh += Math.max(-net, 0);
        }
      }
      monitor.cloudAt = block.at;
      // Watt-hours in 5 minutes -> average watts.
      monitor.live = {
        consumption: Math.max(block.consumption, 0) * 12,
        production: solar && block.solar !== null ? Math.max(block.solar, 0) * 12 : null,
        voltages: [],
      };
      monitor.lastReadingAt = Date.now();
    }
    if (blocks.length > 0) {
      this.track(this.save());
    }
  }

  // --- Reachability and triggers ---------------------------------------------------------

  async setReachable(monitor, reachable) {
    const was = monitor.reachable;
    monitor.reachable = reachable;
    monitor.failures = 0;
    if (was === reachable) {
      return;
    }
    if (was !== null || !reachable) {
      logger.info(`Smappee ${monitor.serial} ${reachable ? 'answers again' : 'no longer answers'}`);
    }
    if (this.isCreated(monitor) && was !== null) {
      const ids = deviceIds(this.gladys, monitor);
      this.track(
        this.gladys.publishSceneEvent(reachable ? TRIGGERS.ONLINE : TRIGGERS.OFFLINE, {
          device: ids.device,
          name: deviceName(monitor),
        }),
      );
    }
    await this.publishTransports([monitor, ...this.childrenOf(monitor.serial)]);
    await this.publishConnectionStatus();
    this.requestWidgetRefresh(true);
  }

  // --- Devices and states ------------------------------------------------------------------

  /** Records Gladys can show: monitors with an access, their sub-meters and actuators. */
  publishable() {
    return [...this.records.values()].filter((record) => {
      const monitor = this.monitor(record.serial);
      return monitor?.access && record.access && record.keys.length > 0;
    });
  }

  async publishDevices() {
    this.devicesDirty = true;
    const options = { language: this.config.language, controls: this.config.controls };
    const devices = this.publishable().map((record) => buildDevice(this.gladys, record, options));
    await this.gladys.publishDiscoveredDevices(devices);
    this.devicesDirty = false;
  }

  resolveDevice(externalId) {
    if (typeof externalId !== 'string') {
      return null;
    }
    for (const record of this.records.values()) {
      if (deviceIds(this.gladys, record).device === externalId) {
        return record;
      }
    }
    return null;
  }

  isCreated(record) {
    const id = deviceIds(this.gladys, record).device;
    return (this.gladys.devices ?? []).some((device) => device.external_id === id);
  }

  /**
   * Publish what changed for one device, if the user created it: unchanged
   * values wait for the heartbeat, slow ones go at most once a minute, and a
   * budget shared by all the devices holds back what does not fit.
   */
  async publishStates(record, { force = false } = {}) {
    if (!this.isCreated(record)) {
      return [];
    }
    const ids = deviceIds(this.gladys, record);
    const values = deviceValues(record);
    const now = Date.now();
    const slow = [];
    const fast = [];
    for (const key of record.keys) {
      const value = values[key];
      if (value === undefined) {
        continue;
      }
      const last = record.sent[key];
      if (!force && last) {
        if (last.value === value && now - last.at < this.timings.heartbeatMs) {
          continue;
        }
        if (isSlow(record.kind, key) && now - last.at < this.timings.slowPublishMs) {
          continue;
        }
      }
      (isSlow(record.kind, key) ? slow : fast).push(key);
    }
    const candidates = [...slow, ...fast];
    const keys = force ? candidates : candidates.slice(0, this.budgetLeft(now));
    if (keys.length === 0) {
      return [];
    }
    await this.gladys.publishChangedStates(
      keys.map((key) => ({ device_feature_external_id: ids.feature(key), state: values[key] })),
      { heartbeat: this.timings.heartbeatMs },
    );
    for (const key of keys) {
      record.sent[key] = { value: values[key], at: now };
    }
    this.spent.push({ at: now, count: keys.length });
    return keys;
  }

  budgetLeft(now) {
    this.spent = this.spent.filter((entry) => now - entry.at < 60_000);
    const used = this.spent.reduce((total, entry) => total + entry.count, 0);
    return Math.max(this.timings.stateBudget - used, 0);
  }

  async publishAllStates() {
    for (const record of this.records.values()) {
      try {
        await this.publishStates(record, { force: true });
      } catch (err) {
        logger.warn(`Cannot publish the states of ${deviceName(record)}: ${err.message}`);
      }
    }
  }

  /** The user added a device: the states sent before were dropped by Gladys. */
  async onDeviceCreated(device) {
    const record = this.resolveDevice(device?.external_id);
    if (!record) {
      return;
    }
    this.gladys.forgetPublishedStates(device.external_id);
    record.sent = {};
    await this.publishStates(record, { force: true });
    await this.publishTransports([record]);
    this.requestWidgetRefresh(true);
  }

  transportOf(record) {
    const monitor = this.monitor(record.serial);
    if (!monitor?.reachable || record.connected === false) {
      return 'unreachable';
    }
    return record.access === 'cloud' ? 'cloud' : 'local';
  }

  async publishTransports(records = [...this.records.values()]) {
    const entries = records
      .filter((record) => this.isCreated(record))
      .map((record) => ({
        external_id: deviceIds(this.gladys, record).device,
        transport: this.transportOf(record),
      }));
    for (let at = 0; at < entries.length; at += 100) {
      await this.gladys.publishTransports(entries.slice(at, at + 100));
    }
  }

  async publishConnectionStatus() {
    const monitors = this.monitors();
    if (this.config.hosts.length === 0 && !this.config.cloud) {
      await this.gladys.setConnectionStatus(false, CONNECTION_TEXT.noConfig);
    } else if (monitors.some((record) => record.reachable === true)) {
      await this.gladys.setConnectionStatus(true);
    } else {
      await this.gladys.setConnectionStatus(false, CONNECTION_TEXT.noAnswer);
    }
  }

  requestWidgetRefresh(now = false) {
    const at = Date.now();
    if (!now && at - this.lastWidgetNudge < this.timings.widgetNudgeMs) {
      return;
    }
    this.lastWidgetNudge = at;
    this.gladys.requestWidgetRefresh(WIDGET_KEY);
  }

  monitors() {
    return [...this.records.values()].filter(
      (record) => record.kind === 'monitor' && record.access,
    );
  }

  // --- Commands ----------------------------------------------------------------------------

  async setValue(device, feature, value) {
    const language = this.config.language;
    const record = this.resolveDevice(device?.external_id);
    if (!record) {
      throw localError('unknownDevice', language);
    }
    if (
      record.kind !== 'actuator' ||
      feature?.external_id !== deviceIds(this.gladys, record).feature('switch')
    ) {
      throw localError('readOnly', language);
    }
    if (!this.config.controls) {
      throw localError('controlsOff', language);
    }
    const on = Number(value) >= 1;
    try {
      if (record.access === 'cloud') {
        if (!this.cloud || !record.locationId) {
          throw localError('unreachable', language);
        }
        await this.cloud.setActuator(record.locationId, record.id, on);
      } else {
        const entry = [...this.hosts.values()].find(
          (host) => host.serial === record.serial && host.type,
        );
        if (!entry) {
          throw localError('unreachable', language);
        }
        if (entry.type === 'http') {
          await entry.client.control(record.id, on);
        } else {
          entry.session.publish(
            `servicelocation/${entry.uuid}/plug/${record.id}/setstate`,
            JSON.stringify({ value: on ? 'ON' : 'OFF' }),
          );
        }
      }
    } catch (err) {
      if (err.key) {
        throw err;
      }
      throw localError('unreachable', language, err);
    }
    logger.info(`${deviceName(record)} turned ${on ? 'on' : 'off'}`);
    record.on = on;
    await this.publishStates(record);
  }

  // --- Reports -----------------------------------------------------------------------------

  summary() {
    return {
      monitors: this.monitors().map((record) => ({
        name: deviceName(record),
        access: record.access,
        address: record.address,
        reachable: record.reachable === true,
      })),
      hosts: [...this.hosts.values()].map((entry) => ({
        address: entry.address,
        problem: entry.problem,
      })),
      cloud: this.cloudStatus,
      invalidHosts: this.config.invalidHosts,
    };
  }
}
