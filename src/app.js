// -----------------------------------------------------------------------------
// Registers every SDK handler on a GladysIntegration (or the SDK's fake) and
// returns the hub, so index.js stays a few lines and the tests drive the very
// same wiring.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { normalizeConfig } from './config.js';
import { SmappeeHub } from './hub.js';
import { Store } from './store.js';
import { INIT_FAILED, searchMessage } from './texts.js';
import { WIDGETS } from './widgets.js';

const logger = createLogger({ name: 'smappee-app' });

/**
 * @param {object} gladys GladysIntegration instance
 * @param {object} [options] test seams: store, timers, timings, network
 */
export function registerHandlers(gladys, options = {}) {
  const hub = new SmappeeHub({
    gladys,
    store: options.store ?? new Store(),
    timers: options.timers ?? true,
    timings: options.timings,
    network: options.network,
  });

  // Resolved once the hub has started; every handler waits for it, so a
  // command arriving during the first connection is not lost.
  let resolveReady;
  const ready = new Promise((resolve) => {
    resolveReady = resolve;
  });
  let started = false;
  const whenReady =
    (fn) =>
    async (...args) => {
      await ready;
      return fn(...args);
    };

  gladys.on('connected', async () => {
    try {
      const config = normalizeConfig(await gladys.getConfig());
      if (started) {
        // A reconnection (Gladys restarted): re-sync what Gladys may have lost.
        await hub.resync(config);
        return;
      }
      started = true;
      await hub.start(config);
    } catch (err) {
      logger.error('Initialization failed', err);
      await gladys.setConnectionStatus(false, INIT_FAILED).catch(() => {});
    } finally {
      resolveReady();
    }
  });

  gladys.onScanRequest(whenReady(() => hub.reconnect()));

  gladys.onSetValue(whenReady((device, feature, value) => hub.setValue(device, feature, value)));

  // The devices are published with should_poll: false (the hub's own timer
  // publishes); this only serves a Gladys that would poll anyway.
  gladys.onPoll(whenReady(() => hub.publishRound()));

  gladys.onDeviceCreated(whenReady((device) => hub.onDeviceCreated(device)));

  gladys.onConfigUpdated(
    whenReady(async (newConfig) => {
      await hub.reconfigure(normalizeConfig(newConfig));
    }),
  );

  gladys.onAction(
    'search',
    whenReady(async () => {
      await hub.reconnect();
      await hub.pollLocal();
      await hub.publishTransports();
      await hub.publishConnectionStatus();
      return searchMessage(hub.summary());
    }),
  );

  for (const [key, widget] of Object.entries(WIDGETS)) {
    gladys.onWidgetGet(
      key,
      whenReady((request) => widget.get(hub, request)),
    );
  }

  return {
    hub,
    ready,
    stop: () => hub.stop(),
  };
}
