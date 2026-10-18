// -----------------------------------------------------------------------------
// Energy indexes from power readings. The local APIs of the Smappee monitors
// give powers, not counters: the integration adds up power x time
// (trapezoids) into kWh indexes kept in /data. A gap longer than MAX_GAP_MS
// (the container stopped, the monitor silent) is not filled: the energy of
// that time is lost rather than guessed, and the index never goes down.
// -----------------------------------------------------------------------------

export const MAX_GAP_MS = 3 * 60_000;

/**
 * Add the energy of one more power reading to an index.
 * @param {{ kwh: number, at: number|null, watts: number|null }} meter mutated
 * @param {number|null} watts power now (W, >= 0), null when unknown
 * @param {number} at time of the reading (ms)
 */
export function accumulate(meter, watts, at) {
  if (typeof watts !== 'number' || !Number.isFinite(watts)) {
    meter.at = null;
    meter.watts = null;
    return;
  }
  const power = Math.max(watts, 0);
  if (meter.at !== null && typeof meter.watts === 'number') {
    const elapsed = at - meter.at;
    if (elapsed > 0 && elapsed <= MAX_GAP_MS) {
      // W x h = Wh; / 1000 = kWh.
      meter.kwh += (((meter.watts + power) / 2) * (elapsed / 3_600_000)) / 1000;
    }
  }
  if (meter.at === null || at > meter.at) {
    meter.at = at;
    meter.watts = power;
  }
}

/** A new meter, or one restored from /data (its index only). */
export function createMeter(kwh = 0) {
  return {
    kwh: typeof kwh === 'number' && Number.isFinite(kwh) && kwh >= 0 ? kwh : 0,
    at: null,
    watts: null,
  };
}
