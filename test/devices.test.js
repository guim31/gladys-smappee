// -----------------------------------------------------------------------------
// buildDevice and the `monitor_energy_tab` option: which indexes of a monitor
// the energy tab of Gladys costs, without ever changing a key or an external id.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { CHARGER_ENERGY_KEY, CHARGER_KEYS, buildDevice, monitorKeys } from '../src/devices.js';
import { normalizeConfig } from '../src/config.js';

const gladys = createFakeGladys({ config: {} });

const monitor = (solar) => ({
  kind: 'monitor',
  serial: solar ? '1105000101' : '1005000202',
  access: 'http',
  address: '127.0.0.2',
  keys: monitorKeys({ solar, phases: 0 }),
});
const submeter = {
  kind: 'submeter',
  serial: '5010000101',
  id: '4',
  access: 'mqtt',
  keys: ['power', 'energy', 'current'],
};
const charger = {
  kind: 'charger',
  serial: '1005000202',
  id: '5820000001',
  access: 'cloud',
  keys: [...CHARGER_KEYS, CHARGER_ENERGY_KEY],
};

/** key -> "category/type" of every feature of a device. */
function shapes(device) {
  return Object.fromEntries(
    device.features.map((feature) => [
      feature.external_id.split(':').at(-1),
      `${feature.category}/${feature.type}`,
    ]),
  );
}

// The shapes of 1.2.0, which the default must keep.
const SOLAR_1_2_0 = {
  'import-power': 'energy-sensor/power',
  'import-energy': 'energy-sensor/index',
  'home-power': 'home-output-sensor/power',
  'home-energy': 'home-output-sensor/index',
  'solar-power': 'energy-production-sensor/power',
  'solar-energy': 'energy-production-sensor/index',
  'export-power': 'grid-sensor/output-power',
  'export-energy': 'grid-sensor/output-index',
};
const PLAIN_1_2_0 = { power: 'energy-sensor/power', energy: 'energy-sensor/index' };

test('by default, the monitors keep the categories and types of 1.2.0', () => {
  assert.equal(normalizeConfig({}).monitorEnergyTab, true);
  const options = { monitorEnergyTab: normalizeConfig({}).monitorEnergyTab };
  assert.deepEqual(shapes(buildDevice(gladys, monitor(true), options)), SOLAR_1_2_0);
  assert.deepEqual(shapes(buildDevice(gladys, monitor(false), options)), PLAIN_1_2_0);
  assert.deepEqual(shapes(buildDevice(gladys, monitor(true))), SOLAR_1_2_0);
});

test('option off: the whole-home indexes are grid-sensor/input-index, same external ids', () => {
  for (const solar of [true, false]) {
    const on = buildDevice(gladys, monitor(solar), { monitorEnergyTab: true });
    const off = buildDevice(gladys, monitor(solar), { monitorEnergyTab: false });
    const key = solar ? 'import-energy' : 'energy';
    assert.deepEqual(shapes(off), {
      ...(solar ? SOLAR_1_2_0 : PLAIN_1_2_0),
      [key]: 'grid-sensor/input-index',
    });
    // Same keys, same external ids, same names, units and bounds: only the kind moves.
    const rest = (device) =>
      device.features.map((feature) => {
        const copy = { ...feature };
        delete copy.category;
        delete copy.type;
        return copy;
      });
    assert.deepEqual(rest(off), rest(on));
    assert.equal(off.external_id, on.external_id);
    // Nothing left for the core to derive a consumption from.
    assert.ok(!off.features.some((f) => f.category === 'energy-sensor' && f.type === 'index'));
  }
});

test('option off: the sub-meters and the chargers do not change', () => {
  for (const record of [submeter, charger]) {
    assert.deepEqual(
      buildDevice(gladys, record, { monitorEnergyTab: false }),
      buildDevice(gladys, record, { monitorEnergyTab: true }),
    );
  }
  const off = shapes(buildDevice(gladys, charger, { monitorEnergyTab: false }));
  assert.equal(off[CHARGER_ENERGY_KEY], 'energy-sensor/index');
  assert.equal(
    shapes(buildDevice(gladys, submeter, { monitorEnergyTab: false })).energy,
    'energy-sensor/index',
  );
});

test('monitor_energy_tab: a boolean, also as a string from older cores', () => {
  assert.equal(normalizeConfig({ monitor_energy_tab: false }).monitorEnergyTab, false);
  assert.equal(normalizeConfig({ monitor_energy_tab: 'false' }).monitorEnergyTab, false);
  assert.equal(normalizeConfig({ monitor_energy_tab: 'true' }).monitorEnergyTab, true);
  assert.equal(normalizeConfig({ monitor_energy_tab: null }).monitorEnergyTab, true);
});
