<!-- translation-navigation -->
[English](../../../en/tools/poses/README.md) · [Русский](../../../ru/tools/poses/README.md) · [Español](../../../es/tools/poses/README.md) · [Français](../../../fr/tools/poses/README.md) · [Deutsch](README.md) · [Português (Brasil)](../../../pt-BR/tools/poses/README.md) · [简体中文](../../../zh-CN/tools/poses/README.md) · [日本語](../../../ja/tools/poses/README.md) · [हिन्दी](../../../hi/tools/poses/README.md) · [العربية](../../../ar/tools/poses/README.md)

[Englisches Original](../../../../../tools/poses/README.md)

> Vollständige maschinelle Übersetzung, noch nicht von Muttersprachlern geprüft. Bilder und Videos werden gemeinsam verwendet; enthaltene Texte bleiben in der Originalsprache.
<!-- /translation-navigation -->

<!-- translated-content -->
<a id="record-and-replay-poses"></a>
# Aufnahme und Wiedergabe von Posen

Nehmen Sie benannte Positionen mit Drehmoment aus, dann wiederholen Sie sie mit entweder gespeicherten Legacy-Einstellungen oder abgestimmten Erweiterungseinstellungen. Befehle laufen von der Projektarchiv-root.

| Befehl | Eingabe | Firmware |
| --- | --- | --- |
| `npm run record-poses` | Manuelle Positionierung | Fabrik oder Brauch |
| `npm run replay` | Benannte Posen oder eine Teleoperationssitzung | Erweiterung v9 |
| `npm run replay-legacy` | Genannte Posen | Fabrik oder benutzerdefinierte v9 |

<a id="record-poses"></a>
## Aufzeichnungspositionen

Installieren Sie Node.js 20 oder neuer, dann laufen Sie von der Projektarchiv-root:

```sh
npm install
npm run record-poses -- --port /dev/ttyUSB0 --ids 1,2,3
```

Ersetzen Sie den Port und die IDs für Ihr Setup. Optionale Flags sind `--baud` (Standard 1000000), `--output DIR` und `--timeout-ms` (Standard 1000).

Beenden [Offset- und Limitkalibrierung](../settings/README.md#calibrate-joint-offsets-and-limits) zuerst. Aufgezeichnete Posen sind Bewegungspunkte; die Aufnahme einer Pose namens `home` oder `reference` ändert die Motorkalibrierung nicht.

1. Unterstützen Sie den Mechanismus, so dass er nicht fallen kann, wenn das Drehmoment freigesetzt wird.
2. Drücken Sie Enter an der Bestätigungsaufforderung. Der Recorder deaktiviert das Drehmoment an den ausgewählten Motoren und überprüft es ist aus. Andere Motoren werden nicht geändert.
3. Bewegen Sie den Mechanismus, halten Sie ihn still, dann drücken Sie Enter, um eine Pose zu erfassen. Sie können stattdessen einen eindeutigen Namen eingeben; unbenannte Posen werden `position-1`, `position-2`, etc.
4. Wiederholen Sie, wie nötig. Geben Sie `done` zu beenden oder drücken Sie Strg+C zu unterbrechen.

Das Drehmoment bleibt nach der Aufnahme aus. Liesungen sind sequentiell, so dass jede Pose ein Momentaufnahme eines stationären Mechanismus ist, nicht eine synchronisierte Bewegungsmessung. Ein fehlendes Lesen, Alarmieren oder aktivierter Motor stoppt die Sitzung. Beim Ausgang versucht das Werkzeug, das Drehmoment erneut zu deaktivieren und meldet jede fehlgeschlagene Überprüfung.

<a id="saved-files"></a>
## Gespeicherte Dateien

Eine neue JSON-Datei wird in `tools/poses/recordings/` für jede Sitzung erstellt. Jede erfolgreiche Aufnahme ersetzt diese Datei atomar; frühere gespeicherte Posen bleiben verfügbar, wenn eine spätere Aufnahme fehlschlägt. Aufnahmen werden von Git ignoriert.

Das `sts-poses`-Version 1-Format identifiziert Positionen durch Motor ID, nicht Array-Ordnung:

```json
{
  "format": "sts-poses",
  "version": 1,
  "units": "encoder-counts",
  "ids": [1, 3],
  "readMode": "sequential",
  "poses": [
    {
      "name": "home",
      "capturedAt": "2026-10-24T12:00:00.000Z",
      "durationMs": 4.2,
      "positions": {"1": 2048, "3": 3100}
    }
  ]
}
```

Zu den Dateien gehören auch Sitzungszeit, serieller Port und Baudrate. Pose-Timestamps-Markierung beim Lesen beginnt; `durationMs` misst die vollständige Erfassung. Zählungen sind gemeldete Positionen, bereits einschließlich der Motor Offset- und Richtungseinstellung, ohne Konvertierung in Winkel. Die Datei hat keine Geschwindigkeit, Beschleunigung oder Wiedergabe Timing-Einstellungen, und keine Kalibrierung Snapshot. Re-record posiert nach Änderung der Encoder-Kalibrierung; Replay kann nicht erkennen, dass eine alte Pose-Datei verschiedene Offsets verwendet.

<a id="replay-poses"></a>
## Posen wiederholen

Kopieren Sie [replay.example.json](../../../../../tools/poses/replay.example.json) neben dem Original, z.B. als `tools/poses/controller.local.json`. Setzen Sie `followerPort` und stellen Sie einen `profiles`-Eintrag pro aufgezeichneten Motor zur Verfügung. IDs stammen aus der Aufnahme; es wird kein Leader oder Joint Mapping benötigt. Das Beispiel verweist auf das freigegebene [Motorprofil](../../../../../host/arm-control/profile.example.json). Kopieren Sie dieses Profil für Ihre eigenen Einstellungen und aktualisieren Sie seinen Pfad oder setzen Sie die Einstellungen inline. Alle Profil- und Gravitationspfade sind relativ zur Controllerdatei. Beispielgewinne veranschaulichen das Format; verwenden Sie Einstellungen, die auf Ihrem Mechanismus getestet wurden.

```sh
npm run replay -- CONFIG.json POSES.json
npm run replay -- CONFIG.json POSES.json --run
```

Der erste Befehl sieht den vollständigen Pfad ohne Änderung der Einstellungen vor und meldet Ziele, die auf gespeicherte Grenzen begrenzt sind. `--run` startet Bewegung, einschließlich des Ansatzes von der aktuellen Position zur ersten Pose. Es wird nur der Follower-Port geöffnet. Dateien bis zu 64 MiB werden akzeptiert und validiert, bevor ein Port geöffnet wird.

Der [shared controller](../../host/arm-control/README.md) wendet Profile an, verarbeitet vorhandene Powered Sessions und liefert eine Gravitationskompensation, wenn `gravityModel` konfiguriert ist. **Normale Fertigstellung und Strg+C behalten einen Powered Hold.** Fehler verwenden die Bereinigung des Controllers; Strg+C ist kein Notfallstopp. Optional beendet top-level `durationMs` die Wiedergabe frühzeitig; es wird nicht mehr die gesamte Datei wiedergegeben.

Jede Pose wird in einem Gruppenbefehl gesendet. Gemeinsame Geschwindigkeitsskala mit Reisedistanz, abhängig von der Wiederholungsgeschwindigkeit und der Geschwindigkeitsbegrenzung jedes Motors. Jeder Motor erzeugt seinen eigenen S-curve, so dass Ankunft ungefähr ist und Wegpunkte nicht gemischt werden. Playback wartet darauf, dass die Planer beenden und alle gemessenen Positionen, um `toleranceCounts` eingeben, dann startet den Halt. Eine Bewegung über `moveTimeoutMs` fehlschlägt. Manuell aufgezeichnete Zeitstempel setzen keine Wiedergabegeschwindigkeit.

| Einstellung `replay` | Vorgabe | Bedeutung |
| --- | --- | --- |
| `speed` | 1000 | Maximale Geschwindigkeit, 1–65535 Encoder counts/s. |
| `holdMs` | 1000 | Pause nach der Ankunft, 0–600000 ms. |
| `repeat` | 1 | Anzahl der Pässe, 1–1000; jeder Pässe kehrt zur ersten Pose zurück. |
| `moveTimeoutMs` | 30000 | Ankunftszeitpunkt, 1–600000 ms. |
| `toleranceCounts` | 10 | Zulässiger Messpositionsfehler, 0–32767 zählt. |

<a id="replay-a-recorded-session"></a>
## Eine aufgezeichnete Sitzung erneut abspielen

Wiedergabe eines Teleoperationsprotokolls, ohne den Leader zu verbinden:

```sh
npm run replay -- CONFIG.json SESSION.ndjson
npm run replay -- CONFIG.json SESSION.ndjson --run
```

Die Aufnahme muss ein `preflight` mit Leader Limits und Joint Mapping enthalten, gefolgt von `command`-Ereignissen mit monotonen Zeitstempeln und allen Leader-Positionen. Verwenden Sie dasselbe Joint Mapping in der aktuellen Konfiguration. Aufgezeichnete Leader-Positionen werden über die aufgezeichneten Leader Limits und die aktuellen Limits des Followers gemappt. Aktuelle Profile und Schwerkraft werden angewendet; historische Einstellungen und Bemühungen werden nicht wiederverwendet. Ein beabsichtigter Befehl in einem fehlgeschlagenen Log kann nie die Motoren erreicht haben.

Playback bewahrt aufgezeichnete Lücken; Verarbeitung verzögert das Dehnungszeitalter, anstatt catch-up Bursts zu senden. Feedback und Gravitationsupdates werden während der Pausen fortgesetzt. `replay.repeat`, `moveTimeoutMs` und `toleranceCounts` gelten; `speed` und `holdMs` gelten nur für benannte Posen. Der letzte Frame muss vor der Fertigstellung ankommen.

<a id="legacy-replay"></a>
## Vermächtnis-Wiedergabe

Verwenden Sie die gespeicherten PID-Einstellungen der Motoren ohne Erweiterung Geschwindigkeitsvorschub oder Gravitationskompensation. Es wird keine Controllerdatei benötigt und die permanenten Einstellungen sind unverändert.

```sh
npm run replay-legacy -- POSES.json --port /dev/ttyUSB0
npm run replay-legacy -- POSES.json --port /dev/ttyUSB0 --run
```

Die erste Befehlsvorschau; `--run` bewegt sich. IDs kommen aus der Pose-Datei; andere Motoren auf dem Adapter sind allein gelassen. Benutzerdefinierte Firmware schaltet in den Legacy-Modus. Setup kurz deaktiviert und re-enables jeder ausgewählte Motor, Samen seiner aktuellen Position zuerst.

| Option | Vorgabe | Bedeutung |
| --- | --- | --- |
| `--speed` | 1000 | Maximale Geschwindigkeit, 1–32767 Encoder counts/s. |
| `--acceleration` | 5000 | Counts/s², 100–25400 in Vielfachen von 100. Es gelten gespeicherte Grenzwerte. |
| `--hold-ms` | 1000 | Halten Sie nach jedem geplanten Zug, 0–600000 ms. |
| `--baud` | 1000000 | Adapterbaudrate. |

Jede Pose verwendet einen Gruppenbefehl und distance-scaled Geschwindigkeiten für ungefähr simultane Ankunft. Ziele werden auf gespeicherte Positionslimits begrenzt. Playback wartet auf interne Bewegungsprofile zu beenden, dann hält; es erfordert keine Null gemessenen Positionsfehler. Eine Bewegung über 30 Sekunden dauert nicht.

Die Fertigstellung behält das Drehmoment an der letzten Pose. Im Gegensatz zu der Wiederholung der Erweiterung versucht **Strg+C torque-off**, ebenso wie Fehler.

<a id="logs-and-visualization"></a>
## Protokolle und Visualisierung

Beide Wiedergabebefehle speichern Protokolle in ignorierten `logs/motion/`, einschließlich Kalibrierung, Quellidentität, Befehle und Feedback. Starten Sie den [Telemetrie-Viewer](../simulation/README.md) einmal und führen Sie Wiederholungen in einem anderen Terminal aus:

```sh
mkdir -p logs/motion
tools/simulation/.venv/bin/python tools/simulation/viewer.py live logs/motion --model so102
```

Verwenden Sie `--model so101` für das andere gebündelte Modell und ein passendes Encoder-Mapping. Verlängerungsreplay liest detailliertes Feedback für die bewegte Referenz, die vom Betrachter angezeigt wird. Um den Datenverkehr zu reduzieren, fügen Sie `--compact`; gemessene Bewegung und Kompensation bleiben aktiv, aber der Schatten zeigt Ziele anstelle von Zwischenplanerpositionen. PID Begriffe und angewandte Kompensationsbeiträge werden ebenfalls weggelassen. Siehe [Feedback und Timing](../../host/arm-control/README.md#checks-and-timing).

Führen Sie Offline-Aufnahmen, Verlängerungsreplay und Legacy-Replay-Tests mit `npm run test:poses` aus.
<!-- /translated-content -->
