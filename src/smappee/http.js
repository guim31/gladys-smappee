// -----------------------------------------------------------------------------
// Client of the local HTTP API of the Smappee Energy, Solar and Pro/Plus
// monitors (`http://<monitor>/gateway/apipublic/<command>`), as pysmappee
// uses it: every call is a POST whose plain-text body is the argument
// (`load`, `loadInstantaneous`, the password for `logon`). Calls answer
// `{ "error": "Error not authenticated. Use Logon first!" }` until a logon
// with the password of the monitor's web interface (`admin` by default).
// -----------------------------------------------------------------------------

export const HTTP_PORT = 80;
const TIMEOUT_MS = 5000;
const NOT_AUTHENTICATED = /not authenticated|logon first/i;

/** An error with a `kind`: `unreachable`, `unauthorized` or `invalid`. */
export class SmappeeError extends Error {
  constructor(message, { kind, status, cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.kind = kind;
    this.status = status;
  }
}

export class SmappeeHttp {
  /**
   * @param {object} options
   * @param {string} options.host
   * @param {number} [options.port]
   * @param {string} options.password
   * @param {number} [options.timeoutMs]
   */
  constructor({ host, port = HTTP_PORT, password, timeoutMs = TIMEOUT_MS }) {
    this.host = host;
    this.port = port;
    this.password = password;
    this.timeoutMs = timeoutMs;
    // The monitor may keep its session in a cookie (pysmappee uses a session).
    this.cookie = null;
  }

  get base() {
    const host = this.host.includes(':') ? `[${this.host}]` : this.host;
    return `http://${host}${this.port === HTTP_PORT ? '' : `:${this.port}`}/gateway/apipublic`;
  }

  async post(command, body) {
    let response;
    try {
      response = await fetch(`${this.base}/${command}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.cookie ? { Cookie: this.cookie } : {}),
        },
        body,
        signal: AbortSignal.timeout(this.timeoutMs),
        redirect: 'error',
      });
    } catch (err) {
      throw new SmappeeError(`${this.host} does not answer (${err.cause?.code ?? err.name})`, {
        kind: 'unreachable',
        cause: err,
      });
    }
    const cookie = response.headers.get('set-cookie');
    if (cookie) {
      this.cookie = cookie.split(';')[0];
    }
    if (!response.ok) {
      throw new SmappeeError(`${this.host} answered HTTP ${response.status}`, {
        kind: response.status === 401 || response.status === 403 ? 'unauthorized' : 'invalid',
        status: response.status,
      });
    }
    try {
      return await response.json();
    } catch {
      throw new SmappeeError(`${this.host} is not a Smappee local API`, { kind: 'invalid' });
    }
  }

  /** Log on with the password; throws `unauthorized` when it is refused. */
  async logon() {
    const answer = await this.post('logon', this.password);
    if (!answer || typeof answer !== 'object' || 'error' in answer) {
      throw new SmappeeError(`${this.host} refused the password`, { kind: 'unauthorized' });
    }
    return answer;
  }

  /** A command; logs on once when the session is gone, as pysmappee does. */
  async call(command, body = 'load') {
    let answer = await this.post(command, body);
    if (NOT_AUTHENTICATED.test(answer?.error ?? '')) {
      await this.logon();
      answer = await this.post(command, body);
      if (NOT_AUTHENTICATED.test(answer?.error ?? '')) {
        throw new SmappeeError(`${this.host} refused the session`, { kind: 'unauthorized' });
      }
    }
    return answer;
  }

  advancedConfig() {
    return this.call('advancedConfigPublic');
  }

  config() {
    return this.call('configPublic');
  }

  channelsConfig() {
    return this.call('channelsConfigPublic');
  }

  commandControl() {
    return this.call('commandControlPublic');
  }

  instantaneous() {
    return this.call('instantaneous', 'loadInstantaneous');
  }

  /** Turn a plug or a switch on or off. */
  async control(id, on) {
    const action = JSON.stringify({ controllableNodeId: String(id), action: on ? 'ON' : 'OFF' });
    const answer = await this.call('commandControlPublic', `control,${action}`);
    if (answer && typeof answer === 'object' && 'error' in answer) {
      throw new SmappeeError(
        `${this.host} refused the command: ${String(answer.error).slice(0, 80)}`,
        {
          kind: 'invalid',
        },
      );
    }
    return answer;
  }
}
