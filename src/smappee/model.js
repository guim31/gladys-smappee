// -----------------------------------------------------------------------------
// What the Smappee answers mean, after pysmappee (Apache-2.0,
// github.com/smappee/pysmappee), the library of the Home Assistant
// integration: models by serial number, the power channels of the local HTTP
// API, the messages of the local MQTT broker, the cloud metering
// configuration. Pure functions: no I/O here.
// -----------------------------------------------------------------------------

/** "Smappee Energy", "Smappee Genius"...: the model, from the serial prefix. */
export function modelOf(serial) {
  const s = String(serial ?? '');
  const byPrefix = [
    ['5100', 'Wi-Fi Connect'],
    ['5110', 'Wi-Fi Connect'],
    ['5130', 'Ethernet Connect'],
    ['5140', '4G Connect'],
    ['10', 'Energy'],
    ['11', 'Solar'],
    ['20', 'Pro/Plus'],
    ['50', 'Genius'],
    ['57', 'P1S1'],
  ];
  const found = byPrefix.find(([prefix]) => s.startsWith(prefix));
  return found ? `Smappee ${found[1]}` : 'Smappee';
}

export const isSolarSeries = (serial) => String(serial).startsWith('11');
export const isPlusSeries = (serial) => String(serial).startsWith('2');

/** A serial number as the monitors write it: digits only. */
export function normalizeSerial(value) {
  const s = String(value ?? '')
    .trim()
    .replace(/^smappee/i, '');
  return /^\d{6,20}$/.test(s) ? s : null;
}

const num = (value) => {
  const n = typeof value === 'string' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
};

// --- Local HTTP API (Smappee Energy, Solar, Pro/Plus) ---------------------------

// Power channels of an Energy or Solar monitor (pysmappee defaults): the
// consumption clamps on CT inputs 0-2, the solar ones on 3-5.
const DEFAULT_CHANNELS = { consumption: [0, 1, 2], production: [3, 4, 5] };

/**
 * The power channels of a monitor read over HTTP.
 * @param {string} serial
 * @param {object} [answers] `{ config, channels }`: configPublic and channelsConfigPublic
 * @returns {{ consumption: number[], production: number[] }} CT inputs
 */
export function httpChannels(serial, { config, channels } = {}) {
  if (isPlusSeries(serial) && Array.isArray(channels?.inputChannels)) {
    const result = { consumption: [], production: [] };
    for (const input of channels.inputChannels) {
      const ct = num(input?.ctInput);
      if (ct === null || input.inputChannelConnection !== 'GRID') {
        continue;
      }
      if (input.inputChannelType === 'CONSUMPTION') {
        result.consumption.push(ct);
      } else if (input.inputChannelType === 'PRODUCTION') {
        result.production.push(ct);
      }
    }
    return result;
  }
  if (isSolarSeries(serial) && Array.isArray(config)) {
    const entry = config.find((item) => item?.key === 'emeterConfiguration');
    switch (String(entry?.value ?? '')) {
      case '17': // single phase, solar
        return { consumption: [0], production: [1] };
      case '4': // three phases, no solar
        return { consumption: [0, 1, 2], production: [] };
      case '0': // single phase, no solar
        return { consumption: [0], production: [] };
      case '16': // two phases, solar
        return { consumption: [0, 1], production: [2, 3] };
      default: // '11': three phases, solar
        return DEFAULT_CHANNELS;
    }
  }
  if (isSolarSeries(serial)) {
    return DEFAULT_CHANNELS;
  }
  // An Energy monitor (or an unknown one): consumption only.
  return { consumption: DEFAULT_CHANNELS.consumption, production: [] };
}

/**
 * Powers from an `instantaneous` answer: `[{ key: 'phase0ActivePower', value:
 * '123456' }, ...]`, in milliwatts.
 * @returns {{ consumption: number|null, production: number|null }} W
 */
export function instantaneousPowers(answer, channels) {
  if (!Array.isArray(answer)) {
    return { consumption: null, production: null };
  }
  const byInput = new Map();
  for (const item of answer) {
    const match = /^phase(\d+)ActivePower$/.exec(item?.key ?? '');
    const value = num(item?.value);
    if (match && value !== null) {
      byInput.set(Number(match[1]), value);
    }
  }
  const sum = (inputs) => {
    if (inputs.length === 0) {
      return null;
    }
    const values = inputs.map((ct) => byInput.get(ct)).filter((value) => value !== undefined);
    return values.length === 0 ? null : Math.round(values.reduce((a, b) => a + b, 0) / 1000);
  };
  const production = sum(channels.production);
  return {
    consumption: sum(channels.consumption),
    // A solar clamp reads a small negative power at night: no production.
    production: production === null ? null : Math.abs(production),
  };
}

/** The serial number in an `advancedConfigPublic` answer (`mdnsHostName`). */
export function serialFromAdvancedConfig(answer) {
  if (!Array.isArray(answer)) {
    return null;
  }
  const entry = answer.find((item) => item?.key === 'mdnsHostName');
  return normalizeSerial(entry?.value);
}

/**
 * Plugs and switches in a `commandControlPublic` answer.
 * @returns {{ id: string, name: string, kind: 'plug'|'switch', on: boolean|null, connected: boolean|null }[]}
 */
export function httpActuators(answer) {
  if (!Array.isArray(answer)) {
    return [];
  }
  const result = [];
  for (const item of answer) {
    const kind = { 2: 'plug', 3: 'switch' }[String(item?.type)];
    const id = String(item?.key ?? '');
    if (!kind || !/^\d{1,9}$/.test(id)) {
      continue;
    }
    result.push({
      id,
      name: typeof item.value === 'string' && item.value.trim() ? item.value.trim() : null,
      kind,
      on: typeof item.relayStatus === 'boolean' ? item.relayStatus : null,
      connected:
        typeof item.connectionStatus === 'string'
          ? item.connectionStatus.toUpperCase() === 'CONNECTED'
          : null,
    });
  }
  return result;
}

// --- Local MQTT broker (Smappee Infinity, Genius, Connect) ------------------------

/**
 * `servicelocation/<uuid>/<rest>` -> `{ uuid, rest }`, or null.
 */
export function splitTopic(topic) {
  const match = /^servicelocation\/([^/]+)\/(.+)$/.exec(topic ?? '');
  return match ? { uuid: match[1], rest: match[2] } : null;
}

/** `config`: serial number, service location, firmware. */
export function mqttConfig(payload) {
  return {
    serial: normalizeSerial(payload?.serialNumber),
    uuid: typeof payload?.serviceLocationUuid === 'string' ? payload.serviceLocationUuid : null,
    firmware: typeof payload?.firmwareVersion === 'string' ? payload.firmwareVersion : null,
  };
}

/**
 * `channelConfigV2`: which channel (publish index) measures what. As pysmappee
 * reads it: consumption on the grid connection, production on the grid
 * connection (solar), consumption of sub-circuits (one sub-meter per name).
 * @returns {{ grid: number[], solar: number[], submeters: { id: string, name: string, indexes: number[] }[] }}
 */
export function mqttChannels(payload) {
  const result = { grid: [], solar: [], submeters: [] };
  const byName = new Map();
  for (const m of payload?.dataProcessingSpecification?.measurements ?? []) {
    const index = num(m?.publishIndex);
    if (index === null) {
      continue;
    }
    if (m.flow === 'CONSUMPTION' && m.connectionType === 'GRID') {
      result.grid.push(index);
    } else if (m.flow === 'PRODUCTION' && m.connectionType === 'GRID') {
      result.solar.push(index);
    } else if (m.flow === 'CONSUMPTION' && m.connectionType === 'SUBMETER') {
      const name = typeof m.name === 'string' && m.name.trim() ? m.name.trim() : null;
      const key = name ?? `#${index}`;
      const entry = byName.get(key) ?? { name, indexes: [] };
      entry.indexes.push(index);
      byName.set(key, entry);
    }
  }
  for (const entry of byName.values()) {
    const indexes = [...new Set(entry.indexes)].sort((a, b) => a - b);
    // The lowest channel identifies the sub-meter (pysmappee does the same).
    result.submeters.push({ id: String(indexes[0]), name: entry.name, indexes });
  }
  result.grid = [...new Set(result.grid)];
  result.solar = [...new Set(result.solar)];
  return result;
}

/**
 * `realtime`, about once a second: total power, voltages, and the power and
 * current (in tenths of an ampere) of every channel.
 * @returns {{ total: number|null, voltages: number[], channels: Map<number, { power: number, current: number|null }> }}
 */
export function mqttRealtime(payload) {
  const channels = new Map();
  for (const channel of payload?.channelPowers ?? []) {
    const index = num(channel?.publishIndex);
    const power = num(channel?.power);
    if (index === null || power === null) {
      continue;
    }
    const current = num(channel.current);
    channels.set(index, { power, current: current === null ? null : current / 10 });
  }
  const voltages = [];
  for (const entry of payload?.voltages ?? []) {
    const voltage = num(entry?.voltage);
    if (voltage !== null) {
      voltages.push(voltage);
    }
  }
  return { total: num(payload?.totalPower), voltages: voltages.slice(0, 3), channels };
}

/**
 * `homeControlConfig`: Smappee Switches (serials 4006...) and Comfort Plugs.
 */
export function mqttActuators(payload) {
  const result = [];
  for (const item of payload?.switchActuators ?? []) {
    const id = String(item?.nodeId ?? '');
    if (/^\d{1,9}$/.test(id) && String(item.serialNumber ?? '').startsWith('4006')) {
      result.push({ id, name: cleanName(item.name), kind: 'switch', on: null, connected: null });
    }
  }
  for (const item of payload?.smartplugActuators ?? []) {
    const id = String(item?.nodeId ?? '');
    if (/^\d{1,9}$/.test(id)) {
      result.push({ id, name: cleanName(item.name), kind: 'plug', on: null, connected: null });
    }
  }
  return result;
}

const cleanName = (value) => (typeof value === 'string' && value.trim() ? value.trim() : null);

// --- Cloud API -----------------------------------------------------------------------

/**
 * Plugs, switches and output modules of a `meteringconfiguration` that can be
 * turned on and off (states ON_ON and OFF_OFF).
 */
export function cloudActuators(config) {
  const result = [];
  for (const item of config?.actuators ?? []) {
    const id = String(item?.id ?? '');
    const states = (item?.states ?? []).map((state) => state?.id);
    if (!/^\d{1,9}$/.test(id) || !states.includes('ON_ON') || !states.includes('OFF_OFF')) {
      continue;
    }
    result.push({
      id,
      name: cleanName(item.name),
      kind: item.type === 'COMFORT_PLUG' ? 'plug' : 'switch',
      on: null,
      connected: null,
    });
  }
  return result;
}

/**
 * The chargers of the charging stations of a `meteringconfiguration`. The
 * sessions are asked by station serial (`62...`) and answered with the charger
 * serial (`58...`), neither of which is the monitor serial of the site.
 */
export function cloudChargers(config) {
  const result = [];
  for (const station of config?.chargingStations ?? []) {
    const stationSerial = normalizeSerial(station?.serialNumber);
    const chargers = station?.chargers ?? station?.mainDevices?.flatMap((d) => d?.chargers ?? []);
    for (const charger of chargers ?? []) {
      const id = normalizeSerial(charger?.serialNumber);
      if (!stationSerial || !id) {
        continue;
      }
      const channels = charger.channels ?? [];
      result.push({
        id,
        station: stationSerial,
        position: num(charger.position),
        name: cleanName(channels[0]?.name),
        channels: channels
          .map((channel) => num(channel?.consumptionIndex))
          .filter((n) => n !== null),
      });
    }
  }
  return result;
}

// The values of the core (CHARGING_STATION_CONNECTOR_STATUS and _CHARGING_STATE
// in server/utils/constants.js), which the SDK does not export.
export const CONNECTOR_STATUS = { AVAILABLE: 0, OCCUPIED: 1 };
export const CHARGING_STATE = { CHARGING: 0, EV_CONNECTED: 1, PAUSED_BY_CHARGER: 3, IDLE: 4 };

// The API documents milliseconds and answers `from` and `to` in seconds: both are read.
const sessionTime = (value) => {
  const n = num(value);
  return n === null ? null : n < 1e11 ? n * 1000 : n;
};

/** The sessions of one charger in an answer of `sessions`, oldest first. */
export function cloudSessions(answer, charger) {
  return (Array.isArray(answer) ? answer : [])
    .filter((session) => {
      const serial = normalizeSerial(session?.serialNumber);
      return serial ? serial === charger.id : num(session?.connector) === charger.position;
    })
    .map((session) => {
      const start = num(session.startReading);
      const stop = num(session.stopReading);
      // A session under way says `energy: 0` and has no `stopReading` until it stops.
      const energy = num(session.energy);
      return {
        from: sessionTime(session.from),
        to: sessionTime(session.to),
        status: String(session.status ?? '').toUpperCase(),
        stop,
        energy: energy > 0 ? energy : start !== null && stop !== null ? stop - start : null,
      };
    })
    .filter((session) => session.from !== null)
    .sort((a, b) => a.from - b.from);
}

/**
 * The energy of some channels since a time, in kWh, from a `consumption` answer
 * (`active`: Wh per block and per channel). Null when it has no channel data.
 */
export function cloudChannelEnergy(answer, channels, from) {
  const blocks = cloudBlocks(answer).filter((block) => block.active.length > 0);
  if (blocks.length === 0) {
    return null;
  }
  let wh = 0;
  for (const block of blocks) {
    if (block.at + 5 * 60_000 > from) {
      wh += channels.reduce((sum, index) => sum + Math.max(block.active[index] ?? 0, 0), 0);
    }
  }
  return wh / 1000;
}

function chargingStateOf(status) {
  switch (status) {
    case 'CHARGING':
      return CHARGING_STATE.CHARGING;
    case 'SUSPENDED':
      return CHARGING_STATE.PAUSED_BY_CHARGER;
    // Still in the active list: the charge is over, the vehicle has not left.
    case 'STOPPED':
      return CHARGING_STATE.IDLE;
    default:
      return CHARGING_STATE.EV_CONNECTED;
  }
}

/**
 * What a charger shows, from its previous state and the sessions just read.
 * A session in the active list means a connected vehicle (not `chargingState`
 * of the smart devices, seen at STARTED with no vehicle). The total is the
 * meter read at the stop of the sessions, so it never goes down.
 */
export function chargerSession(previous, finished, active, now = Date.now()) {
  const state = { ...previous };
  const current = active[active.length - 1] ?? null;
  state.connector = current ? CONNECTOR_STATUS.OCCUPIED : CONNECTOR_STATUS.AVAILABLE;
  state.charging = current ? chargingStateOf(current.status) : CHARGING_STATE.IDLE;
  for (const session of finished) {
    state.lastFrom = Math.max(state.lastFrom ?? 0, session.from);
  }
  for (const session of [...finished, ...active]) {
    if (session.stop !== null) {
      state.total = Math.max(state.total ?? 0, session.stop);
    }
  }
  const last = current ?? finished[finished.length - 1] ?? null;
  if (last) {
    if (last.energy !== null) {
      state.energy = last.energy;
    }
    const end = last === current ? (last.to ?? now) : last.to;
    if (end !== null && end >= last.from) {
      state.minutes = (end - last.from) / 60_000;
    }
  }
  return state;
}

/** True when the metering configuration has a production (solar) measurement. */
export function cloudHasSolar(config) {
  return (config?.measurements ?? []).some((m) => m?.type === 'PRODUCTION');
}

/**
 * The 5-minute blocks of a `consumption` answer, oldest first, energies in Wh:
 * `[{ at, consumption, solar }]`.
 */
export function cloudBlocks(answer) {
  return (answer?.consumptions ?? [])
    .map((block) => ({
      at: num(block?.timestamp),
      consumption: num(block?.consumption),
      solar: num(block?.solar),
      active: Array.isArray(block?.active) ? block.active.map(num) : [],
    }))
    .filter((block) => block.at !== null && block.consumption !== null)
    .sort((a, b) => a.at - b.at);
}

/** An actuator state as the cloud writes it (`"ON_ON"`, with or without quotes). */
export function cloudState(text) {
  const value = String(text ?? '')
    .replace(/"/g, '')
    .trim()
    .toUpperCase();
  if (value.startsWith('ON')) {
    return true;
  }
  if (value.startsWith('OFF')) {
    return false;
  }
  return null;
}
