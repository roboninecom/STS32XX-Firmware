<!-- translation-navigation -->
[English](../../../en/tools/tuning/README.md) · [Русский](../../../ru/tools/tuning/README.md) · [Español](../../../es/tools/tuning/README.md) · [Français](../../../fr/tools/tuning/README.md) · [Deutsch](README.md) · [Português (Brasil)](../../../pt-BR/tools/tuning/README.md) · [简体中文](../../../zh-CN/tools/tuning/README.md) · [日本語](../../../ja/tools/tuning/README.md) · [हिन्दी](../../../hi/tools/tuning/README.md) · [العربية](../../../ar/tools/tuning/README.md)

[Englisches Original](../../../../../tools/tuning/README.md)

> Vollständige maschinelle Übersetzung, noch nicht von Muttersprachlern geprüft. Bilder und Videos werden gemeinsam verwendet; enthaltene Texte bleiben in der Originalsprache.
<!-- /translation-navigation -->

<!-- translated-content -->
<a id="automated-tuning"></a>
# Automatisierte Abstimmung

Führen Sie eine begrenzte Stapel von Kandidateneinstellungen, vergleichen Sie wiederholte Züge und länger hält, und erhalten Sie eine machine-readable Empfehlung. Verwendet den gleichen v9 Treiber, Controller und kalibrierte Gravitationsmodell als Wiedergabe und Teleoperation. Keine Einstellungen werden auf EEPROM geschrieben und kein Gewinnerkandidat wird automatisch installiert.

<a id="start"></a>
## Starten

Installieren Sie Node.js aus dem Repository Root 20+ Abhängigkeiten mit `npm install`Kopieren `controller.example.json` und `example.json` neben den Originalen als `controller.local.json` und `plan.local.json`. Legen Sie den Plan fest `config` zu `controller.local.json`, dann bearbeiten Sie den Port, Motor-IDs, Profile, sichere gemeinsame Reisepaare und Grenzen für Ihren Mechanismus. Beispiel Gewinne und Posen sind illustrativ. [Motorprofil](../../../../../host/arm-control/profile.example.json); Kopieren Sie es für Ihre eigenen Einstellungen und aktualisieren Sie seinen Pfad, oder inline das Profil. `{ "followerId": ID }` im `joints`; keine Leader Mapping erforderlich. Komplett [Kalibrierung](../settings/README.md#choose-the-reference-pose) vor der Auswahl von Testpositionen. Positionen verwenden korrigierte Encoder-Zahlen; ein neuer Offset ändert ihre physikalische Bedeutung. Aktualisieren Sie Testpaare, Aufzeichnungen und das Gravitationsmodell nach der Rekalibrierung. Für die Schwerkraft, addieren `gravityModel` genau wie im [Leitfaden für den gemeinsamen Controller](../../host/arm-control/README.md).

Der `config`-Pfad des Plans ist relativ zum Plan. Das Profil des Controllers und die `gravityModel`-Pfaden sind relativ zu dieser Controllerdatei. Die gleiche Controllerkonfiguration kann für Pose-Wiedergabe verwendet werden. Omit `durationMs` zum Tuning: Der Plan besitzt das Batch-Budget. Sichern Sie den Mechanismus für Start- und Profiländerungen. Ändern eines Profils stellt diesen Motor kurz frei; frisches Setup kann alle konfigurierten Follower freigeben.

```sh
npm run tune -- inspect tools/tuning/plan.local.json
npm run tune -- preflight tools/tuning/plan.local.json
npm run tune -- run tools/tuning/plan.local.json
```

Das Tool hält die Gelenke an den vorhandenen Firmware-Haltezielen. Nur `probeId` bewegt sich durch die erklärten Testpaare. Es gibt keine automatische whole-arm-Repositionierung. Aktuelle Targets und gemessene Positionen werden für den Vergleich zwischen Läufen protokolliert. Für die aktuelle Armkonfiguration werden geprüfte Gelenkpfade verwendet.

Verwenden Sie den gleichen Befehl für die erste Charge und jede nachfolgende Charge:

```sh
npm run tune -- run NEXT_PLAN.json
```

Start- und Profiländerungen verwenden den [shared controller lifecycle](../../host/arm-control/README.md#control-behaviour). Führen Sie keinen anderen Controller auf demselben Bus aus.

`inspect` schließt sich nicht an. `preflight` liest Firmware, Kalibrierung, gespeicherte Grenzen, Gesundheit und Profile, ohne die Motoren zu wechseln. `run` bewegt sie. Ziele werden auf gespeicherte Positionslimits begrenzt; Preflight meldet den effektiven Pfad. Ein an eine Position eingestürztes Paar kann nicht als Tuning-Übung verwendet werden.

<a id="tuning-order"></a>
## Abstimmungsanordnung

1. **Baseline:** Prüfen Sie Kalibrierung, sichere Bewegung, Temperaturen und Wiederholbarkeit mit den vorhandenen Einstellungen. Verwenden Sie `stage: "baseline"` und keine Kandidaten.
2. **Gravity:** halten bescheidene Feedback-Gewinne und vergleichen Sie die Zeitlupe in beiden Richtungen bei mehreren Posen und mindestens zwei Geschwindigkeiten. Beginnen Sie mit einem kalibrierten Modell. `stage: "gravity"` sammelt Identifikationsdaten ohne Änderung der Gewinne.
3. **Geschwindigkeitsvorschub:** Nach Prüfung der Schwerkraft werden die Geschwindigkeitsgewinne mit konstanter Bewegung mit mehr als einer Geschwindigkeit verglichen.
4. **P/D und Geschwindigkeitsfilterung:** Bildschirm eine kleine explizite Reihe von Kandidaten. Fügen Sie Posen mit hoher und geringer Schwerkraft Last, dann verwenden Sie längere Halte, um Schwingungen zu entlarven. Eine kleine faktoriale Charge kann P, D und Filterung zusammen vergleichen; überprüfen Sie die beste Kombination auf den held-out-Paare.
5. **Integral:** nur, wenn ein dauerhafter Fehler bleibt; vergleichen Sie Beweglichkeitsgenauigkeit sowie lange hält. Inkludieren Sie kleine Umkehrungen: Lange Kehren allein können eine Integralgrenze vermissen, die verhindert, dass ein stationäres Gelenk Reibung zu überwinden. Halten Sie Integral Null, es sei denn, das Ergebnis unterstützt es.
6. **Beschleunigung und Rampenzeit:** mit festen Gewinnen, verwenden `stage: "motion"`, um Beschleunigung und Glättung bei den erforderlichen Geschwindigkeiten zu vergleichen.
7. **Kombinierte Bewegung:** Wiedergabe eines aufgezeichneten Pfades, der jedes Gelenk ausübt und sowohl gefaltete als auch erweiterte Konfigurationen enthält. Ein Gewinn, der mit Stützgelenken arbeitet, kann oszillieren, wenn sich der ganze Mechanismus bewegt. Überprüfen Sie die veränderten Gelenke auf diesem Pfad, bevor Sie ihre Einstellungen akzeptieren.
8. **Validierung:** Einfrieren der ausgewählten Konfiguration, wiederholen Sie den Pfad bei jeder erforderlichen Geschwindigkeit und Beschleunigung, dann halten repräsentative Posen für länger. Rekordgenauigkeit, Überschießen, Absetzen, Temperatur und Ausgangssättigung für jeden Motor. Überprüfung nach Änderung der Nutzlast oder Kalibrierung.

`stage` beschränkt die Kandidatenfelder: `velocity` erlaubt `velocityFeedforward`; `pid` erlaubt `kpQ8`, `kdQ8`, `velocityFilterQ8`; `integral` erlaubt `kiQ8` und `integralLimit`; `motion` erlaubt `accelerationLimit` und `rampTimeMs`. Ausgangs-, Gravitations- und Validierungsstufen erfassen Daten ohne Kandidatenänderungen. P/D/I und Geschwindigkeitsgewinne verwenden die Firmware-Einheiten Q8: Teilung durch 256 für den entsprechenden Gewinn. Ausgangsgrenzen bleiben die explizit mitgelieferten Controllergrenzen während der Charge.

Halten Sie Beschleunigung und Rampenzeit beim Vergleich von Gewinnen fest. Dann vergleichen Sie die Bewegungseinstellungen bei den erforderlichen Geschwindigkeiten. Die maximale konfigurierbare Beschleunigung ist 30,000 counts/s²; der nutzbare Wert hängt von Last- und Aufwandsgrenzen ab. Prüfen Sie die tatsächlichen Referenz- und gemessenen Geschwindigkeiten: Kurzhubs können niemals die gewünschte Geschwindigkeit erreichen.

Integral Gain und seine Grenze müssen zusammen getestet werden. Eine große akkumulierte Korrektur kann ein Gelenk nach Reibungsfreisetzungen weiterfahren, was zu Überschießen führt. Die Integral-Grenze begrenzt nur diese Korrektur; die gesamte Motorleistung wird separat von `effortLimit` gesteuert. Bevorzugen Sie einen stabilen Restfehler bei wiederholter Jagd und melden Sie jedes Genauigkeitskriterium, das die ausgewählten Einstellungen nicht erfüllen.

<a id="reuse-settings"></a>
## Einstellungen wiederverwenden

Ein Controller-Profil kann eine separate JSON-Datei sein, z.B. `"profiles": {"1": "motor-1.json"}`. Pfade sind relativ zur Controller-Datei. Motordateien enthalten die gleichen Felder wie Inline-Profile; optional `accelerationLimit` und `rampTimeMs` überschreiben die gemeinsamen Voreinstellungen. Wiedergabe, Teleoperation und Tuning laden diese Dateien über den gleichen Loader. Einstellungen werden auf RAM während der Erweiterungseinstellung angewendet, nicht in EEPROM gespeichert.

Exportieren Sie einen Controller in ein neues Verzeichnis mit einer Datei pro Motor, `controller.json`, einem optionalen `gravity.json` und einem Manifest:

```sh
npm run tune -- export CONFIG.json NEW_DIRECTORY
```

Export schließt sich nicht an Motoren an oder bescheinigt die Einstellungen. Verwenden Sie den exportierten `controller.json` mit Wiedergabe, Teleoperation oder Tuningplan.

Um akzeptierte Einstellungen anzuwenden und die aktuelle Position zu halten:

```sh
npm run tune -- apply NEW_DIRECTORY/controller.json
```

Das Start-up steuert angetriebene und nicht angetriebene Motoren automatisch. In einer bestehenden Sitzung werden nur geänderte Motoren kurzzeitig deaktiviert und neu konfiguriert, einer nach dem anderen. Unterstützungsmotoren bleiben elektrisch und bestehende Ziele bleiben erhalten. Das Weglassen des Schwerkraftmodells löscht beibehaltenen Schwerkraftaufwand. Replay verwendet seine Konfiguration automatisch, so dass dieser Befehl nur benötigt wird, um Einstellungen ohne Wiederholung anzuwenden.

Halten Sie die akzeptierten Einstellungen, das Gravitationsmodell, die Kalibrierung, payload/mounting Beschreibung und Validierungsnachweise zusammen. Ein anderer Arm benötigt seine eigene Kalibrierung und Validierung.

<a id="how-a-batch-works"></a>
## Wie eine Charge funktioniert

Für das Screening läuft das Tool Baseline → alle Kandidaten → Baseline. Jeder Block übt jedes Paar und jede Geschwindigkeit in beide Richtungen und wechselt den ersten Ansatz über Wiederholungen. Wenn die beiden Baselines über `driftRatio` driften, endet das Batch als inklusiv und hält seinen powered hold. Position Drift ermöglicht eine Encoder-Anzahl der Quantisierung. Förderfähige Kandidaten werden rangiert, und bis zu `finalists` wiederholen den Vergleich zwischen gemeinsamen Baselines auf verschiedenen Validierungspaaren mit längeren hält. Eine Empfehlung erfordert die Weitergabe Validierung und schlagen seine Baseline.

Metrics umfassen bewegende Tracking RMS, Steady Position Fehler und Spanne, Überschießen, Setzzeit, Gesamtansprechzeit und Sättigung Fraktion. Settling erfordert eine letzte kontinuierliche Periode innerhalb des Bandes; eine frühe Kreuzung zählt nicht. Wenn Screening hält sind kürzer als die zulässige Setzzeit plus Verweilen, Halten und Absetzen Metriken werden als verschoben gemeldet. Screening dann Rang bewegt Fehler, Überschießen und Sättigung. Die längere Validierung muss alle Metriken passieren, bevor eine Empfehlung gemacht wird. Verwendung Validierung hält lange genug, um die zulässige Abgleichzeit und ein stetiges Beobachtungsintervall zu decken. Annahmelimits werden im Plan geliefert. Eine erfolglose, aber gültige Antwort kann gewertet werden; Stillstand Proben, Alarme, Kontrollüberläufe, übermäßige folgenden Fehler, Unterstützung Bewegung, temperature/voltage Grenzen oder Protokollierungsausfälle stoppen die Charge und verwenden die [shared failure cleanup](../../host/arm-control/README.md#checks-and-timing). Eine fehlgeschlagene Charge liefert keine Empfehlung.

Das Feedback und die Schwerkraft verwenden den [shared reader](../../host/arm-control/README.md#checks-and-timing). Der Plan schätzt den Drahtverbrauch und weist Anfragen bei oder über der Nennkapazität von 50% zurück; die tatsächlichen Lücken werden während des Laufs überprüft. Die Visualisierung liest das Protokoll.

**Ein Profil zu verschieben, entfernt kurz das Drehmoment des Motors.** Die unterstützenden Motoren bleiben steuerbar. Der Regler wartet auf Ruhe vor dem Wechsel und bestätigt die Schwerkraft danach; siehe [Profiländerungen](../../host/arm-control/README.md#api-and-tests).

Ein bereits abgeschlossener Endpoint Hold wird vor der Umkehrrichtung wiederverwendet; das Tool sendet kein doppeltes Setup-Ziel oder fügt eine weitere Setup-Delay hinzu.

Normale Fertigstellung stellt die konfigurierte Basislinie wieder her und behält den powered hold mit finaler Gravitationskompensation. Strg+C unterbricht die Tuning-Charge und versucht torque-off; unterstützt den Mechanismus vor dem Interrupt. Ein getrennter oder abgetöteter Prozess kann die Firmware mit ihrem letzten Ziel verlassen.

<a id="results-and-agent-workflow"></a>
## Ergebnisse und Agent-Workflow

Runs werden unter ignorierten `tools/tuning/logs/<run>/`-Verzeichnissen gespeichert:

- `events.ndjson`: genaue plan/configuration, Implementierungs-Hasche, Gravitationsmodell, Kalibrierung, Profiländerungen, Befehle, Messungen und Testergebnisse.
- `summary.json`: Abschlussstatus, Vergleiche, Validierung und Empfehlung.

Senden Sie einen Plan mit mehreren expliziten Kandidaten, lassen Sie die gesamte Charge beenden, dann überprüfen Sie die Zusammenfassung. Verwenden Sie die rohen Ereignisse für fehlgeschlagene Kriterien oder mehrdeutige Ergebnisse. Dies vermeidet einen Prozess und Analyse Runde pro Parameter. Eine Dauer Budget gebunden immer die Arbeit. Eine unvollständige Charge hat keine Empfehlung.

Ergebnisse neu berechnen oder steady-motion-Identifizierungsfenster extrahieren:

```sh
npm run tune -- analyse tools/tuning/logs/RUN/events.ndjson
node tools/tuning/cli.js extract tools/tuning/logs/RUN/events.ndjson > tools/tuning/logs/dataset.json
node tools/tuning/cli.js fit tools/tuning/logs/dataset.json
```

Die Extraktion erfordert abgeschlossene gravity/velocity-Läufe, beide Richtungen und mehrere Geschwindigkeiten in sowohl Screening und Validierung. Es lehnt Beschleunigung, gesättigte, schlecht gemessene und moving-support-Fenster. Passend halten ganze Bahnen zwischen Training und Validierung, und verwenden die Laufzeit Schwerkraft Basis. Sie liefern unüberprüfte effort-space-Koeffizienten, nicht gemessene Gelenkdrehmoment oder ein einsetzbares Modell. Aktualisieren Sie das Modell und wiederholen Sie unabhängige Hardware-Checks bewusst.

Verwenden Sie den [Simulations-Viewer](../simulation/README.md) in der gleichen Ereignisdatei, um den Arm während oder nach einem Lauf zu überprüfen.

<a id="tests"></a>
## Prüfungen

Führen Sie `npm run test:tuning` oder `npm test` für alle Node.js-Tools aus. Tests schließen nicht an Motoren an.
<!-- /translated-content -->
