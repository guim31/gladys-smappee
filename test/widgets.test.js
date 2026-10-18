// -----------------------------------------------------------------------------
// The `energy_flow` widget, checked against the SDK's own validator and the
// features of the devices it links to.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { HTTP_SERIAL, createAll, createWorld, ids } from './helpers/world.js';

async function content(world, options) {
  const ack = await world.fake.widgetGet('energy_flow', options);
  assert.equal(ack.success, true, ack.error);
  validateWidgetContent(ack.data.content);
  return ack.data.content;
}

test('without a monitor, the widget says what to do', async (t) => {
  const world = await createWorld();
  t.after(() => world.stop());
  const { components } = await content(world, { language: 'fr' });
  assert.match(components[0].text, /Aucun Smappee/);
});

test('a solar site: gauge, live tiles bound to the features, self-use', async (t) => {
  const world = await createWorld({ http: true });
  t.after(() => world.stop());
  // Before creation: values.
  let widget = await content(world, { language: 'en' });
  assert.equal(widget.components.find((c) => c.label === 'Home').value, 1850);
  await createAll(world);
  widget = await content(world, { language: 'de' });
  const gauge = widget.components[0];
  assert.equal(gauge.type, 'gauge');
  assert.equal(gauge.value, 450);
  assert.equal(gauge.min, -gauge.max);
  const features = world.fake.discoveredDevices.flatMap((d) =>
    d.features.map((f) => f.external_id),
  );
  for (const tile of widget.components.filter((c) => c.device_feature)) {
    assert.ok(features.includes(tile.device_feature), tile.label);
  }
  assert.equal(
    widget.components.find((c) => c.label === 'Haus').device_feature,
    ids(world.gladys, 'monitor', HTTP_SERIAL).feature('power'),
  );
  const status = widget.components.find((c) => c.type === 'status');
  // 1400 W produced, nothing exported: all used at home.
  assert.deepEqual(status.items[0], { label: 'Eigenverbrauch', value: '100 %', icon: 'percent' });
  assert.equal(status.items[1].value, 'lokal');
});

test('a device that is not a monitor is refused', async (t) => {
  const world = await createWorld({ http: true });
  t.after(() => world.stop());
  const plug = ids(world.gladys, 'actuator', `${HTTP_SERIAL}-1`).device;
  const { components } = await content(world, { settings: { device: plug }, language: 'es' });
  assert.match(components[0].text, /no es un Smappee/);
});
