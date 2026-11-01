<!-- translation-navigation -->
[English](../en/QUICKSTART.md) · [Русский](../ru/QUICKSTART.md) · [Español](../es/QUICKSTART.md) · [Français](../fr/QUICKSTART.md) · [Deutsch](QUICKSTART.md) · [Português (Brasil)](../pt-BR/QUICKSTART.md) · [简体中文](../zh-CN/QUICKSTART.md) · [日本語](../ja/QUICKSTART.md) · [हिन्दी](../hi/QUICKSTART.md) · [العربية](../ar/QUICKSTART.md)

[Englisches Original](../../../QUICKSTART.md)

> Vollständige maschinelle Übersetzung, noch nicht von Muttersprachlern geprüft. Bilder und Videos werden gemeinsam verwendet; enthaltene Texte bleiben in der Originalsprache.
<!-- /translation-navigation -->

<!-- translated-content -->
<a id="quick-start"></a>
# Schnellstart

Für GD32F130-based STS TTL Servos. Die folgenden Befehle verwenden die Shell-Syntax macOS/Linux und werden vom Repository-Stammverzeichnis ausgeführt. Erweiterungs-Motion-Tools erfordern Firmware v9; Legacy Replay unterstützt auch die werkseitige Firmware.

<a id="1-install"></a>
## 1. Installieren

Installieren Sie Node.js 20+ und Python 3.10+; Der optionale Simulationsviewer benötigt Python 3.12.

```sh
npm ci
python3 -m venv tools/flash/.venv
tools/flash/.venv/bin/python -m pip install -r tools/flash/requirements.txt
export SERVO_PORT=/dev/cu.usbmodemYOUR_ADAPTER
```

Ersetzen Sie den Port durch Ihren, z. B. `/dev/ttyUSB0` unter Linux. Beispiele verwenden Motor ID **1** und Baud **1000000**; Passen Sie diese an Ihr Servo an.

<a id="2-back-up-and-flash"></a>
## 2. Sichern und flashen

**Das Flashen kann den Servo beschädigen oder die Kalibrierung löschen.** Sichern Sie den Mechanismus, verwenden Sie eine stabile Stromversorgung, schalten Sie das Drehmoment ab und schließen Sie andere Programme am seriellen Port. Vor dem Flashen müssen die Einstellungen gesperrt und die Alarme gelöscht sein. Beim normalen Flashen der benutzerdefinierten Firmware können Motoren mit eindeutigen IDs angeschlossen bleiben: Flashen Sie jeweils einen ID und führen Sie keinen power-cycle des Busses aus. Zur Wiederherstellung darf nur der betroffene Servo angeschlossen sein.

```sh
npm run settings -- discover --port "$SERVO_PORT"
npm run settings -- backup --port "$SERVO_PORT" --id 1
```

Laden Sie die **benutzerdefinierte Firmware ZIP** von der [v0.1-Vorschauversion](https://github.com/roboninecom/STS32XX-Firmware/releases/tag/v0.1-preview) unter **Assets** herunter. Extrahieren Sie das Firmware-Image und `release.json` zusammen in `tools/flash/releases/custom/`. Verwenden Sie zum Flashen nicht die **Quellcode**-Archive von GitHub.

```sh
tools/flash/.venv/bin/python tools/flash/flash.py inspect \
  --manifest tools/flash/releases/custom/release.json
tools/flash/.venv/bin/python tools/flash/flash.py flash \
  --manifest tools/flash/releases/custom/release.json --port "$SERVO_PORT" --id 1
```

Geben Sie `FLASH` ein, wenn Sie dazu aufgefordert werden, und lassen Sie die Stromversorgung angeschlossen, bis die Überprüfung abgeschlossen ist. Wiederholen Sie den Blitzbefehl für jeden Motor ID und warten Sie jedes Mal auf die Bestätigung. Siehe [Flashen und Wiederherstellen](tools/flash/README.md), wenn die Überprüfung fehlschlägt.

Die **Werksfirmware ZIP** ist für die Rückkehr zur Werksfirmware gedacht, nicht für die unten aufgeführten Bewegungstools. Extrahieren Sie es in einen separaten Ordner und befolgen Sie nach dem Flashen die Schritte zur [Wiederherstellung der Werkseinstellungen](tools/flash/README.md#restore-factory-settings). Behalten Sie jedes Firmware-Image mit seinem eigenen `release.json` bei.

<a id="3-calibrate-joint-offsets-and-limits"></a>
## 3. Kalibrieren Sie Gelenkversätze und -grenzen

Wählen Sie für einen Mechanismus mit begrenztem Gelenkweg die zu kalibrierenden Motor-IDs aus:

```sh
npm run settings -- calibrate --port "$SERVO_PORT" --ids 1,2,3 \
  --file tools/settings/calibrations/arm.json
```

Ersetzen Sie die Beispiel-IDs durch Ihre; Lassen Sie `--ids` weg, um alle erkannten Motoren (bis zu sechs) zu verwenden. Für SO-101 und SO-102 siehe die [beschrifteten Referenzposenbilder](tools/settings/README.md#reference-pose-images). Der Befehl besteht aus zwei Schritten:

1. Platzieren Sie jedes ausgewählte Gelenk, einschließlich Handgelenksrolle und Greifer, in der Referenzposition des Mechanismus. Wählen Sie für ein neues Setup ohne eine wiederholbare Pose etwa in der Mitte der Bewegung jedes Gelenks. Halten Sie still und drücken Sie die **Eingabetaste**, um die Offsets zu speichern, sodass sie in dieser Pose 2048 anzeigen.
2. Bewegen Sie jedes ausgewählte Gelenk von Ende zu Ende und halten Sie an den Enden kurz inne. Sehen Sie sich die Live-Tabelle an und drücken Sie die **Eingabetaste**, um die Limits zu speichern.

Unterstützen Sie den Mechanismus durchgehend; Erzwingen Sie keine Stopps. Drehmoment bleibt ausgeschaltet. Die Datei wird automatisch aktualisiert und Motor-Backups bleiben erhalten. Wenn der zweite Schritt fehlschlägt, bleiben die Offsets des ersten Schritts gespeichert: Schließen Sie die Kalibrierung ab, bevor Sie die Bewegung aktivieren. Der gemessene Mittelpunkt ersetzt nicht die erfasste Referenz. 2048 ist nur eine Encoder-Referenz; Es legt keinen physikalischen Winkel für Simulation oder Schwerkraft fest. Siehe [Auswahl der Referenzpose](tools/settings/README.md#choose-the-reference-pose). Tun Sie dies, bevor Sie Posen aufzeichnen oder die Schwerkraftkompensation anpassen. Vorhandene Arme mit verifizierter Kalibrierung müssen nach einem settings-preserving Blitz nicht neu kalibriert werden.

<a id="4-check-communication"></a>
## 4. Kommunikation prüfen

Halten Sie das Drehmoment ausgeschaltet. Stellen Sie `--ids` auf die angeschlossenen Motoren ein.

```sh
npm test
npm run bus-benchmark -- --port "$SERVO_PORT" --ids 1 --repetitions 100
npm run telemetry -- --port "$SERVO_PORT" --ids 1 --samples 1000 --interval-ms 20 \
  --output tools/diagnostics/results/first-check
```

`npm test` ist offline. Die anderen Befehle lesen Hardware- und Druckberichtspfade. Verwenden Sie jedes Mal ein neues Telemetrie-Ausgabeverzeichnis. Passen Sie `--voltage-min` und `--voltage-max` an, wenn Ihre Versorgung außerhalb des standardmäßigen 8–16 V-Bereichs liegt. Überprüfen Sie Fehler und gemeldete Messwerte, bevor Sie Maßnahmen ergreifen. Befolgen Sie für factory/custom-Vergleiche den [Hardware-Testleitfaden](tools/hw-diff-tests/README.md): Die vollständige Suite bewegt Motoren und ersetzt gespeicherte Einstellungen und Reset-Vorlagen.

<a id="5-record-and-replay-poses"></a>
## 5. Posen aufzeichnen und wiedergeben

Stützen Sie den Mechanismus ab, bevor Sie das Drehmoment freigeben. Bewegen Sie es von Hand, geben Sie einen Namen zum Speichern jeder Pose ein und geben Sie dann `done` ein. Verwenden Sie alle erforderlichen Motor-IDs für einen Arm.

```sh
npm run record-poses -- --port "$SERVO_PORT" --ids 1
cp tools/poses/replay.example.json tools/poses/controller.local.json
```

Bearbeiten Sie `tools/poses/controller.local.json`: Stellen Sie `followerPort` ein, stellen Sie für jeden Motor einen `profiles`-Eintrag bereit und wählen Sie geeignete Verstärkungen, Kraftgrenzen, Geschwindigkeit und Beschleunigung. Beispielwerte dienen der Veranschaulichung. Das Beispiel verweist auf ein freigegebenes Profil. Kopieren Sie dieses Profil zu Ihrem eigenen Vorteil und aktualisieren Sie seinen Pfad oder fügen Sie Einstellungen inline ein. Pfade sind relativ zur Controller-Datei. Überprüfen Sie zunächst die gespeicherten Kalibrierungs- und Positionsgrenzen. Der Follower-Bus muss genau die konfigurierten Motoren enthalten. Replay verarbeitet angetriebene und nicht angetriebene Motoren und wendet geänderte Einstellungen automatisch an.

Ersetzen Sie `POSES.json` durch den gespeicherten Pfad des Rekorders:

```sh
npm run replay -- tools/poses/controller.local.json POSES.json
npm run replay -- tools/poses/controller.local.json POSES.json --run
```

Der erste Befehl zeigt eine Vorschau an; `--run` ermöglicht Bewegung. **Bei normaler Fertigstellung bleiben die Motoren angetrieben und halten das endgültige Ziel. Strg+C ist kein Notstopp.** Siehe [Wiedergabeeinstellungen](tools/poses/README.md#replay-poses).

Zum Vergleich mit den gespeicherten alten PID-Einstellungen der Motoren ohne Kompensation:

```sh
npm run replay-legacy -- POSES.json --port "$SERVO_PORT" --run
```

Es ist keine Controller-Datei erforderlich. Lassen Sie `--run` weg, um eine Vorschau von read-only zu erhalten. Informationen zu Geschwindigkeits- und Beschleunigungseinstellungen finden Sie unter [Legacy-Wiedergabe](tools/poses/README.md#legacy-replay)].

<a id="6-enable-gravity-compensation"></a>
## 6. Aktivieren Sie die Schwerkraftkompensation

Fügen Sie für `tools/poses/controller.local.json` dieses top-level-Feld hinzu:

```json
"gravityModel": "../../host/arm-control/models/arm-upright-empty.json"
```

Das mitgelieferte Modell ist für den kalibrierten, stehenden **SO-ARM-102 mit leerem Greifer**. Berücksichtigen Sie die Motoren 1–6 und alle sechs Profile. Motoren 2–4 erhalten eine Entschädigung; die anderen erhalten null. Die Encoderkalibrierung muss übereinstimmen; Bei geänderter Montage, Geometrie oder Nutzlast ist ein validiertes Modell erforderlich. Ändern Sie die Kalibrierung nicht nur, um eine Nichtübereinstimmung zu umgehen. Passen Sie für einen anderen Mechanismus oder eine andere Kalibrierung ein passendes Modell an und validieren Sie es.

[SO-101 und SO-102 Controller-Profile](host/arm-control/profiles/README.md) umfassen PID, Geschwindigkeits-Feedforward und passende Schwerkraftmodelle. Lesen Sie vor der Verwendung deren Einschränkungen. Sie sind an die Kalibrierung der montierten Arme gebunden.

Wiedergabe, Teleoperation und Tuning nutzen denselben Bereich. Die Schwerkraft folgt den gemessenen Positionen, während das Werkzeug läuft. Nach dem Ausstieg bleibt nur der letzte Aufwand erhalten. Die Modellanforderungen finden Sie im [Gravity Guide](host/arm-control/README.md)].

<a id="7-tune-and-view-motion"></a>
## 7. Stimmen Sie die Bewegung ab und betrachten Sie sie

Kopieren und bearbeiten Sie den [Tuning-Plan](../../../tools/tuning/example.json) und das [Controller-Beispiel](../../../tools/tuning/controller.example.json); Legen Sie den `config`-Pfad des Plans zu Ihrer Controller-Datei fest. Verwenden Sie beim ersten Lauf kleine sichere Bewegungen, `"stage": "baseline"` und `"candidates": []`.

```sh
npm run tune -- inspect PLAN.json
npm run tune -- preflight PLAN.json
npm run tune -- run PLAN.json
```

Nur `run` bewegt Hardware. Befolgen Sie die [Abstimmungsreihenfolge](tools/tuning/README.md#tuning-order): Basislinie → Schwerkraft → Geschwindigkeits-Feedforward → P/D und Filterung → Integral, falls erforderlich → acceleration/ramp Zeit → kombinierte Bewegung → Validierung.

Installieren Sie zur Visualisierung den [Simulationsviewer](tools/simulation/README.md) und verwenden Sie dann den von Replay oder Tuning ausgegebenen Pfad event-log:

```sh
tools/simulation/.venv/bin/python tools/simulation/viewer.py live EVENTS.ndjson --model so101
tools/simulation/.venv/bin/python tools/simulation/viewer.py play EVENTS.ndjson --model so101
```

Verwenden Sie `--model so102` für das andere Modell mit gebündeltem Arm. Überprüfen Sie die reference-pose-Konvention im Viewer-Handbuch. Der Befehl verarbeitet den macOS-Fensterstarter automatisch. Der Betrachter zeigt gemessene Bewegungen an; Es werden keine Optimierungsergebnisse vorhergesagt. Informationen zur hand-operated-Steuerung mit separaten Leader- und Follower-Adaptern finden Sie unter [Teleoperation](tools/teleoperation/README.md).
<!-- /translated-content -->
