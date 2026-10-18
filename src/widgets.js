// -----------------------------------------------------------------------------
// Dashboard widget (manifest `widgets`, Gladys 5.1+): `energy_flow`, the energy
// flow of one Smappee site: home consumption, and with solar panels the
// production, the grid exchange as one signed gauge (import to the right,
// export to the left) and the share of the production used at home.
//
// Budget (8 components, 2 texts): a gauge, up to four tiles, a status list.
// The tiles are bound to the features once the device exists in Gladys, so
// they follow the states live; the gauge and the computed share are refreshed
// by the hub (at most every 10 s) and by the TTL.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { deviceIds, deviceName, deviceValues } from './devices.js';
import { WIDGET_KEY } from './hub.js';

const GAUGE_MIN_RANGE_W = 3000;

export const TEXT = {
  noMonitor: {
    en: 'No Smappee monitor yet: check the configuration of the integration.',
    fr: "Aucun Smappee pour l'instant : vérifiez la configuration de l'intégration.",
    de: 'Noch kein Smappee: Prüfe die Konfiguration der Integration.',
    es: 'Todavía no hay ningún Smappee: compruebe la configuración de la integración.',
  },
  notMonitor: {
    en: 'The device chosen in the settings is not a Smappee monitor.',
    fr: "L'appareil choisi dans les réglages n'est pas un Smappee.",
    de: 'Das in den Einstellungen gewählte Gerät ist kein Smappee.',
    es: 'El dispositivo elegido en la configuración no es un Smappee.',
  },
  grid: { en: 'Grid', fr: 'Réseau', de: 'Netz', es: 'Red' },
  home: { en: 'Home', fr: 'Maison', de: 'Haus', es: 'Casa' },
  solar: { en: 'Solar', fr: 'Solaire', de: 'Solar', es: 'Solar' },
  imported: { en: 'Import', fr: 'Soutirage', de: 'Bezug', es: 'Importación' },
  exported: { en: 'Export', fr: 'Injection', de: 'Einspeisung', es: 'Exportación' },
  selfUse: { en: 'Self-use', fr: 'Autoconsommation', de: 'Eigenverbrauch', es: 'Autoconsumo' },
  monitor: { en: 'Monitor', fr: 'Boîtier', de: 'Messgerät', es: 'Monitor' },
  local: { en: 'local', fr: 'local', de: 'lokal', es: 'local' },
  cloud: { en: 'cloud', fr: 'cloud', de: 'Cloud', es: 'nube' },
  offline: { en: 'offline', fr: 'hors ligne', de: 'offline', es: 'sin conexión' },
};

const t = (text, language) => text[language] ?? text.en;

function monitorOf(hub, settings) {
  if (settings?.device) {
    return hub.resolveDevice(settings.device);
  }
  return hub.monitors()[0] ?? null;
}

/**
 * The widget content.
 * @param {object} hub
 * @param {object} request `{ settings, language }`
 */
export function energyFlow(hub, { settings, language = 'en' } = {}) {
  const monitor = monitorOf(hub, settings);
  if (!monitor || monitor.kind !== 'monitor') {
    return {
      ttl_seconds: 60,
      components: [
        {
          type: 'text',
          variant: 'body',
          text: t(monitor ? TEXT.notMonitor : TEXT.noMonitor, language),
        },
      ],
    };
  }
  const values = deviceValues(monitor);
  const solar = monitor.keys.includes('solar-power');
  const ids = deviceIds(hub.gladys, monitor);
  const created = hub.isCreated(monitor);
  const tile = (key, label, icon, color) => {
    const component = { type: 'value', label: t(label, language), icon };
    if (color) {
      component.color = color;
    }
    // Bound to the feature once the device exists in Gladys: live.
    if (created) {
      return { ...component, device_feature: ids.feature(key) };
    }
    return { ...component, value: values[key] ?? '-', unit: 'W' };
  };
  const components = [];
  if (solar && typeof values['import-power'] === 'number') {
    const net = Math.round(values['import-power'] - values['export-power']);
    const range = Math.max(GAUGE_MIN_RANGE_W, Math.ceil(Math.abs(net) / 1000) * 1000);
    components.push({
      type: 'gauge',
      label: t(TEXT.grid, language),
      value: net,
      // Signed: symmetric bounds, the needle stands up at 0 W.
      min: -range,
      max: range,
      unit: 'W',
      color: net < 0 ? WIDGET_COLORS.SUCCESS : WIDGET_COLORS.WARNING,
    });
  }
  components.push(tile('power', TEXT.home, 'home'));
  if (solar) {
    components.push(
      tile('solar-power', TEXT.solar, 'sun', WIDGET_COLORS.SUCCESS),
      tile('import-power', TEXT.imported, 'download'),
      tile('export-power', TEXT.exported, 'upload'),
    );
  }
  const items = [];
  const production = values['solar-power'];
  if (solar && typeof production === 'number' && production > 0) {
    const used = Math.min(Math.max(production - (values['export-power'] ?? 0), 0), production);
    items.push({
      label: t(TEXT.selfUse, language),
      value: `${Math.round((used / production) * 100)} %`,
      icon: 'percent',
    });
  }
  items.push({
    label: deviceName(monitor).slice(0, 40) || t(TEXT.monitor, language),
    value: t(
      monitor.reachable ? (monitor.access === 'cloud' ? TEXT.cloud : TEXT.local) : TEXT.offline,
      language,
    ),
    color: monitor.reachable ? WIDGET_COLORS.SUCCESS : WIDGET_COLORS.DANGER,
  });
  components.push({ type: 'status', items });
  return { ttl_seconds: monitor.access === 'cloud' ? 300 : 15, components };
}

export const WIDGETS = {
  [WIDGET_KEY]: {
    get: (hub, request) => energyFlow(hub, request),
  },
};
