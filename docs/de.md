# Smappee

> **Ohne die Hardware entwickelt: Rückmeldungen willkommen.** Diese Integration wurde nach der
> Smappee-Bibliothek von Home Assistant (pysmappee) und der offiziellen API geschrieben und an
> simulierten Messgeräten getestet. Wenn mit deinem Smappee etwas nicht stimmt, eröffne bitte ein
> Issue: https://github.com/guim31/gladys-smappee/issues

## Überblick

Diese Integration bringt deine **Smappee**-Energiemonitore in Gladys: Verbrauch des Hauses,
Solarproduktion, Netzbezug und Einspeisung, Unterzähler, Smappee Switches und Comfort Plugs. Die
Integration liest die Messgeräte zuerst im lokalen Netz und über die Smappee-Cloud die, deren Adresse du nicht eingibst.

| Messgerät                         | Gelesen über                                  |
| --------------------------------- | --------------------------------------------- |
| Smappee Energy, Solar, Pro/Plus   | lokale Web-API (HTTP), alle 5 bis 60 Sekunden |
| Smappee Infinity, Genius, Connect | lokaler MQTT-Broker (Port 1883), live         |
| Jedes Messgerät deines Kontos     | Smappee-Cloud (optional), alle 5 Minuten      |

## Voraussetzungen

- Gladys Assistant 5.1 oder neuer (5.2 für den Energie-Tab).
- Lokal: die IP-Adresse jedes Messgeräts im Netz von Gladys. Gib ihm im Router eine feste Adresse.
  Energy, Solar und Pro brauchen das Passwort ihrer lokalen Weboberfläche (`admin`, wenn du es nicht
  geändert hast).
- Für die Cloud (optional): eine API-Client-ID und ein Secret, die Smappee auf Anfrage vergibt
  (frag den Smappee-Support nach „API-Zugang“), sowie Benutzername und Passwort deines
  Smappee-Kontos.

## Konfiguration

### Lokaler Zugang

Gib unter **Integrationen → Smappee → Konfiguration** die IP-Adressen deiner Messgeräte ein, durch
Kommas getrennt. Für jede Adresse versucht die Integration die lokale Web-API, dann den MQTT-Broker.
Das **Passwort der lokalen Weboberfläche** wird nur von Energy, Solar und Pro genutzt; lass es leer
für das Werkspasswort.

### Cloud-Zugang

Füll die vier Felder des Abschnitts **Smappee-Cloud** aus, um Messgeräte außerhalb deines Netzes zu
lesen und die in der Cloud bekannten Steckdosen zu steuern. Ein Messgerät mit eingegebener Adresse wird nur lokal gelesen, nie über die Cloud: Entferne seine Adresse, um es über die Cloud zu lesen. Mit drei von vier Feldern bleibt die Cloud aus.

### Optionen

- **Lokales Aktualisierungsintervall**: wie oft die lokalen Messwerte an Gladys gesendet werden
  (standardmäßig 10 Sekunden). Die Energiezähler werden immer aus jedem Messwert berechnet.
- **Smappee-Steckdosen und -Schalter steuern**: aus, werden sie nur angezeigt.
- **Sprache der Gerätenamen**: die Namen der Funktionen beim Hinzufügen eines Geräts.

Öffne dann den Tab **Entdecken** und füge die gewünschten Geräte hinzu.

## Geräte

### Messgerät

Ein Gerät pro Messgerät, benannt nach Modell und Seriennummer (`Smappee Genius 5010000101`):

- **Verbrauch** (W) und **Verbrauchszähler** (kWh): das ganze Haus;
- mit Solarmodulen: **Solarproduktion** und **Solarproduktionszähler**, **Netzbezug** und
  **Netzeinspeisung** (W), **Bezugszähler** und **Einspeisezähler** (kWh), berechnet aus Verbrauch
  minus Produktion;
- Infinity, Genius und Connect: **Spannung L1** bis **Spannung L3**.

Über ihre lokale API liefern die Messgeräte Leistungen, keine Zähler: Die Integration addiert
Leistung × Zeit zu den Zählern, gespeichert in ihrem Datenvolume. Eine Lücke von mehr als 3 Minuten
(Gladys oder Messgerät gestoppt) wird nicht aufgefüllt. Über die Cloud addieren die Zähler die
5-Minuten-Summen von Smappee. Die Zähler beginnen beim ersten Mal bei 0.

### Unterzähler

Infinity, Genius und Connect: ein Gerät pro in der Smappee-App eingerichtetem Stromkreis
(CT-Zangen), benannt wie in der App, sonst **Smappee-Unterzähler** und seine Kanalnummer:
**Leistung**, **Energiezähler** und **Strom**.

### Steckdosen und Schalter

Ein Gerät pro Smappee Switch, Comfort Plug oder Cloud-Ausgangsmodul, mit einer Funktion **Ein/Aus**
(benannt wie in der App, sonst **Smappee-Steckdose** und ihre Nummer). Eine Comfort Plug (433 MHz)
meldet ihren Zustand nie: Gladys zeigt den zuletzt gesendeten Befehl.

## Energie-Tab

Der **Verbrauchszähler** eines Messgeräts und der **Energiezähler** seiner Unterzähler sind
Verbrauchszähler für den Energie-Tab von Gladys 5.2; der **Solarproduktionszähler** ist ein
Produktionszähler. Ordne die Unterzähler in den Energie-Einstellungen dem Messgerät unter, damit sie
nicht doppelt gezählt werden. Netzbezug und Einspeisung werden angezeigt, nie noch einmal addiert.

## Widget

**Smappee-Energiefluss** zeigt einen Standort (das erste Messgerät oder das in den Einstellungen
gewählte): **Haus**, und mit Solarmodulen **Solar**, **Bezug** und **Einspeisung**, das Netz als
Anzeige (**Netz**, Bezug rechts, Einspeisung links) und den **Eigenverbrauch** der Produktion, mit
dem Zustand des Messgeräts.

## Szenen-Auslöser

- **Ein Smappee geht offline**: Das Messgerät antwortet nicht mehr (3 lokale Lesungen in Folge, eine
  Minute ohne MQTT-Nachricht oder 30 Minuten ohne neue Cloud-Daten).
- **Ein Smappee ist wieder online**: Es antwortet wieder.

Beide lassen sich auf ein Messgerät beschränken und liefern seinen Namen als Variable. Für einen
**hohen Verbrauch** nutze den Standard-Auslöser von Gladys auf einen Gerätewert: „Verbrauch“ des
Messgeräts über zum Beispiel 6000 W.

## Aktionen

**Nach Smappee-Messgeräten suchen** (Tab Konfiguration): verbindet sich neu mit den Adressen und der
Cloud und meldet, was wie geantwortet hat und was nicht stimmt (Passwort, Adresse,
Cloud-Zugangsdaten).

## Szenen-Beispiele

- Wenn der **Verbrauch** des Messgeräts 6000 W übersteigt, den Smappee Switch des Warmwasserspeichers
  ausschalten und eine Nachricht senden.
- Wenn die **Netzeinspeisung** 1500 W übersteigt, die Comfort Plug der Poolpumpe einschalten.
- Wenn **Ein Smappee geht offline**, eine Nachricht senden (Stromausfall, WLAN weg).

## Fehlerbehebung

- **Kein Gerät in Entdecken**: Starte **Nach Smappee-Messgeräten suchen** und lies den Bericht.
- „hat das Passwort abgelehnt“: Gib das Passwort der lokalen Weboberfläche des Messgeräts ein.
- „Dort antwortet kein Smappee“: Prüfe die Adresse; ein Infinity, Genius oder Connect muss
  Verbindungen auf Port 1883 aus dem Netz von Gladys annehmen.
- „warte auf die Konfiguration des Smappee“: Der MQTT-Broker antwortet, hat seine Konfiguration aber
  noch nicht gesendet; warte eine Minute und suche erneut.
- „Zugangsdaten abgelehnt“: Prüfe Client-ID und Secret von Smappee sowie dein Konto.
- Ausführliche Protokolle: Starte die Integration mit `LOG_LEVEL=debug`.

## Grenzen

- Ohne die Hardware entwickelt: Die Nachrichtenformate stammen aus pysmappee und der offiziellen
  Dokumentation. Rückmeldungen willkommen.
- Energy, Solar und Pro liefern über ihre lokale API weder Spannung noch Unterzähler.
- Die lokalen Zähler berechnet die Integration, kleine Abweichungen zur Smappee-App sind möglich.
- Die Cloud liefert 5-Minuten-Daten: Leistungen sind 5-Minuten-Mittelwerte, alle 5 Minuten gelesen.
- Keine automatische Erkennung: Gib die Adressen ein.
- Nicht mit Smappee verbunden.
