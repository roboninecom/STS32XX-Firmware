<!-- translation-navigation -->
[English](../../../en/host/servo-driver/README.md) · [Русский](../../../ru/host/servo-driver/README.md) · [Español](../../../es/host/servo-driver/README.md) · [Français](../../../fr/host/servo-driver/README.md) · [Deutsch](README.md) · [Português (Brasil)](../../../pt-BR/host/servo-driver/README.md) · [简体中文](../../../zh-CN/host/servo-driver/README.md) · [日本語](../../../ja/host/servo-driver/README.md) · [हिन्दी](../../../hi/host/servo-driver/README.md) · [العربية](../../../ar/host/servo-driver/README.md)

[Englisches Original](../../../../../host/servo-driver/README.md)

> Vollständige maschinelle Übersetzung, noch nicht von Muttersprachlern geprüft. Bilder und Videos werden gemeinsam verwendet; enthaltene Texte bleiben in der Originalsprache.
<!-- /translation-navigation -->

<!-- translated-content -->
<a id="sts32xx-servo-driver"></a>
# STS32XX Servotreiber

Node.js Treiber für STS serielle Servos und die STS32XX Firmware **v9 Motion Extension**. Es bietet Entdeckung, Registerzugriff, Einstellungsoperationen, S-curve Bewegungsbefehle, Gravitationskompensation und Feedback durch eine serielle Verbindung. Benötigt **Node.js 20 oder neuer** und einen kompatiblen seriellen Adapter.

Legacy Operationen verwenden die STS Steuertabelle in diesem Paket enthalten. Erweiterung Operationen erfordern benutzerdefinierte Firmware v9; Fabrik Firmware stellt sie nicht zur Verfügung. Das Paket ist für Node.js, nicht Browser Web Serial.

<a id="install"></a>
## Installation

Aus diesem Projektarchiv:

```sh
npm ci
npm run test:driver
npm pack --workspace sts32xx-servo-driver --pack-destination /tmp
```

Installieren Sie in einem anderen Projekt von Node.js das Archiv, das mit dem letzten Befehl erstellt wurde:

```sh
npm install /tmp/sts32xx-servo-driver-0.1.0.tgz
```

Das Archiv enthält die Bibliothek, Beispiele, README und Lizenz. Serienabhängigkeiten werden über npm installiert; Firmware, Protokolle und Testergebnisse sind nicht enthalten.

HäufigJS

```js
const { StsServo } = require('sts32xx-servo-driver');
```

ES Module:

```js
import driver from 'sts32xx-servo-driver';
const { StsServo } = driver;
```

Bestehende Repository-Tools können `host/servo-driver` direkt importieren. Verwenden Sie den Hauptexport des Pakets; interne Dateipfade sind nicht Teil seiner öffentlichen API.

<a id="connect-and-read"></a>
## Verbinden und lesen

```js
const { StsServo } = require('sts32xx-servo-driver');

const servo = new StsServo({
  serial: { path: '/dev/cu.usbmodemYOUR_ADAPTER', baudRate: 1000000 },
});

async function main() {
  try {
    const found = await servo.connect();
    for (const id of found.ids) {
      const values = await servo.bus.read(id,
        ['presentPosition', 'presentVoltage', 'servoStatus']);
      console.log(id, values, found.alarms.get(id) ?? []);
    }
  } finally {
    await servo.close();
  }
}
main().catch(console.error);
```

Verwenden Sie `/dev/ttyUSB0`, `COM3` oder den aktuellen Port Ihres Adapters. Discovery findet reagierende IDs am ausgewählten Baud; es ändert keine Motoreinstellungen oder scannt andere Baudraten. IDs müssen einzigartig sein. Wartet auf den höchstmöglichen ID und ausgewählten Baud. `connect()` öffnet den Port und entdeckt Motoren; `open()` öffnet nur den Port. Bus- und Erweiterungsmethoden erfordern entdeckten IDs.

Registerwerte verwenden rohe Einheiten. `presentVoltage: 120` bedeutet z.B. 12 V. `ControlTable` beschreibt Adressen, Kodierungen, Bereiche und Anzeigeskalen. Multi-byte Felder verwenden little-endian Kodierung; signierte Legacy-Werte verwenden Zeichenbits.

<a id="main-api"></a>
## Haupt API

Alle Operationen, die mit Hardware-Return-Versprechen kommunizieren.

| API | Zweck |
| --- | --- |
| `servo.connect()` / `servo.close()` | Open/discover oder schließen Sie die serielle Verbindung. |
| `servo.bus.discover()` | Aktualisieren Sie die Liste der bekannten IDs. |
| `servo.bus.scan()` | Entdecken Sie, ohne die known-ID-Liste zu ersetzen. |
| `servo.bus.verify(ids)` | Ping bekannte Motoren einzeln. |
| `servo.bus.read(id, keys, options)` | Genannte Register lesen; gibt ein Objekt zurück, das durch den Namen des Registers keyed ist. |
| `servo.bus.write(id, values, options)` | Schreiben Sie ein Objekt von Namen Registern. |
| `servo.bus.readMany(ids, keys, options)` | Lesen Sie mehrere Motoren mit Gruppenanfragen. |
| `servo.bus.syncWrite(entries, options)` | Schreib Einträge in Form von `{ id, values }` in einer Gruppe. |
| `servo.bus.device(id)` | Erhalten Sie ein Komfortobjekt mit `read`, `write` und reset/calibration Methoden. |
| `servo.settings.read(id)` | Persistente Legacy-Einstellungen lesen. |
| `servo.settings.save(id, values)` | Entsperren, Speichern, Verifizieren und Relock gewöhnliche Einstellungen. |
| `servo.arm` | Zugriff auf die v9 Methoden unten. |

Die Einstellungen speichern einen 250 ms Request-Timeout. Nach einer verlorenen Schreibbestätigung wartet der Treiber auf Persistenz und liest das Register vor dem erneuten Versuch zurück. Already-applied schreibt nicht wiederholt. Temporäre Kommunikationsausfälle haben bis zu drei Versuche; anhaltende Fehler melden immer noch einen Fehler und versuchen, den Motor neu zu sperren. `{ timeoutMs }` an `settings.save` übergeben, um den Timeout zu überschreiben.

Legacy-Beispiel für einen gesicherten Motor in Position, der sich bewegen soll:

```js
await servo.bus.write(id, { targetPosition: 2048 },
  { timeoutMs: 100, rejectOnAlarm: true });
```

Ein Legacy-Goal-Write kann automatisch das Drehmoment aktivieren, abhängig von den gespeicherten Einstellungen. Persistente Schreibweisen können Kalibrierung, Grenzen oder Gewinne ändern. Deaktivieren Sie das Drehmoment, bevor Sie die Einstellungen ändern. Die Einstellungen API Wächter ID, Baud und response-level Änderungen; verwenden Sie die [Einstellungen CLI](../../tools/settings/README.md) im Repository für volle backup/restore. Factory Reset, reset-template und Kalibrierbefehle werden durch `servo.protocol` ausgesetzt; rufen Sie sie nur, wenn diese Änderungen beabsichtigt sind.

<a id="v9-control-lifecycle"></a>
## v9 Lebenszyklus der Kontrolle

1. Starten Sie mit dem Drehmoment aus. Lesen Sie Fähigkeiten und Konfiguration.
2. Verwenden Sie eine validierte Konfiguration mit `arm.configure()`, während das Drehmoment aus ist.
3. Wählen Sie den Erweiterungsmodus mit einer neuen Nicht-Null-Sitzung ID.
4. Aktivieren Sie das Drehmoment mit dem Altregister 40 und lesen Sie dann Feedback, bis die Sitzung bewaffnet, frisch, drive-enabled und output-ready ist.
5. Senden Sie Ziele und Schwerkraft-Updates. Überprüfen Sie ihre akzeptierten Sequenznummern in neuem Feedback.
6. Schreiben Sie `torqueEnable: 0`, wenn die Anwendung beabsichtigt, den Motor freizugeben.

```js
const options = { timeoutMs: 100, rejectOnAlarm: true };
const caps = await servo.arm.capabilities(id, options);
if (caps?.major !== 9) throw new Error('Extension v9 is required');

// config must contain values validated for this motor and mechanism.
await servo.arm.configure(id, config, options);
await servo.arm.select(id, true, session, options);
await servo.bus.write(id, { torqueEnable: 1 }, options);
// Check readiness using servo.arm.feedback() before sending motion.

await servo.arm.setTargets([
  { id, target: { sequence: 1, positionQ8: 2048 * 256, speedLimit: 100 } },
], session, options);

await servo.arm.updateGravity(id,
  { session, sequence: 1, gravityEffort: -20 }, options);
```

Dieses Snippet zeigt die Aufrufe an; das [complete motion example](../../../../../host/servo-driver/examples/v9-move.js) enthält Validierung, Bereitschaftsabfrage, Abnahmeprüfungen und torque-off Bereinigung. Wenn Schreibbestätigungen deaktiviert sind, benötigen Legacy writes `expectResponse: false` und Rückholverifikation. Das komplette Beispiel übernimmt dies automatisch.

Die Firmware hält das letzte Ziel und behält den letzten Schwerkraftaufwand, bis ersetzt oder Drehmoment deaktiviert ist. Es gibt keinen Herzschlag, keinen Timeout oder das Auslaufen der Schwerkraft. **Das Schließen der seriellen Verbindung hält einen Motor nicht an oder lässt ihn los.** Wählen Sie eine Bereinigung der Anwendung, um den Mechanismus anzupassen; die Freigabe eines geladenen Arms kann ihn fallen lassen. Sensor und Motorschutz bleiben in der Firmware aktiv.

Torque aktiviert die Erfassung der gemessenen Position. Nicht eine Erweiterungssitzung mit Legacy-Ziel schreibt. Torque aus oder ein Fehler beendet die Sitzung; bereiten Sie eine neue Sitzung vor dem Neustart. Um Legacy-Modus mit Drehmoment aus wählen, verwenden Sie `arm.select(id, false, 0)`.

<a id="extension-methods"></a>
### Erweiterungsverfahren

| Verfahren | Ergebnis oder Wirkung |
| --- | --- |
| `capabilities(id, options)` | `{ major, minor, tickMs }` für eine anerkannte Signatur; nicht unterstützte Firmware kann die Anfrage oder Auszeit ablehnen. |
| `configuration(id, options)` | Lesen Sie die aktuelle RAM-Konfiguration. |
| `configure(id, config, options)` | Schreiben Sie die Konfiguration und überprüfen Sie die kodierten Bytes per Rücklese. |
| `select(id, enabled, session, options)` | Bereiten Sie v9-Steuerung, oder wählen Sie Legacy-Modus mit `false, 0`. |
| `setTargets(entries, session, options)` | Senden Sie eine Sendung mit ein bis sechs einzigartigen Motoren. |
| `updateGravity(id, command, options)` | Senden Sie signierten Schwerkraft Aufwand mit seiner eigenen Sequenznummer. |
| `feedback(id, options)` | Lesen Sie eine kohärente operative Stichprobe. |
| `tuning(id, options)` | Lesen Sie operatives Feedback sowie Referenzbewegung und individuelle Aufwandsbedingungen. |
| `invalidate(id)` | Löschen Sie zwischengespeicherte Funktionen nach einem externen Leistungszyklus oder Firmware-Änderung; lassen Sie ID alle löschen. |

Der Treiber deaktiviert automatisch die Fähigkeiten bei der Entdeckung, ID ändert, Verbindungsänderungen und Resets, die über sein Protokoll API ausgegeben werden.

<a id="configuration-and-units"></a>
### Konfiguration und Einheiten

Jedes Konfigurationsfeld ist explizit. Dieses Objekt zeigt das Format, nicht ein empfohlenes Stimmprofil:

```js
const config = {
  kpQ8: 256, kdQ8: 0, kiQ8: 0,
  integralLimit: 0, effortLimit: 100,
  velocityLimit: 100, accelerationLimit: 500,
  velocityFilterQ8: 64, rampTimeMs: 30,
  velocityFeedforward: {
    positiveGainQ8: 0, negativeGainQ8: 0, effortLimit: 0,
  },
  gravitySlewEffortPerS: 1000,
};
```

| Felder | Einheiten und Grenzen |
| --- | --- |
| `kpQ8`, `kdQ8`, `kiQ8` | Gewinne multipliziert mit 256; Ganzzahl 0–65535. |
| `effortLimit`, `integralLimit` | PWM Aufwandseinheiten; Gesamtlimit 1–1000, Integrallimit 0–Gesamtlimit. |
| `velocityLimit`, Ziel `speedLimit` | Encoder counts/s; 1–65535. |
| `accelerationLimit` | Counts/s²; 1–30000, geteilt durch Beschleunigung und Bremsen. |
| `rampTimeMs` | S-curve Beschleunigung Rampenzeit; 1–255 ms. |
| `velocityFilterQ8` | Filterkoeffizient multipliziert mit 256; 1–255. |
| Gewinne aus der Geschwindigkeitsvorausschätzung | Direction-specific Gewinne multipliziert mit 256; 0–65535. Seine Aufwands-Cap kann nicht über die Gesamt-Cap. Setzen Sie sowohl Gewinne und Cap auf Null, um es zu deaktivieren. |
| `gravitySlewEffortPerS` | Änderung der Schwerkraft pro Sekunde; 1–10000. |
| Ziel `positionQ8` | Encoderposition multipliziert mit 256; −32767×256 zu 32767×256. |
| `gravityEffort` | Signiert PWM Aufwand; −1000 zu 1000. Firmware wendet seine Aufwandsgrenzen an. |

Die Reiselimits stammen aus den gespeicherten Legacy-Positionslimits. Firmware Caps zielt auf die aktiven Limits. Konfiguration ist der RAM-Zustand, kein persistentes Tuning-Profil. Lokale Geschwindigkeitsvorschub folgt der Firmware-Bewegungsreferenz; die Anwendung liefert separat Gravitationskompensation.

Erweiterungsziel-IDs sind 1–253. Eine Sitzung ist 1–65535. Jeder Motor verfolgt Ziel- und Gravitationssequenzen getrennt. Inkrementieren Sie die entsprechende Sequenz für jeden neuen Befehl, wickeln 65535 auf 0; Vorwärtslücken bis zu 32767 werden akzeptiert. Beginnen Sie eine neue Sitzung mit Sequenz 1. Broadcast-Vervollständigung bedeutet, dass das Paket gesendet wurde, nicht dass jeder Motor es akzeptiert hat. Überprüfen Sie `acceptedSequence`, `gravitySequence` und `session` in anschließender Rückmeldung.

<a id="feedback-and-errors"></a>
### Feedback und Fehler

`feedback()` enthält gemessene position/velocity in Q8 Einheiten, angewandten Aufwand, aktuelle ADC Delta, Rohspannung, validierte Temperatur, Fehler, Sitzung und akzeptierte Sequenzen. Verwenden Sie `fresh`, `ageMs`, `sampleSequence`, `armed`, `driveEnabled` und `outputReady`, um zu beurteilen, ob eine Probe verwendbar ist. Temperatur ist nur verwendbar, wenn `temperatureValid` wahr ist. `running: false` bedeutet, dass der Planer nicht mehr bewegt wird; es garantiert keinen Null-Positionsfehler.

`tuning()` fügt Referenz position/velocity, angeforderten Aufwand, P/D/I Terme, Gravitationsaufwand, Geschwindigkeitsvorschub und die Überlaufzahl hinzu.

Lesen und Schreiben von Optionen sind `timeoutMs` und `rejectOnAlarm`. Legacy-Alarms nicht ablehnen sonst gültige Antworten standardmäßig; übergeben `rejectOnAlarm: true`, wenn ein Alarm eine Operation abbrechen sollte. Typierte Fehler sind `RequestTimeoutError`, `MissingResponseError`, `ServoStatusError`, `SettingsVerificationError` und `InvalidPacketError`. Zusätzliche Kontext ist in `error.details`; Erweiterung Ablehnungen enthalten `extensionStatus` dort.

Der Scheduler serialisiert Anfragen und unterstützt Prioritäten und exklusive Transaktionen. Erwarten Sie Befehle und verwenden Sie Gruppenziele für koordinierte Bewegungen. Der Antwort-Timeout beginnt nach den seriellen Schreibabläufen; Transportoperationen haben ihre eigenen Fristen. Diese Timeouts ändern das motorische Verhalten nicht. Legacy-Pakete haben keine Sequenznummer, so dass eine ungewöhnlich späte Antwort nicht immer von einer späteren Anfrage mit der gleichen Antwortform unterschieden werden kann.

Low-level Exporte gehören `SerialTransport`, `StsProtocol`, `RequestScheduler`, `PacketEncoder`, `PacketDecoder`, `RegisterCodec`, `RegisterLayout`, `ArmCodec`, Konstanten und Fehler. Sie bleiben vom high-level Bus API getrennt.

<a id="runnable-examples"></a>
## Ausführbare Beispiele

Aus diesem Verzeichnis oder mit den Beispieldateien, die im installierten Paket enthalten sind:

```sh
node examples/discover.js /dev/cu.usbmodemYOUR_ADAPTER
node examples/v9-feedback.js /dev/cu.usbmodemYOUR_ADAPTER 2
node examples/v9-move.js /dev/cu.usbmodemYOUR_ADAPTER 2 2048 100 /path/to/config.json
```

Die ersten beiden Beispiele lesen nur. Das Bewegungsbeispiel erfordert eine JSON Konfiguration mit den oben genannten Feldern und verwendet 1 Mbaud. Führen Sie es auf einem gesicherten, entladenen Motor mit freiem Weg. Es deaktiviert Drehmoment nach dem Zug, einen Fehler oder anmutig Strg+C. Es wartet bis zu 3 Sekunden für Start und 30 Sekunden für die Bewegung. Optionales Schlussargument: signierter Schwerkraftaufwand, Standard Null. Verwenden Sie es nicht, um eine Armlast zu unterstützen.

<a id="tests-and-license"></a>
## Prüfungen und Lizenzen

Aus dem Repository-Stammverzeichnis:

```sh
npm run test:driver
npm run test:driver-package
npm test
```

Tests verwenden gefälschte Transporte und öffnen keine seriellen Ports. Die Paketprüfung installiert das aktuelle Archiv in einem temporären Projekt, wobei die zwischengespeicherten Abhängigkeiten von `npm ci` von npm verwendet werden, und überprüft CommonJS/ESM-Importe und Beispieleingabepunkte. Es veröffentlicht das Paket nicht. Produktionsinstallation kann native Build-Tools erfordern, wenn eine serial-port-Bindung für das Betriebssystem und CPU nicht verfügbar ist.

[MIT](../../../../../host/servo-driver/LICENSE), Copyright 2026 STS32XX-Firmware Mitwirkende. Diese Lizenz deckt dieses Treiberverzeichnis ab, einschließlich Beispiele und Tests. Sie lizenziert Firmware oder Herstellercode nicht anderswo im Repository. Abhängigkeiten behalten ihre eigenen Lizenzen.
<!-- /translated-content -->
