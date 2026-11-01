<!-- translation-navigation -->
[English](../../../en/tools/teleoperation/README.md) · [Русский](../../../ru/tools/teleoperation/README.md) · [Español](../../../es/tools/teleoperation/README.md) · [Français](../../../fr/tools/teleoperation/README.md) · [Deutsch](README.md) · [Português (Brasil)](../../../pt-BR/tools/teleoperation/README.md) · [简体中文](../../../zh-CN/tools/teleoperation/README.md) · [日本語](../../../ja/tools/teleoperation/README.md) · [हिन्दी](../../../hi/tools/teleoperation/README.md) · [العربية](../../../ar/tools/teleoperation/README.md)

[Englisches Original](../../../../../tools/teleoperation/README.md)

> Vollständige maschinelle Übersetzung, noch nicht von Muttersprachlern geprüft. Bilder und Videos werden gemeinsam verwendet; enthaltene Texte bleiben in der Originalsprache.
<!-- /translation-navigation -->

<!-- translated-content -->
<a id="teleoperation"></a>
# Telearbeit

Bewegen Sie einen angetriebenen Follower, indem Sie einen unpowered Führer von Hand bewegen. Unterstützt 1–6-Gelenkpaare auf zwei separaten seriellen Bussen. Der Führer kann Fabrikfirmware verwenden; der Follower benötigt die v9-Firmware dieses Projektarchivs.

<a id="run"></a>
## Ausführen

Installieren Sie Node.js 20 oder neuer, dann führen Sie `npm install` aus dem Repository-root aus. Kopieren Sie [Beispiel.json](../../../../../tools/teleoperation/example.json) neben dem Original als `controller.local.json`. Legen Sie die Ports, Baudrate und gemeinsame IDs fest. Das Beispiel teilt das [Motorprofil](../../../../../host/arm-control/profile.example.json) mit Wiedergabe und Tuning. Kopieren Sie es für Ihre eigenen Einstellungen und aktualisieren Sie seinen Pfad, oder inlineieren Sie Ihre Profile. Pfade sind relativ zur Controller-Datei. Beispielgewinne illustrieren das Format; verwenden Sie Einstellungen auf Ihrem Mechanismus getestet.

Vorschau auf das Mapping ohne Änderung der Motoreinstellungen:

```sh
npm run teleoperate -- CONFIG.json
```

Überprüfen Sie die gemeldeten Positionen und Ziele, unterstützen beide Mechanismen, und lassen Sie Raum für den Follower auf die Pose des Führers zu bewegen. Starten Sie die Kontrolle ausdrücklich:

```sh
npm run teleoperate -- CONFIG.json --run
```

Jeder Bus muss genau seine konfigurierten IDs enthalten. Beide Mechanismen müssen gespeichert werden, nichtleere Positionsgrenzen und gewöhnlicher Positionsmodus mit Einheitsauflösung. Follower-Einstellungen müssen gesperrt werden, ohne aufgeschoben zu schreiben. Leader Drehmoment muss bereits aus sein; dieses Tool schreibt nie an den Führer. Follower Startgriffe angetrieben und unpowered Motoren automatisch.

Läuft bis Strg+C weiter, es sei denn, Sie setzen `durationMs` explizit ein. **Normal Exit behält einen Powered Hold.** Start, Schwerkraft und Fehlerbereinigung folgen dem [shared Controller Verhalten](../../host/arm-control/README.md#control-behaviour).

<a id="mapping-and-control"></a>
## Mapping und Kontrolle

Jeder `joints`-Eintrag enthält `leaderId`, `followerId` und `mapping`:

| Einstellung | Bedeutung |
| --- | --- |
| `mapping: "angle"` | Verdrängung des Encoders aus der Mitte der gespeicherten Grenzen. |
| `mapping: "range"` | Skalieren Sie jede Hälfte der Reise des Führers zur entsprechenden Folgehälfte. Nützlich für Greifer. |
| `direction` | `1` (Standard) oder `-1` zur Umkehrung der Bewegung. |
| `leaderMiddle`, `followerMiddle` | Optionale Zentren für Range Mapping, streng innerhalb der jeweiligen Grenzen. |

Die Ziele werden an die gespeicherten Grenzen des Followers gedeckelt. `angle` arbeitet in Encoder-Zahlen, so dass es von kompatiblen Encoder-Skalen und Getrieben ausgeht.

Das Mapping-Center ist der Mittelpunkt der gespeicherten Limits, die sich von der Kalibrierreferenz bei 2048 unterscheiden können. Die Matching-Kalibrierung stellt allein deshalb keine passenden Targets sicher, wenn Leader- und Follower-Limits asymmetrisch sind. Vorschau des Mappings vor dem Umzug. `leaderMiddle` und `followerMiddle` Override Centers nur für `range` Mapping.

Geben Sie ein Profil für jeden Follower und freigegebene acceleration/ramp-Einstellungen wie in [Motoreinstellungen](../../host/arm-control/README.md#motor-settings-files) beschrieben. `gravityModel` hinzufügen, um [Schwerkraftkompensation](../../host/arm-control/README.md#enable-gravity) zu aktivieren.

<a id="timing-and-checks"></a>
## Zeitplan und Kontrollen

| Optionale Einstellung | Vorgabe | Bedeutung |
| --- | --- | --- |
| `hz` | 60 | Gewünschte Updaterate, 1–60 Hz. Verpasste Perioden sind übersprungen. |
| `maxAgeMs` | 100 | Maximales Alter eines Führungsrahmens vor dem Senden, 10–10000 ms. |
| `responseTimeoutMs` | 100 | Ansprech- und Transaktionsqueue-Timeout, 25–10000 ms. |
| `durationMs` | Unbegrenzt | Laufzeit einschließlich Steuerungsstart, 1–86400000 ms. |

Jeder Frame muss jede Führungsposition enthalten und bleibt bis zum Senden innerhalb von `maxAgeMs`. Verpasste Update-Perioden werden übersprungen. Feedback, Schwerkraft und Protokollierung teilen die Regelschleife; die erreichte Geschwindigkeit hängt von der Bus- und Computerleistung ab. Siehe [geteilte Checks und Timing](../../host/arm-control/README.md#checks-and-timing).

Protokolle werden in ignorierten `logs/motion/` als newline-delimited JSON gespeichert. Sie enthalten Konfiguration, die gewählte Sitzung ID, Vorschau, beabsichtigte Befehle, gesendete Frames, Feedback und stop/error Datensätze. Ein Befehl Datensatz allein beweist nicht, ein Ziel gesendet oder akzeptiert wurde. Schreiben werden erwartet, ohne eine ungebundene Log Warteschlange anzusammeln; langsame Protokollierung kann die frame-age Überprüfung auslösen.

Protokolle ohne einen angeschlossenen Führer mit dem Befehl [recorded-session replay](../poses/README.md#replay-a-recorded-session).

Führen Sie Offline-Tests mit `npm run test:teleoperation`.
<!-- /translated-content -->
