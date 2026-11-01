<!-- translation-navigation -->
[English](../../../en/tools/hw-diff-tests/README.md) · [Русский](../../../ru/tools/hw-diff-tests/README.md) · [Español](../../../es/tools/hw-diff-tests/README.md) · [Français](../../../fr/tools/hw-diff-tests/README.md) · [Deutsch](README.md) · [Português (Brasil)](../../../pt-BR/tools/hw-diff-tests/README.md) · [简体中文](../../../zh-CN/tools/hw-diff-tests/README.md) · [日本語](../../../ja/tools/hw-diff-tests/README.md) · [हिन्दी](../../../hi/tools/hw-diff-tests/README.md) · [العربية](../../../ar/tools/hw-diff-tests/README.md)

[Englisches Original](../../../../../tools/hw-diff-tests/README.md)

> Vollständige maschinelle Übersetzung, noch nicht von Muttersprachlern geprüft. Bilder und Videos werden gemeinsam verwendet; enthaltene Texte bleiben in der Originalsprache.
<!-- /translation-navigation -->

<!-- translated-content -->
<a id="hardware-comparison-tests"></a>
# Prüfung des Hardware-Vergleichs

Vergleichen Sie Fabrik und benutzerdefinierte Firmware auf STS Servos. Die Suite umfasst das Legacy-Protokoll, Einstellungen, Bewegung, Kalibrierung und Schutz. Es testet nicht Erweiterungsprotokoll v9 Steuerung. Tests verwenden den [shared driver](../../host/servo-driver/README.md) des Projektarchivs.

**Verwenden Sie eine dedizierte Bank mit gesicherten Servos und freien Wellen.** Einige Tests machen lange oder kontinuierliche Bewegungen und ersetzen gespeicherte Einstellungen oder Kalibrierung. Sichern Sie jedes Servo zuerst. Halten Sie einen Weg, um Motorleistung sofort zu trennen.

<a id="setup"></a>
## Einrichtung

Installieren Sie Node.js **20 oder neuer**, dann laufen Sie von der Projektarchiv-root:

```sh
npm ci
npm run test:diff
npm run diff -- --list
```

Diese Befehle laufen offline. `--list` zeigt die Bühne, die Bewegungsklassifikation und den genauen Namen jedes Szenarios. Verwenden Sie `--help` für alle Befehlsoptionen.

Verbinden Sie nur die Test-Servos: einige Fälle verwenden Broadcasts. Schließen Sie andere Programme mit dem Adapter und bieten eine geeignete Motorversorgung. Standard-Verbindungen sind:

| Einstellung | Vorgabe |
|---|---|
| Fabrik Servo ID | `1` |
| Benutzerdefinierte Firmware-Servo ID | `2` |
| Bausatz | `1000000` |

Setzen Sie unterschiedliche Werte mit `--factory-id`, `--candidate-id` und `--baud`. IDs müssen unterschiedlich sein; lassen Sie IDs **250 und 251** unbenutzt, da Tests sie vorübergehend verwenden. Starten Sie mit Drehmoment aus, Einstellungen schreiben gesperrt und keine aktiven Alarme. Verwenden Sie vergleichbare Motoren, Netzteile und Lasten beim Vergleich von Bewegung.

```sh
export SERVO_PORT=/dev/cu.usbmodemYOUR_ADAPTER
```

Ersetzen Sie den Port durch Ihren eigenen. Linux verwendet häufig `/dev/ttyUSB0`; unter Windows, übergeben Sie einen Port direkt, wie `--port COM3`.

<a id="run-tests"></a>
## Prüfungen durchführen

Beginnen Sie mit einem Kommunikationscheck:

```sh
npm run diff -- --port "$SERVO_PORT" --case test_ping
```

Führen Sie die Standardgruppe aus:

```sh
npm run diff -- --port "$SERVO_PORT" --stage safe
```

Die `safe`-Gruppe überprüft PING, Register liest und lehnt einen Schreibvorgang an ein read-only-Register ab. Es treibt die Motoren nicht an, aber es sendet ein WRITE-Paket.

Wählen Sie eine Gruppe mit `--stage` oder ein genaues Szenario mit `--case`:

```sh
npm run diff -- --port "$SERVO_PORT" \
  --case test_motion_write_order_gap_matrix --allow-motion
```

`--case` überschreibt `--stage`. Fokussierte Runs verwenden die vorhandenen Servoeinstellungen; sie installieren nicht die Testkonfiguration der gesamten Suite. Prüfen Sie die gemeldeten Voraussetzungen eines Cases, wenn es nicht starten kann.

| Erlaubnis | Erlaubt |
|---|---|
| `--allow-motion` | Laufwerks- oder Bewegungsbefehle aktivieren |
| `--allow-persistence-write` | Gespeicherte Einstellungen schreiben, kalibrieren und restore-defaults |
| `--allow-template-write` | Ersetzen der gespeicherten Reset-Vorlage |
| `--allow-current-protection` | current-protection-Tests angetrieben; benötigt auch Bewegungsberechtigung |

Die volle Suite benötigt alle vier Berechtigungen und eine anfängliche Baudrate von 1000000:

```sh
npm run diff -- --port "$SERVO_PORT" --stage all \
  --allow-motion --allow-persistence-write \
  --allow-template-write --allow-current-protection
```

Fügen Sie `--fail-fast` hinzu, um nach dem ersten non-passing-Fall zu stoppen. Andernfalls setzen unabhängige Fälle nach normalen Ausfällen fort. Fehlte Voraussetzungen, Bereinigungsfehler und verlorene Kommunikation stoppen weitere Tests.

<a id="settings-and-cleanup"></a>
## Einstellungen und Bereinigung

**Die vollständige Suite stellt Ihre ursprünglichen Einstellungen nicht wieder her.** Sie installiert eine gespeicherte Testkonfiguration und beendet diese durch das Laden der Reset-Vorlage des Servos. Der Template-Test ersetzt diese Vorlage durch die Suite-Einstellungen.

Diese gezielten Tests haben auch dauerhafte Auswirkungen:

- `prerequisites` beinhaltet restore-defaults und Kalibrierung. Sein Offset-Test spart einen neuen Offset, der die angezeigte Position an 2048 platziert.
- `restore-defaults` lädt die gespeicherte Reset-Vorlage (`0x06`), die sich von den Originaleinstellungen des Herstellers unterscheiden kann.
- `template` ersetzt die Reset-Vorlage (`0x09`) durch die aktiven Einstellungen von pre-test. Die alte Vorlage kann von dieser Suite nicht zurückgelesen oder wiederhergestellt werden.

Andere Persistenz-Fälle versuchen, die veränderten Einstellungen wiederherzustellen. Überprüfen Sie immer Bereinigungsfehler vor einem anderen Lauf. Siehe [setings backup and recovery guide](../flash/README.md#restore-factory-settings) für Backup-Befehle und Werkswiederherstellung.

**Strg+C garantiert keine Aufräumarbeiten oder einen gespeicherten Bericht.** Der Läufer hat keinen anmutigen Unterbrechungshandler. Wenn die Bewegung sofort anhalten muss, trennen Sie die Motorleistung; dann überprüfen Sie die Kommunikation, Einstellungen und Drehmomentzustand, bevor Sie fortfahren.

<a id="compare-against-a-saved-factory-run"></a>
## Vergleichen Sie mit einem geretteten Werkslauf

Verwenden Sie die gleichen Fälle, Suite-Revision, Baudrate und vergleichbare Bankbedingungen:

```sh
npm run diff -- --port "$SERVO_PORT" --mode factory --case test_ping

npm run diff -- --port "$SERVO_PORT" --mode candidate --case test_ping \
  --reference tools/hw-diff-tests/results/FACTORY_TIMESTAMP/report.json
```

Ersetzen Sie den Referenzpfad durch den Bericht des ersten Laufs. Halten Sie die Originalfabrik ID in `--factory-id`; der Kandidat muss ein anderes ID haben, auch beim Testen des gleichen physischen Servos nach dem Flashen. Die Suite ändert nicht, dass ID für Sie. Pair-only Fälle sind im single-device Modus übersprungen. Ohne `--reference`, ein single-device übergeben nur die Aussagen dieses Szenarios, nicht Fabrikäquivalenz.

<a id="results"></a>
## Ergebnisse

Berichte werden unter `tools/hw-diff-tests/results/` gespeichert, oder das mit `--results` mitgelieferte Verzeichnis. Ergebnisse und Protokolle werden von Git ignoriert.

Öffnen Sie `report.json` für jedes Gerät Beobachtungen, Vergleiche, übertragene Pakete, empfangene Antworten und Timing. Inspect `fatal`, `cleanupError` und `closeError` sowie die Fallergebnisse.

| Ergebnis | Bedeutung |
|---|---|
| `passed` | Assertionen und alle verfügbaren Vergleich übergeben |
| `mismatch` | Werks- und Kandidatenbeobachtungen unterschieden sich |
| `failed` | Eine Überprüfung der Behauptung, Kommunikation oder Wiederherstellung fehlgeschlagen |
| `inconclusive` | Die Fabrik produzierte nicht den für den Vergleich erforderlichen Effekt |
| `skipped` | Der Fall wurde nicht ausgeführt. |

Exit-Code **0** bedeutet keine gemeldeten Fehler; übersprungene Fälle können bestehen bleiben. **1** bedeutet einen argument/setup-Fehler oder eine nicht behandelte Ausnahme. **2** bedeutet, dass der Bericht einen Fehler, eine Fehlanpassung, ein unzusammenhängendes Ergebnis oder einen cleanup/connection-close-Fehler enthält.

Timing beinhaltet Host-Planung, USB und serielle Verzögerungen; es ist keine direkte Messung der Firmware-Ausführungszeit. Bewahren Sie den Bericht und reproduzieren Sie einen fokussierten Fall, bevor Sie einen Bewegungsunterschied auf Firmware zuweisen.
<!-- /translated-content -->
