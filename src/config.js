// -----------------------------------------------------------------------------
// Integration configuration: defaults (they mirror the `default` values of the
// manifest `config_schema`, see test/manifest.test.js) and normalization, so
// the rest of the code never deals with strings, blanks or `undefined`.
// -----------------------------------------------------------------------------

export const LANGUAGES = ['en', 'fr', 'de', 'es'];

// Seconds between two publications of the local readings (`poll_interval`).
export const POLL_INTERVALS = [5, 10, 30, 60];

// The factory password of the local web interface of every Smappee monitor.
export const DEFAULT_LOCAL_PASSWORD = 'admin';

export const DEFAULT_CONFIG = {
  hosts: '',
  local_password: '',
  cloud_client_id: '',
  cloud_client_secret: '',
  cloud_username: '',
  cloud_password: '',
  poll_interval: '10',
  controls: true,
  language: 'fr',
};

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
// A host name of the LAN (`smappee1006000212.local`, `smappee.lan`).
const HOST_NAME =
  /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?)*$/i;
const MAX_HOSTS = 16;

/**
 * Parse the address list (commas, semicolons, spaces or new lines): IPv4
 * addresses or host names, no port, no scheme.
 * @param {unknown} raw
 * @returns {{ hosts: string[], invalid: string[] }}
 */
export function parseHosts(raw) {
  const hosts = [];
  const invalid = [];
  const entries = typeof raw === 'string' ? raw.split(/[\s,;]+/) : [];
  for (const entry of entries) {
    // Forgive a pasted URL: http://192.168.1.20/smappee.html -> 192.168.1.20
    const host = entry
      .trim()
      .replace(/^https?:\/\//i, '')
      .replace(/\/.*$/, '');
    if (!host) {
      continue;
    }
    const match = host.match(IPV4);
    let normalized = null;
    if (match) {
      if (match.slice(1).every((part) => Number(part) <= 255)) {
        normalized = match.slice(1).map(Number).join('.');
      }
    } else if (HOST_NAME.test(host) && !/^\d+$/.test(host.replace(/\./g, ''))) {
      normalized = host.toLowerCase();
    }
    if (normalized === null) {
      invalid.push(entry.trim().slice(0, 64));
    } else if (!hosts.includes(normalized) && hosts.length < MAX_HOSTS) {
      hosts.push(normalized);
    }
  }
  return { hosts, invalid };
}

const text = (value) => (typeof value === 'string' ? value.trim() : '');

/**
 * @param {Record<string, unknown>} raw the configuration returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const { hosts, invalid } = parseHosts(source.hosts ?? DEFAULT_CONFIG.hosts);
  const interval = Number(source.poll_interval ?? DEFAULT_CONFIG.poll_interval);
  const cloud = {
    clientId: text(source.cloud_client_id),
    clientSecret: text(source.cloud_client_secret),
    username: text(source.cloud_username),
    // A password may start or end with a space: kept as typed.
    password: typeof source.cloud_password === 'string' ? source.cloud_password : '',
  };
  const cloudFields = Object.values(cloud).filter((value) => value !== '').length;
  return {
    hosts,
    invalidHosts: invalid,
    // The local web interface password; empty means the factory one.
    localPassword:
      typeof source.local_password === 'string' && source.local_password !== ''
        ? source.local_password
        : DEFAULT_LOCAL_PASSWORD,
    // The cloud is used only when the four fields are filled in.
    cloud: cloudFields === 4 ? cloud : null,
    cloudIncomplete: cloudFields > 0 && cloudFields < 4,
    pollSeconds: POLL_INTERVALS.includes(interval)
      ? interval
      : Number(DEFAULT_CONFIG.poll_interval),
    // Booleans may come back as strings from older cores.
    controls:
      source.controls === undefined
        ? true
        : source.controls !== false && source.controls !== 'false',
    language: LANGUAGES.includes(source.language) ? source.language : DEFAULT_CONFIG.language,
  };
}
