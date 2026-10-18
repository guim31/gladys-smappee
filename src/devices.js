// -----------------------------------------------------------------------------
// From a Smappee monitor, sub-meter or actuator to a Gladys device: the
// features, their names in four languages, and the values to publish.
//
// Three kinds of Gladys devices, keyed on the serial number of the monitor
// (the same whether it is read locally or through the cloud):
//   - `monitor`: the site. What the grid delivers is what the energy tab of
//     Gladys 5.2 turns into consumption and cost (`energy-sensor/power` and
//     `energy-sensor/index`): the home consumption without solar panels, the
//     grid import with them. With solar panels, the home consumption goes to
//     `home-output-sensor/*` (shown, never costed), the production to
//     `energy-production-sensor/*`, the export to `grid-sensor/output-*`.
//     Plus the phase voltages read by the local MQTT broker;
//   - `submeter`: one per sub-circuit (CT clamps) of an Infinity / Genius;
//   - `actuator`: one per Smappee Switch, Comfort Plug or output module.
//
// The monitors do not give energy counters over their local API: the indexes
// are the power integrated by the integration (kept in /data), or the sum of
// the 5-minute cloud aggregates. Feature keys are part of the external ids:
// permanent.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as CATEGORIES,
  DEVICE_FEATURE_TYPES as TYPES,
  DEVICE_FEATURE_UNITS as UNITS,
} from '@gladysassistant/integration-sdk';
import { modelOf } from './smappee/model.js';

export const DEVICE_TYPES = { monitor: 'monitor', submeter: 'submeter', actuator: 'actuator' };

// Names: frozen in Gladys when the user creates the device, written in the
// language chosen in the configuration at that moment. `{n}` is a number.
export const NAMES = {
  en: {
    power: 'Consumption',
    energy: 'Consumption index',
    'solar-power': 'Solar production',
    'solar-energy': 'Solar production index',
    'import-power': 'Grid import',
    'export-power': 'Grid export',
    'import-energy': 'Grid import index',
    'export-energy': 'Grid export index',
    voltage: 'Voltage L{n}',
    'sub-power': 'Power',
    'sub-energy': 'Energy index',
    current: 'Current',
    switch: 'On/Off',
    submeter: 'Smappee sub-meter {n}',
    plug: 'Smappee plug {n}',
  },
  fr: {
    power: 'Consommation',
    energy: 'Index de consommation',
    'solar-power': 'Production solaire',
    'solar-energy': 'Index de production solaire',
    'import-power': 'Soutirage réseau',
    'export-power': 'Injection réseau',
    'import-energy': 'Index de soutirage',
    'export-energy': "Index d'injection",
    voltage: 'Tension L{n}',
    'sub-power': 'Puissance',
    'sub-energy': "Index d'énergie",
    current: 'Courant',
    switch: 'Marche/Arrêt',
    submeter: 'Sous-compteur Smappee {n}',
    plug: 'Prise Smappee {n}',
  },
  de: {
    power: 'Verbrauch',
    energy: 'Verbrauchszähler',
    'solar-power': 'Solarproduktion',
    'solar-energy': 'Solarproduktionszähler',
    'import-power': 'Netzbezug',
    'export-power': 'Netzeinspeisung',
    'import-energy': 'Bezugszähler',
    'export-energy': 'Einspeisezähler',
    voltage: 'Spannung L{n}',
    'sub-power': 'Leistung',
    'sub-energy': 'Energiezähler',
    current: 'Strom',
    switch: 'Ein/Aus',
    submeter: 'Smappee-Unterzähler {n}',
    plug: 'Smappee-Steckdose {n}',
  },
  es: {
    power: 'Consumo',
    energy: 'Índice de consumo',
    'solar-power': 'Producción solar',
    'solar-energy': 'Índice de producción solar',
    'import-power': 'Importación de red',
    'export-power': 'Exportación a red',
    'import-energy': 'Índice de importación',
    'export-energy': 'Índice de exportación',
    voltage: 'Tensión L{n}',
    'sub-power': 'Potencia',
    'sub-energy': 'Índice de energía',
    current: 'Corriente',
    switch: 'Encendido/Apagado',
    submeter: 'Submedidor Smappee {n}',
    plug: 'Enchufe Smappee {n}',
  },
};

const INDEX_MAX = 10_000_000;
const W = { unit: UNITS.WATT, min: 0, max: 30000, decimals: 0 };
const KWH = { unit: UNITS.KILOWATT_HOUR, min: 0, max: INDEX_MAX, decimals: 3, slow: true };

// Shapes by key. `slow`: published at most once a minute (indexes, voltages,
// currents): nothing needs them faster, and Gladys caps an integration at 300
// states a minute.
const SPECS = {
  monitor: {
    power: { category: CATEGORIES.ENERGY_SENSOR, type: TYPES.ENERGY_SENSOR.POWER, ...W },
    energy: { category: CATEGORIES.ENERGY_SENSOR, type: TYPES.ENERGY_SENSOR.INDEX, ...KWH },
    'solar-power': {
      category: CATEGORIES.ENERGY_PRODUCTION_SENSOR,
      type: TYPES.ENERGY_PRODUCTION_SENSOR.POWER,
      ...W,
    },
    'solar-energy': {
      category: CATEGORIES.ENERGY_PRODUCTION_SENSOR,
      type: TYPES.ENERGY_PRODUCTION_SENSOR.INDEX,
      ...KWH,
    },
    // With solar panels: the grid import is the billed energy, the home use is shown.
    'import-power': { category: CATEGORIES.ENERGY_SENSOR, type: TYPES.ENERGY_SENSOR.POWER, ...W },
    'home-power': {
      category: CATEGORIES.HOME_OUTPUT_SENSOR,
      type: TYPES.HOME_OUTPUT_SENSOR.POWER,
      ...W,
      name: 'power',
    },
    'home-energy': {
      category: CATEGORIES.HOME_OUTPUT_SENSOR,
      type: TYPES.HOME_OUTPUT_SENSOR.INDEX,
      ...KWH,
      name: 'energy',
    },
    'export-power': {
      category: CATEGORIES.GRID_SENSOR,
      type: TYPES.GRID_SENSOR.OUTPUT_POWER,
      ...W,
    },
    'import-energy': {
      category: CATEGORIES.ENERGY_SENSOR,
      type: TYPES.ENERGY_SENSOR.INDEX,
      ...KWH,
    },
    'export-energy': {
      category: CATEGORIES.GRID_SENSOR,
      type: TYPES.GRID_SENSOR.OUTPUT_INDEX,
      ...KWH,
    },
    voltage: {
      category: CATEGORIES.ENERGY_SENSOR,
      type: TYPES.ENERGY_SENSOR.VOLTAGE,
      unit: UNITS.VOLT,
      min: 0,
      max: 400,
      decimals: 1,
      slow: true,
    },
  },
  submeter: {
    power: {
      category: CATEGORIES.ENERGY_SENSOR,
      type: TYPES.ENERGY_SENSOR.POWER,
      ...W,
      name: 'sub-power',
    },
    energy: {
      category: CATEGORIES.ENERGY_SENSOR,
      type: TYPES.ENERGY_SENSOR.INDEX,
      ...KWH,
      name: 'sub-energy',
    },
    current: {
      category: CATEGORIES.ENERGY_SENSOR,
      type: TYPES.ENERGY_SENSOR.CURRENT,
      unit: UNITS.AMPERE,
      min: 0,
      max: 100,
      decimals: 1,
      slow: true,
    },
  },
  actuator: {
    switch: {
      category: CATEGORIES.SWITCH,
      type: TYPES.SWITCH.BINARY,
      min: 0,
      max: 1,
      decimals: 0,
      writable: true,
    },
  },
};

const baseKey = (key) => key.replace(/-l\d$/, '');

export function specOf(kind, key) {
  return SPECS[kind]?.[baseKey(key)] ?? null;
}

/** The keys of a monitor, in display order. */
export function monitorKeys({ solar, phases = 0 }) {
  // Never both sets on one monitor: the two energy-sensor indexes would be costed twice.
  const keys = solar
    ? [
        'import-power',
        'import-energy',
        'home-power',
        'home-energy',
        'solar-power',
        'solar-energy',
        'export-power',
        'export-energy',
      ]
    : ['power', 'energy'];
  for (let n = 1; n <= Math.min(phases, 3); n += 1) {
    keys.push(`voltage-l${n}`);
  }
  return keys;
}

export const SUBMETER_KEYS = ['power', 'energy', 'current'];
export const ACTUATOR_KEYS = ['switch'];

/** The platform id of a record: the monitor serial, plus the channel or node. */
export function platformId(record) {
  return record.kind === 'monitor' ? record.serial : `${record.serial}-${record.id}`;
}

export function deviceIds(gladys, record) {
  return gladys.externalIds(DEVICE_TYPES[record.kind], platformId(record));
}

const fill = (template, n) => template.replace('{n}', String(n));

/** The device name: the model and serial, or the name given in the Smappee app. */
export function deviceName(record, language = 'en') {
  const names = NAMES[language] ?? NAMES.en;
  switch (record.kind) {
    case 'monitor':
      return `${modelOf(record.serial)} ${record.serial}`;
    case 'submeter':
      return record.name ?? fill(names.submeter, Number(record.id) + 1);
    default:
      return record.name ?? fill(names.plug, record.id);
  }
}

function featureName(kind, key, language) {
  const names = NAMES[language] ?? NAMES.en;
  const spec = specOf(kind, key);
  const phase = /-l(\d)$/.exec(key);
  return fill(names[spec.name ?? baseKey(key)], phase ? phase[1] : '');
}

/**
 * The Gladys device of a record (discovery payload).
 * @param {object} gladys
 * @param {object} record hub record
 * @param {object} options `{ language, controls }`
 */
export function buildDevice(gladys, record, { language = 'fr', controls = true } = {}) {
  const ids = deviceIds(gladys, record);
  const params = [{ name: 'SERIAL_NUMBER', value: record.serial }];
  if (record.access) {
    params.push({ name: 'ACCESS', value: record.access });
  }
  if (record.address) {
    params.push({ name: 'IP_ADDRESS', value: record.address });
  }
  if (record.kind === 'actuator') {
    params.push({ name: 'NODE_ID', value: record.id });
  }
  return {
    name: deviceName(record, language),
    external_id: ids.device,
    model: record.kind === 'monitor' ? modelOf(record.serial) : record.kind,
    // The container publishes the readings itself (pushed by MQTT, read every
    // few seconds over HTTP, every 5 minutes from the cloud).
    should_poll: false,
    params,
    features: record.keys
      .filter((key) => specOf(record.kind, key))
      .map((key) => {
        const spec = specOf(record.kind, key);
        // A Comfort Plug (433 MHz) never says its state: no feedback.
        const writable = spec.writable === true && controls;
        const feature = {
          name: featureName(record.kind, key, language),
          external_id: ids.feature(key),
          category: spec.category,
          type: spec.type,
          min: spec.min,
          max: spec.max,
          read_only: !writable,
          has_feedback: writable && record.actuatorKind !== 'plug',
          keep_history: true,
        };
        if (spec.unit) {
          feature.unit = spec.unit;
        }
        return feature;
      }),
  };
}

const num = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null);

function round(value, decimals) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/**
 * The value of every feature key of a record, from its last reading.
 * @returns {Record<string, number>} only the keys with a value
 */
export function deviceValues(record) {
  const values = {};
  const set = (key, value) => {
    const spec = specOf(record.kind, key);
    if (spec && num(value) !== null) {
      values[key] = round(value, spec.decimals);
    }
  };
  const live = record.live ?? {};
  const energy = Object.fromEntries(
    Object.entries(record.meters ?? {}).map(([name, meter]) => [name, meter.kwh]),
  );
  switch (record.kind) {
    case 'monitor': {
      const consumption = num(live.consumption);
      const production = num(live.production);
      const home = consumption === null ? null : Math.max(consumption, 0);
      if (record.keys.includes('solar-power')) {
        set('home-power', home);
        set('home-energy', energy.consumption);
        set('solar-power', production);
        set('solar-energy', energy.production);
        if (consumption !== null && production !== null) {
          const net = consumption - production;
          set('import-power', Math.max(net, 0));
          set('export-power', Math.max(-net, 0));
        }
        set('import-energy', energy.import);
        set('export-energy', energy.export);
      } else {
        set('power', home);
        set('energy', energy.consumption);
      }
      (live.voltages ?? []).forEach((voltage, index) => set(`voltage-l${index + 1}`, voltage));
      break;
    }
    case 'submeter':
      set('power', num(live.power) === null ? null : Math.abs(live.power));
      set('energy', energy.consumption);
      set('current', num(live.current) === null ? null : Math.abs(live.current));
      break;
    default:
      if (typeof record.on === 'boolean') {
        values.switch = record.on ? 1 : 0;
      }
  }
  return values;
}

export function isSlow(kind, key) {
  return specOf(kind, key)?.slow === true;
}
