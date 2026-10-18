// -----------------------------------------------------------------------------
// Client of the official Smappee cloud API (https://app1pub.smappee.net/dev/v3,
// the "production farm" of pysmappee). OAuth2 "password" grant: a client id
// and secret that Smappee gives on request (support), and the user name and
// password of the Smappee account. The access token is refreshed with the
// refresh token, and asked again with the password when that fails.
//
// The cloud data are 5-minute aggregates: the hub reads them every 5 minutes.
// -----------------------------------------------------------------------------

import { SmappeeError } from './http.js';

export const CLOUD_BASE_URL = 'https://app1pub.smappee.net/dev/v3';
const TIMEOUT_MS = 15_000;
// Refresh a little before the expiry the server announces.
const EXPIRY_MARGIN_MS = 60_000;

export class SmappeeCloud {
  /**
   * @param {object} options
   * @param {{ clientId: string, clientSecret: string, username: string, password: string }} options.credentials
   * @param {string} [options.baseUrl]
   */
  constructor({ credentials, baseUrl = CLOUD_BASE_URL, timeoutMs = TIMEOUT_MS }) {
    this.credentials = credentials;
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.timeoutMs = timeoutMs;
    this.token = null;
  }

  async fetch(path, { method = 'GET', headers = {}, body, query } = {}) {
    const url = new URL(`${this.baseUrl}/${path}`);
    for (const [key, value] of Object.entries(query ?? {})) {
      url.searchParams.set(key, String(value));
    }
    try {
      return await fetch(url, {
        method,
        headers,
        body,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      throw new SmappeeError(`The Smappee cloud does not answer (${err.cause?.code ?? err.name})`, {
        kind: 'unreachable',
        cause: err,
      });
    }
  }

  async requestToken(grant) {
    const { clientId, clientSecret } = this.credentials;
    const response = await this.fetch('oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        ...grant,
        client_id: clientId,
        client_secret: clientSecret,
      }).toString(),
    });
    const answer = await response.json().catch(() => ({}));
    if (!response.ok || typeof answer.access_token !== 'string') {
      // 400 {"error":"ClientId not found"}, 401... : the server's words, never the secrets.
      const reason = typeof answer.error === 'string' ? answer.error.slice(0, 80) : '';
      throw new SmappeeError(
        `The Smappee cloud refused the credentials (HTTP ${response.status}${reason ? `: ${reason}` : ''})`,
        { kind: response.status >= 500 ? 'unreachable' : 'unauthorized', status: response.status },
      );
    }
    const expiresIn = Number(answer.expires_in);
    this.token = {
      access: answer.access_token,
      refresh: typeof answer.refresh_token === 'string' ? answer.refresh_token : null,
      expiresAt: Date.now() + (Number.isFinite(expiresIn) ? expiresIn * 1000 : 3600_000),
    };
  }

  async login() {
    const { username, password } = this.credentials;
    await this.requestToken({ grant_type: 'password', username, password });
  }

  async ensureToken() {
    if (this.token && Date.now() < this.token.expiresAt - EXPIRY_MARGIN_MS) {
      return;
    }
    if (this.token?.refresh) {
      try {
        await this.requestToken({ grant_type: 'refresh_token', refresh_token: this.token.refresh });
        return;
      } catch (err) {
        if (err.kind === 'unreachable') {
          throw err;
        }
      }
    }
    await this.login();
  }

  /** An authenticated call; a 401 asks a new token once. */
  async call(path, options = {}, retried = false) {
    await this.ensureToken();
    const response = await this.fetch(path, {
      ...options,
      headers: { ...options.headers, Authorization: `Bearer ${this.token.access}` },
    });
    if (response.status === 401 && !retried) {
      this.token = null;
      return this.call(path, options, true);
    }
    if (!response.ok) {
      throw new SmappeeError(`The Smappee cloud answered HTTP ${response.status} on ${path}`, {
        kind: response.status === 401 || response.status === 403 ? 'unauthorized' : 'invalid',
        status: response.status,
      });
    }
    const text = await response.text();
    try {
      return text === '' ? null : JSON.parse(text);
    } catch {
      // Some answers (actuator state) are plain text.
      return text;
    }
  }

  /** `{ serviceLocations: [{ serviceLocationId, name, deviceSerialNumber }] }` */
  serviceLocations() {
    return this.call('servicelocation');
  }

  meteringConfiguration(locationId) {
    return this.call(`servicelocation/${encodeURIComponent(locationId)}/meteringconfiguration`);
  }

  /** 5-minute blocks (aggregation 1) between two times, in ms. */
  consumption(locationId, from, to) {
    return this.call(`servicelocation/${encodeURIComponent(locationId)}/consumption`, {
      query: { aggregation: 1, from, to },
    });
  }

  actuatorState(locationId, actuatorId) {
    return this.call(
      `servicelocation/${encodeURIComponent(locationId)}/actuator/${encodeURIComponent(actuatorId)}/state`,
    );
  }

  setActuator(locationId, actuatorId, on) {
    return this.call(
      `servicelocation/${encodeURIComponent(locationId)}/actuator/${encodeURIComponent(actuatorId)}/${on ? 'ON_ON' : 'OFF_OFF'}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
    );
  }
}
