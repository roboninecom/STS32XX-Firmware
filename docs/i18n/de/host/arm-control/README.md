<!-- translation-navigation -->
[English](../../../en/host/arm-control/README.md) · [Русский](../../../ru/host/arm-control/README.md) · [Español](../../../es/host/arm-control/README.md) · [Français](../../../fr/host/arm-control/README.md) · [Deutsch](README.md) · [Português (Brasil)](../../../pt-BR/host/arm-control/README.md) · [简体中文](../../../zh-CN/host/arm-control/README.md) · [日本語](../../../ja/host/arm-control/README.md) · [हिन्दी](../../../hi/host/arm-control/README.md) · [العربية](../../../ar/host/arm-control/README.md)

[Englisches Original](../../../../../host/arm-control/README.md)

> Vollständige maschinelle Übersetzung, noch nicht von Muttersprachlern geprüft. Bilder und Videos werden gemeinsam verwendet; enthaltene Texte bleiben in der Originalsprache.
<!-- /translation-navigation -->

<!-- translated-content -->
<a id="shared-arm-controller-and-gravity-compensation"></a>
# Gemeinsame Armsteuerung und Schwerkraftkompensation

Live-Teleoperation, Tuning, named-pose-Wiedergabe und timed-session-Wiedergabe verwenden einen Follower-Controller. Es kümmert sich um Einrichtung, Ziele, gemessenes Feedback, Schwerkraft und Aufräumen. Der [Servotreiber](../servo-driver/README.md) ist für die Paketkodierung und den Transport zuständig.

<a id="motor-settings-files"></a>
## Motoreinstellungsdateien

Referenzeinstellungen und deren Betriebsgrenzen finden Sie in den Profilen [SO-101 und SO-102](profiles/README.md).

`profiles` kann Inline-Einstellungen oder Pfade relativ zur Controller-Datei enthalten:

```json
"profiles": {"1": "motor-1.json", "2": "motor-2.json"}
```

Das [Beispielprofil](../../../../../host/arm-control/profile.example.json) wird von den Werkzeugbeispielen gemeinsam genutzt. Kopieren Sie es für Ihre eigenen Einstellungen und aktualisieren Sie die Referenz oder integrieren Sie das Profil. Wenn Sie eine Controller-Datei verschieben, passen Sie deren Profil und Schwerkraftpfade an. Dateien mit dem Namen `*.local.json` werden von Git ignoriert.

Stellen Sie `acceleration` in counts/s² (1–30000) und `rampTimeMs` in Millisekunden (1–255) am Controller ein. Jeder Motor kann diese mit `accelerationLimit` und `rampTimeMs` in seinem Profil überschreiben. Profile sind Erweiterungs-RAM-Einstellungen; Gespeicherte Encoder-Offsets und Verfahrgrenzen bleiben getrennt.

| Profilfeld | Bedeutung |
| --- | --- |
| `kpQ8`, `kdQ8`, `kiQ8` | Controller-Gewinne multipliziert mit 256. |
| `integralLimit`, `effortLimit` | Integrale und Gesamtleistungsgrenzen in PWM Aufwandseinheiten. |
| `velocityLimit` | Höchstgeschwindigkeit in counts/s; Der Standardwert ist 65535. |
| `velocityFilterQ8` | Gemessene Geschwindigkeitsfiltereinstellung, 1–255. |
| `gravitySlewEffortPerS` | Geschwindigkeitsbegrenzung für Änderungen der Schwerkraftanstrengung. |
| `velocityFeedforward` | `positiveGainQ8`, `negativeGainQ8`, `effortLimit`; Alle drei auf Null setzen, um sie zu deaktivieren. |

Vollständige Einheiten und Bereiche finden Sie im [Firmware-Registerhandbuch](../../DETAILED_DOCUMENTATION.md#configuration--0xa0)]. Dies sind per-motor Einstellungen, keine umschaltbaren Firmware-Profile.

Verwendung der Tuning- und Einstellungsanwendung `joints: [{ "followerId": 1 }]`; Fügen Sie einen Eintrag pro gesteuertem Motor hinzu. Named-pose Replay erhält IDs aus der Aufnahme und benötigt kein `joints` Array. Nur Live-Teleoperation und recorded-leader Wiedergabe benötigen `leaderId`, `mapping` und optional direction/centers; siehe [Teleoperations-Mapping](../../tools/teleoperation/README.md#mapping-and-control).

<a id="enable-gravity"></a>
## Aktivieren Sie die Schwerkraft

Fügen Sie `gravityModel` zu Ihrer bestehenden Konfiguration hinzu. Pfade beziehen sich auf die **Konfigurationsdatei**, nicht auf das Arbeitsverzeichnis. Für eine im Repository-Stammverzeichnis gespeicherte Konfiguration:

```json
"gravityModel": "host/arm-control/models/arm-upright-empty.json"
```

Diese Zeile ist eine Ergänzung zu einer vollständigen Konfiguration und keine eigenständige Datei. Stellen Sie für jeden Follower getestete `profiles` bereit; `effortLimit` begrenzt die gesamte Motorleistung und `gravitySlewEffortPerS` begrenzt, wie schnell sich die Schwerkraftkraft ändert. Die Einstellung der Schwenkung allein ermöglicht keine Schwerkraft. Ohne `gravityModel` löscht die Wiederholung alle verbleibenden Schwerkraftanstrengungen und läuft dann ohne Schwerkraftkompensation.

Die mitgelieferten [Armmodelle](models/README.md) bewahren die Kalibrierung jedes einzelnen Pfostens, empty-gripper Arms. Ihre Koeffizienten für Motoren 2–4 verwenden gemessene Encoderzahlen, einschließlich gekoppelter Gelenke; Motoren 1, 5 und 6 verwenden explizit Null. Jeder kontrollierte Anhänger benötigt ein Modell, und alle in seinen Begriffen verwendeten Gelenke müssen kontrolliert und gemessen werden. Angle-dependent-Modelle deklarieren außerdem `encoderCalibration` für jeden Eingang: signiert `positionCorrection`, `resolution: 1` und `reverse` (das Encoder-Umkehrflag). Preflight vergleicht diese mit den Motorregistern und weist eine Nichtübereinstimmung vor dem Setup oder der Drehmomentfreigabe zurück. Stellen Sie ein passendes Backup von demselben Arm wieder her oder aktualisieren und validieren Sie das Modell nach der Neukalibrierung. Eine Referenzerfassung bei 2048 bestimmt nicht selbst die physischen Winkel des Modells; siehe die [Kalibrierungsanleitung](../../tools/settings/README.md#choose-the-reference-pose). Geben Sie für jedes der mitgelieferten six-motor-Modelle die IDs 1–6 und alle sechs Profile an. Verwenden Sie das Modell nicht wieder, nachdem Sie Encoder-Offsets, Montage, Geometrie oder Nutzlast geändert haben, ohne die Kalibrierung zu überprüfen.

Verwenden Sie für jeden Befehl dasselbe Konfigurationsfeld:

```sh
npm run teleoperate -- CONFIG.json
npm run replay -- CONFIG.json POSES.json
npm run replay -- CONFIG.json SESSION.ndjson
```

Diese Befehle dienen nur zur Vorschau. Fügen Sie `--run` hinzu, um die Steuerung zu starten. Aktuelle Konfiguration und gemessene Follower-Positionen bestimmen die Schwerkraft; Aufgezeichnete Schwerkraftwerte und historische Gewinne werden niemals wiedergegeben. Das Modell wird vor der Verwendung validiert und sein Pfad und SHA-256-Hash werden in das Sitzungsprotokoll aufgenommen.

<a id="control-behaviour"></a>
## Kontrollverhalten

1. Preflight prüft Firmware, gespeicherte Grenzwerte, Zustand, Profile und Modelleingaben.
2. Alle Controller-Tools setzen eine kompatible Sitzung fort oder bereiten automatisch eine neue vor. Passende Profile halten das Drehmoment aufrecht; Geänderte Profile werden jeweils für einen Motor angewendet. Das neue Setup übernimmt die Drehmomentfreigabe, Konfiguration und Auswahl und aktiviert dann alle vorbereiteten Motoren gemeinsam.
3. Die Schwerkraft wird vor dem ersten Bewegungsziel gemessen, gesendet und bestätigt.
4. Bei Bewegung und Pausen liefert ein Feedback-Durchgang sowohl Gesundheitschecks als auch Schwerkraftberechnungen. Die Schwerkraft wird ungefähr alle 50 ms aktualisiert. Es gibt keinen zweiten Telemetrieleser oder eine Host-Geschwindigkeits-Feedforward-Schleife.
5. Bei einem normalen Ausstieg setzt sich die Schwerkraft während der letzten Bewegung und der verbleibenden Schwerkraftschwenkung der Firmware fort. Der Controller wartet 200 ms Ruhezeit mit einem Abschluss-Timeout von 30 s und bestätigt dann die endgültige Schwerkraftaktualisierung. Drehmoment bleibt bestehen; Die Firmware behält das letzte Ziel und die Schwerkraftanstrengung bei.

Für Wiedergabe und Teleoperation stoppt Strg+C neue Ziele und folgt der gleichen Abschlusssequenz. Stattdessen unterbricht das Tuning den Batch und versucht torque-off. Strg+C ist kein Notstopp. Ruhe bedeutet, dass die Planer angehalten haben und jede gemessene Position über das gesamte Intervall von 200 ms innerhalb eines Bereichs von one-count bleibt. Es beweist nicht, dass der Tracking-Error null ist; pose/session Replay wendet auch die konfigurierte Ankunftstoleranz an.

Der Prozess stoppt die Erneuerung der Schwerkraft nach dem Verlassen. Wird der Arm anschließend bewegt oder ändert sich seine Belastung, passt sich die zurückgehaltene Kraft nicht an. Ein abgebrochener Prozess oder ein getrennter Bus können auch dazu führen, dass das letzte Ziel und der letzte Aufwand aktiv bleiben.

<a id="checks-and-timing"></a>
## Kontrollen und Timing

Die Schwerkraft verwendet gemessene Follower-Positionen, niemals angeforderte Ziele. Eine Feedback-Probe muss gesund und frisch sein und zur aktuellen Sitzung gehören. Jedes Schwerkraft-Update hat seine eigene Reihenfolge; Die Akzeptanz wird im nächsten Feedbackdurchlauf überprüft. Alle Ergebnisse werden vor dem Schreiben anhand der Modell- und Motorleistungsgrenzen überprüft. Ein überhöhtes Ergebnis ist ein Fehler und kein abgeschnittener Wert.

Gekoppelte Messungen erfolgen sequentiell. Erfassung, Warteschlange und nachfolgende Schreibvorgänge müssen innerhalb von 100 ms nach Beginn ihres Feedback-Durchlaufs liegen. Auch die nächste Aktualisierung muss innerhalb dieser Grenze erfolgen; Ein verzögerter Leser, Logger oder Bus führt zu einem Ausfall, anstatt stillschweigend mit der alten Schwerkraft weiterzumachen. Hierbei handelt es sich um Hostprüfungen, nicht um Firmware-Timeouts. Asynchron I/O kann die Erkennung verzögern; Sie machen den Host nicht zu einem real-time Controller.

Live-Gesundheitsprüfungen werden ungefähr alle 250 ms ohne Schwerkraft oder alle 50 ms mit ihr durchgeführt. Bei der Wiedergabe wird bei Haltevorgängen und zeitgesteuerter Wiedergabe alle 50 ms ein detailliertes C2-Feedback verwendet; Ankunftskontrollen können schneller abfragen. `--compact` ersetzt kleinere C1-Pakete, die Zwischenplanpositionen und PID-Beiträge weglassen. Die Optimierung liest beim Start detailliertes Feedback für alle Motoren, dann C2 für die Sonde und C1 für unterstützende Motoren. Feedback teilt immer den Schwerkraftleser.

Modellfehler, abgelehnte Aktualisierungen, missing/stale Feedback, verlorener Besitz, Alarme und Temperaturen bei oder über 60 °C-Versuch verifiziert torque-off bei jedem vorbereiteten Follower. Bereinigungsfehler werden gemeldet.

Eine Ausnahme ist eine verpasste gravity-update-Frist während eines etablierten Haltevorgangs: Die Steuerung behält das Drehmoment nur dann bei, wenn zwei neue Feedback-Durchläufe in derselben Sitzung gesunde, stationäre Motoren bestätigen. Der Lauf schlägt immer noch fehl und meldet `holdRetained: true`; es wird nicht automatisch fortgesetzt.

Telemetrieprotokollaufzeichnungen umfassen gemessene Rückmeldungen und die zuletzt angeforderte Schwerkraft effort/sequence. Das Firmware-Feedback bestätigt diese Anfrage bei einem späteren Muster. Eine protokollierte Anfrage allein ist kein Beweis der Annahme. `settledAt` ist eine konservative Host-Schätzung, wann der angeforderte Schwerkraftschwenk abgeschlossen sein kann.

<a id="api-and-tests"></a>
## API und Tests

`session.run` verwaltet serielle Verbindungen, Sitzungsprotokolle und Bereinigung für eine Eingabequelle. `ArmController` akzeptiert einen Follower-Treiber, eine Konfiguration, eine Eingabequelle und eine optionale `GravityModel`-Instanz. Laden Sie Modelle mit `await GravityModel.load(filename)`; Die CLI löst den configuration-relative-Pfad auf. Eingabequellen bieten `joints`, `preflight`, `describe`, `sample` und `play`; Bei der Live-Eingabe wird zusätzlich überprüft, ob der Anführer stromlos ist. Automatisiertes Tuning kann über dasselbe Lesegerät detailliertes Feedback für seinen Sondenmotor anfordern. `changeProfile` überprüft die stationäre Steuerung, gibt nur diesen Motor frei, konfiguriert und re-enables ihn und bestätigt dann erneut die Schwerkraft. Unterstützende Motoren bleiben mit Strom versorgt. Der geänderte Motor verliert kurzzeitig Drehmoment und nimmt beim Neustart seine gemessene Position ein; Verwenden Sie für Profiländerungen eine unterstützte oder mechanisch sichere Haltung. Profilfehler verwenden die normale all-motor Fehlerbereinigung.

Quellen übermitteln Positionen über den Controller und nutzen dessen gewartete Wartezeiten, sodass lange Pausen weiterhin Feedback-Updates erfordern.

Führen Sie `npm run test:arm` für den gemeinsam genutzten Controller, `npm run test:poses` für recording/replay und `npm run test:teleoperation` für die Live-Steuerung aus. Tests verwenden simulierte serielle Antworten.
<!-- /translated-content -->
