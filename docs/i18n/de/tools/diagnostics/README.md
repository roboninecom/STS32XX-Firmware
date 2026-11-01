<!-- translation-navigation -->
[English](../../../en/tools/diagnostics/README.md) · [Русский](../../../ru/tools/diagnostics/README.md) · [Español](../../../es/tools/diagnostics/README.md) · [Français](../../../fr/tools/diagnostics/README.md) · [Deutsch](README.md) · [Português (Brasil)](../../../pt-BR/tools/diagnostics/README.md) · [简体中文](../../../zh-CN/tools/diagnostics/README.md) · [日本語](../../../ja/tools/diagnostics/README.md) · [हिन्दी](../../../hi/tools/diagnostics/README.md) · [العربية](../../../ar/tools/diagnostics/README.md)

[Englisches Original](../../../../../tools/diagnostics/README.md)

> Vollständige maschinelle Übersetzung, noch nicht von Muttersprachlern geprüft. Bilder und Videos werden gemeinsam verwendet; enthaltene Texte bleiben in der Originalsprache.
<!-- /translation-navigation -->

<!-- translated-content -->
<a id="bus-benchmark-and-telemetry-diagnostics"></a>
# Bus-Benchmark und Telemetrie-Diagnostik

Zwei command-line-Tools für STS-Servos: Messung der Kommunikationsleistung und Überprüfung der stationären Telemetrie für ungewöhnliche Messwerte. Benötigt Node.js 20 oder neuer. Installation von Abhängigkeiten mit `npm install`.

Halten Sie die Motoren stationär mit Drehmoment ab und verriegeln Sie die Einstellungen. Stoppen Sie andere Programme über den seriellen Anschluss. Beide Werkzeuge überprüfen die ausgewählten Servos vor und nach einem Lauf. Ermöglichen Sie weder Drehmoment, bewegt einen Motor, flasht Firmware oder spart Einstellungen.

<a id="bus-benchmark"></a>
## Benchmark für den Busverkehr

```sh
npm run bus-benchmark -- --port /dev/cu.usbmodemXXXX --ids 1,2 --repetitions 1000
```

Standardmäßig misst PING und READ Anfragen unterschiedlicher Größe. Jeder Fall führt 20 Aufwärmversuche aus, dann 1,000 gemessene Versuche pro Motor. Motorische Ordnung dreht sich zwischen Runden. Fehlerhafte Versuche bleiben Ausfälle; Wiederholungen ersetzen sie nie.

Nützliche Optionen:

- `--list`: List Cases ohne Port zu öffnen.
- `--cases ping,read-table-87`: Führen Sie ausgewählte Fälle aus.
- `--warmup 20`, `--repetitions 1000`: Versuche pro Gehäuse und Motor.
- `--gap-ms 1`: Pause zwischen den Anfragen; Standard ist keine zusätzliche Pause.
- `--results DIR`: Ausgangs-Eltern; Standard ist `tools/diagnostics/results`.
- `--include-writes`: auch Benchmark anerkannt schreibt an RAM Register 51–54. Diese Register sind undokumentiert auf andere Firmware; verwenden Sie diese Option nur auf einem verifizierten kompatiblen Servo. Originalwerte werden nach Abschluss, Ausfall oder anmutigen Unterbrechungen wiederhergestellt. Schreibbestätigungen müssen aktiviert sein.

Jeder Run erstellt ein neues Verzeichnis mit `summary.csv`, `report.json` und `samples.jsonl`. Die Zusammenfassung enthält Median, p95, p99 und maximale Latenz, sowie Timeout und Fehlerzahlen. Rohe Datensätze beinhalten Warmup- und Bereinigungsaustausch.

Die Latenz läuft vom seriellen Schreibaufruf bis zu einer passenden dekodierten Antwort. Sie beinhaltet USB und operating-system Verzögerungen; es ist nicht firmware-only Reaktionszeit oder eine Messung der maximalen Buskapazität. Timeouts werden separat gezählt, nicht in Latenz Perzentile enthalten.

<a id="telemetry"></a>
## Telemetrie

```sh
npm run telemetry -- --port /dev/cu.usbmodemXXXX --ids 1,2 \
  --samples 1000 --interval-ms 20 --output tools/diagnostics/results/telemetry-check
```

Liest 17 Bytes, beginnend bei Register 56, einmal pro Motor pro Runde. Standardmäßig sind 100,000 Samples pro Motor ohne zusätzliche Pause. Verwenden Sie für jeden Lauf ein neues Ausgabeverzeichnis; vorhandene Beispieldateien werden nie überschrieben.

- `--interval-ms 20`: Mindestintervall zwischen Rundenstarts. Vermißte Slots werden übersprungen und in `missedDeadlines` gezählt; verzögerte Runden verursachen keine Bursts.
- `--gap-ms 1`: Pause nach jedem Motorwunsch. Kann nicht mit `--interval-ms` kombiniert werden.
- `--voltage-min 5.5 --voltage-max 8.4`: erwarteter Spannungsbereich in Volt; Standardeinstellung für 8–16 V. Stellen Sie dies für die angeschlossenen Motoren und Stromversorgungen ein.

Ausgänge: `samples.csv` enthält jeden Versuch, `anomalies.jsonl` enthält markierte Messwerte und Rohwechsel, und `report.json` enthält Zählungen, Bereiche, Timing-Statistiken und before/after Einstellungen. CSV Spannung ist in Zehntel Volt; Position, Geschwindigkeit, Strom und Aufwand behalten ihre Rohregistereinheiten.

Kontrolliert Flag-Spannungs- und Temperaturänderungen, unglaubwürdige Messwerte, Nicht-Null-Status und Aufwand, während das Drehmoment ausgeschaltet ist. Temperaturspitzenerkennung erfordert drei aufeinander folgende gültige Antworten; eine fehlende oder ungültige Antwort bricht die Sequenz. Diese Flags identifizieren Messwerte, um zu überprüfen, nicht den Nachweis einer Firmware oder Sensorfehler. Identische stationäre Messwerte sind normal und beweisen keine veralteten Daten.

<a id="common-options-and-tests"></a>
## Gemeinsame Optionen und Tests

Beide Tools akzeptieren `--baud 1000000`, `--timeout-ms 100` und `--help`. IDs sind in `1,2` voreingestellt; geben Sie die tatsächlich angeschlossenen Motoren an. Die Antwort-Timeout beginnt nach den seriellen Schreibabläufen. Nach einem Timeout warten die Tools auf einen ruhigen Bus, bevor sie fortfahren, da Antworten keine Sequenznummern enthalten.

Strg+C stoppt den Lauf und führt das Aufräumen durch. Fehler, unvollständige Ausläufe und markierte Samples erzeugen einen nichtzero Exit-Code. Ergebnisse unter `results/` werden von Git ignoriert.

```sh
npm run test:diagnostics
```

Diese Offline-Tests verbinden sich nicht mit Hardware.
<!-- /translated-content -->
