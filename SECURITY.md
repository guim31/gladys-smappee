# Security policy

## Reporting a vulnerability

Please do **not** report a security problem in a public issue, pull request or
forum post.

Report it privately through GitHub instead: open the **Security** tab of this
repository, then **Report a vulnerability**.

No such button? Private reporting is not enabled yet: open an issue that only
asks the maintainers for a private contact, without any detail of the problem,
and send the report there.

Include, when you can:

- the version of the integration and of Gladys;
- what an attacker can do, and the steps to reproduce it;
- the log lines that help (remove tokens, passwords and addresses first).

The fix ships as a new version of the integration, and the advisory is
published once users can update.

## Supported versions

Only the latest release receives security fixes: update the integration from
Gladys before reporting a problem.

## Scope

In scope: the code of this repository and the Docker image it publishes.

What the integration handles:

- the password of the monitors' local web interface and the Smappee cloud
  credentials (API client id and secret, account user name and password): kept
  in the Gladys configuration, sent only to the monitors and to
  `app1pub.smappee.net` (HTTPS), never written to the logs;
- the cloud access token: in memory only;
- `/data/smappee-state.json`: the monitors, sub-meters and plugs seen, their
  local addresses and the energy indexes (file mode 600);
- network: HTTP (port 80) and MQTT (port 1883) to the addresses typed in the
  configuration, without encryption, as the monitors offer them: keep them on
  a trusted local network.

Out of scope: Gladys Assistant itself (see its
[security policy](https://github.com/GladysAssistant/Gladys/security/policy)),
and the third-party services and devices the integration talks to.
