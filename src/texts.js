// -----------------------------------------------------------------------------
// Texts the container sends to Gladys, in the four languages of its interface
// (German says "du", Spanish "usted"): connection status, reports of the
// "Search" action, errors of the commands.
// -----------------------------------------------------------------------------

export const INIT_FAILED = {
  en: 'The Smappee integration could not start: see its logs.',
  fr: "L'intégration Smappee n'a pas pu démarrer : consultez ses journaux.",
  de: 'Die Smappee-Integration konnte nicht starten: Sieh in ihre Protokolle.',
  es: 'La integración Smappee no pudo iniciarse: consulte sus registros.',
};

export const CONNECTION_TEXT = {
  noConfig: {
    en: 'Enter the address of your Smappee monitor, or your Smappee cloud credentials, in the configuration.',
    fr: "Saisissez l'adresse de votre Smappee, ou vos identifiants du cloud Smappee, dans la configuration.",
    de: 'Gib die Adresse deines Smappee oder deine Smappee-Cloud-Zugangsdaten in der Konfiguration ein.',
    es: 'Introduzca la dirección de su Smappee, o sus credenciales de la nube Smappee, en la configuración.',
  },
  noAnswer: {
    en: 'No Smappee monitor answers: check the addresses, the password and the cloud credentials.',
    fr: 'Aucun Smappee ne répond : vérifiez les adresses, le mot de passe et les identifiants du cloud.',
    de: 'Kein Smappee antwortet: Prüfe die Adressen, das Passwort und die Cloud-Zugangsdaten.',
    es: 'Ningún Smappee responde: compruebe las direcciones, la contraseña y las credenciales de la nube.',
  },
};

// Reports of the "Search" action, one line per monitor or problem.
export const SEARCH_TEXT = {
  en: {
    found: (n) => `${n} Smappee monitor(s) found.`,
    none: 'No Smappee monitor found.',
    local: (address) => `read locally at ${address}`,
    cloud: 'read through the cloud',
    offline: 'not answering',
    password: (address) => `${address}: the monitor refused the password.`,
    noSmappee: (address) => `${address}: no Smappee answers there.`,
    waiting: (address) => `${address}: connected, waiting for the monitor's configuration.`,
    cloudRefused: 'Smappee cloud: credentials refused.',
    cloudDown: 'Smappee cloud: not answering.',
    cloudIncomplete: 'Smappee cloud: fill in the four fields to use it.',
    invalid: (list) => `Ignored addresses: ${list}.`,
  },
  fr: {
    found: (n) => `${n} Smappee trouvé(s).`,
    none: 'Aucun Smappee trouvé.',
    local: (address) => `lu en local sur ${address}`,
    cloud: 'lu par le cloud',
    offline: 'ne répond pas',
    password: (address) => `${address} : le Smappee a refusé le mot de passe.`,
    noSmappee: (address) => `${address} : aucun Smappee ne répond à cette adresse.`,
    waiting: (address) => `${address} : connecté, en attente de la configuration du Smappee.`,
    cloudRefused: 'Cloud Smappee : identifiants refusés.',
    cloudDown: 'Cloud Smappee : ne répond pas.',
    cloudIncomplete: 'Cloud Smappee : remplissez les quatre champs pour l’utiliser.',
    invalid: (list) => `Adresses ignorées : ${list}.`,
  },
  de: {
    found: (n) => `${n} Smappee gefunden.`,
    none: 'Kein Smappee gefunden.',
    local: (address) => `lokal gelesen unter ${address}`,
    cloud: 'über die Cloud gelesen',
    offline: 'antwortet nicht',
    password: (address) => `${address}: Der Smappee hat das Passwort abgelehnt.`,
    noSmappee: (address) => `${address}: Dort antwortet kein Smappee.`,
    waiting: (address) => `${address}: verbunden, warte auf die Konfiguration des Smappee.`,
    cloudRefused: 'Smappee-Cloud: Zugangsdaten abgelehnt.',
    cloudDown: 'Smappee-Cloud: antwortet nicht.',
    cloudIncomplete: 'Smappee-Cloud: Füll alle vier Felder aus, um sie zu nutzen.',
    invalid: (list) => `Ignorierte Adressen: ${list}.`,
  },
  es: {
    found: (n) => `${n} Smappee encontrado(s).`,
    none: 'No se ha encontrado ningún Smappee.',
    local: (address) => `leído en local en ${address}`,
    cloud: 'leído por la nube',
    offline: 'no responde',
    password: (address) => `${address}: el Smappee ha rechazado la contraseña.`,
    noSmappee: (address) => `${address}: ningún Smappee responde en esa dirección.`,
    waiting: (address) => `${address}: conectado, esperando la configuración del Smappee.`,
    cloudRefused: 'Nube Smappee: credenciales rechazadas.',
    cloudDown: 'Nube Smappee: no responde.',
    cloudIncomplete: 'Nube Smappee: rellene los cuatro campos para usarla.',
    invalid: (list) => `Direcciones ignoradas: ${list}.`,
  },
};

/**
 * The report of the "Search" action, in the four languages.
 * @param {object} summary hub.summary()
 */
export function searchMessage(summary) {
  const message = {};
  for (const [lang, t] of Object.entries(SEARCH_TEXT)) {
    const lines = [summary.monitors.length > 0 ? t.found(summary.monitors.length) : t.none];
    for (const monitor of summary.monitors) {
      const how = monitor.reachable
        ? monitor.access === 'cloud'
          ? t.cloud
          : t.local(monitor.address)
        : t.offline;
      lines.push(`${monitor.name}${lang === 'fr' ? ' : ' : ': '}${how}.`);
    }
    for (const host of summary.hosts) {
      if (host.problem && t[host.problem]) {
        lines.push(t[host.problem](host.address));
      }
    }
    if (summary.cloud === 'refused') {
      lines.push(t.cloudRefused);
    } else if (summary.cloud === 'down') {
      lines.push(t.cloudDown);
    } else if (summary.cloud === 'incomplete') {
      lines.push(t.cloudIncomplete);
    }
    if (summary.invalidHosts.length > 0) {
      lines.push(t.invalid(summary.invalidHosts.join(', ')));
    }
    message[lang] = lines.join(' ');
  }
  return message;
}

export const ERROR_TEXT = {
  unknownDevice: {
    en: 'Unknown Smappee device.',
    fr: 'Appareil Smappee inconnu.',
    de: 'Unbekanntes Smappee-Gerät.',
    es: 'Dispositivo Smappee desconocido.',
  },
  readOnly: {
    en: 'This Smappee feature cannot be controlled.',
    fr: 'Cette fonction Smappee ne se commande pas.',
    de: 'Diese Smappee-Funktion lässt sich nicht steuern.',
    es: 'Esta función de Smappee no se puede controlar.',
  },
  controlsOff: {
    en: 'Control of the Smappee plugs is turned off in the configuration.',
    fr: 'La commande des prises Smappee est désactivée dans la configuration.',
    de: 'Die Steuerung der Smappee-Steckdosen ist in der Konfiguration ausgeschaltet.',
    es: 'El control de los enchufes Smappee está desactivado en la configuración.',
  },
  unreachable: {
    en: 'The Smappee monitor does not answer.',
    fr: 'Le Smappee ne répond pas.',
    de: 'Der Smappee antwortet nicht.',
    es: 'El Smappee no responde.',
  },
};

/** An Error whose message is in the configured language (shown by Gladys). */
export function localError(key, language = 'en', cause) {
  const text = ERROR_TEXT[key];
  const err = new Error(text[language] ?? text.en, cause ? { cause } : undefined);
  err.key = key;
  return err;
}
