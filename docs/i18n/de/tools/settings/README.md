<!-- translation-navigation -->
[English](../../../en/tools/settings/README.md) · [Русский](../../../ru/tools/settings/README.md) · [Español](../../../es/tools/settings/README.md) · [Français](../../../fr/tools/settings/README.md) · [Deutsch](README.md) · [Português (Brasil)](../../../pt-BR/tools/settings/README.md) · [简体中文](../../../zh-CN/tools/settings/README.md) · [日本語](../../../ja/tools/settings/README.md) · [हिन्दी](../../../hi/tools/settings/README.md) · [العربية](../../../ar/tools/settings/README.md)

[Englisches Original](../../../../../tools/settings/README.md)

> Vollständige maschinelle Übersetzung, noch nicht von Muttersprachlern geprüft. Bilder und Videos werden gemeinsam verwendet; enthaltene Texte bleiben in der Originalsprache.
<!-- /translation-navigation -->

<!-- translated-content -->
<a id="discovery-calibration-and-settings"></a>
# Entdeckung, Kalibrierung und Einstellungen

Finden Sie STS Servos und sichern oder wiederherstellen ihre persistenten Legacy-Einstellungen. Benutzt den freigegebenen Treiber des Projektarchivs und STS Steuertabelle. Erfordert Node.js 20 oder neuer. Führen Sie diese Befehle aus dem Projektarchiv root nach `npm ci` aus.

<a id="discover"></a>
## Entdecken

```sh
npm run settings -- discover --port /dev/cu.usbmodemYOUR_ADAPTER
```

Listet Motor-IDs und gemeldete Alarme als JSON auf. Discovery ist read-only und scannt die gewählte Baudrate, die 1,000,000 voreingestellt ist. Fügen Sie `--baud 500000` für eine andere unterstützte Rate hinzu. Verwenden Sie unter Linux oder Windows den Port Ihres Adapters, z. B. `/dev/ttyUSB0` oder `COM3`.

Motoren müssen eindeutige IDs haben. Discovery kann Motoren, die einen ID teilen, nicht zuverlässig unterscheiden oder Motoren mit einer anderen Baudrate finden.

<a id="back-up"></a>
## Zurück!

```sh
npm run settings -- backup --port /dev/cu.usbmodemYOUR_ADAPTER --id 2 \
  --file tools/settings/backups/servo-2.json
```

Speichert die Geräteidentität und jede persistente Einstellung, die von der geteilten Steuertabelle beschrieben wird, einschließlich Kalibrierung, Limits, Gewinne, ID und Baud Selektor. Backup liest nur den Motor. Bestehende Dateien werden nie überschrieben. Ohne `--file` wird unter `tools/settings/backups/` eine Zeitstempeldatei erstellt, die von Git ignoriert wird.

<a id="restore"></a>
## Wiederherstellen

Schließen Sie nur den Motor, der wiederhergestellt wird, deaktivieren Sie Drehmoment, Sperreinstellungen und klare aktive Alarme. Schließen Sie andere Programme mit dem Port. Verwenden Sie eine Sicherung aus dem gleichen Motor: die Wiederherstellung der Kalibrierung eines anderen Motors kann seine gemeldete Position ändern.

```sh
npm run settings -- restore --port /dev/cu.usbmodemYOUR_ADAPTER --id 2 \
  --file tools/settings/backups/servo-2.json
```

`--id` und `--baud` beschreiben die **current connection**. Das Backup kann eine andere ID oder Baudrate wiederherstellen; das Tool folgt diesen Änderungen und meldet die Endverbindung. Es überprüft die Modellidentität, schreibt nur geänderte Einstellungen, wartet auf jeden gespeicherten Registerbereich, liest die Einstellungen zurück und sperrt den Motor wieder ab. Es aktiviert niemals Drehmoment oder sendet einen Bewegungsbefehl. Eine fehlgeschlagene Wiederherstellung kann einige Einstellungen ändern lassen; den Fehler vor dem erneuten Versuch überprüfen.

Diese Backups umfassen ältere Einstellungen, nicht die Erweiterungskonfiguration oder die Fabrik-Reset-Vorlage. Zur Reparatur nach dem Flashen Fabrik-Firmware über benutzerdefinierte Firmware, verwenden Sie die [Fabrik-Einstellungen Recovery-Tool](../flash/README.md#restore-factory-settings). Seine Backup-Dateien verwenden ein anderes Format und sind nicht austauschbar mit diesem Tool JSON.

<a id="calibrate-joint-offsets-and-limits"></a>
## Gelenkversätze und -grenzen kalibrieren

Kalibrieren Sie 1–6 Motoren mit einzigartigen IDs von 1 bis 253 und mechanisch begrenzter Gelenkfahrt. Unterstützt GD32 STS Modellfamilie 9, einschließlich gemischter Motorvarianten, in Positionsmodus mit einem Positionsteiler von 1. Schließen Sie andere serielle Werkzeuge.

```sh
npm run settings -- calibrate --port /dev/cu.usbmodemYOUR_ADAPTER --ids 1,2,3 \
  --file tools/settings/calibrations/arm.json
```

Ersetzen Sie die Beispiel-IDs durch Ihre Motoren. Omit `--ids` zur Kalibrierung aller entdeckten Motoren, bis zu sechs. Eine explizite Auswahl lässt andere angeschlossene Motoren unverändert. Es werden keine Gelenknamen, Armgeometrie oder Standardreferenzpose angenommen.

<a id="choose-the-reference-pose"></a>
### Wählen Sie die Referenzpose

Die **Kalibrierung Referenz Pose** ist die physikalische Pose, die Sie in Schritt 1 erfassen. Das Tool macht jeden ausgewählten Motorbericht **2048 an dieser Pose**. Es erkennt die Pose, leitet Gelenkwinkel, oder berechnen Sie es aus dem späteren Sweep.

Für eine neue Kalibrierung, legen Sie jedes Gelenk in der Nähe der Mitte seiner mechanischen Reise und wählen Sie eine Position, die Sie reproduzieren können. Einschließen Handgelenk Rolle und den Greifer; nicht davon ausgehen, dass der Greifer sollte vollständig offen oder geschlossen sein. Verwenden Sie die gleiche physikalische Pose jedes Mal. Wenn der Mechanismus hat eine dokumentierte Referenz Pose, folgen Sie ihr. Für SO-101, die [LeRobot Kalibrieranleitung und Video](https://huggingface.co/docs/lerobot/so101#calibrate) zeigen die mid-travel Platzierung gefolgt von einem end-to-end Sweep.

<a id="reference-pose-images"></a>
### Referenz Pose Bilder

Für eine **neue Kalibrierung**, verwenden Sie die unten stehenden Führungen. Etiketten nehmen die üblichen Motor-IDs 1–6 an. Legen Sie die Basis aufrecht, den Oberarm aufrecht, und den Unterarm und Greifer nach vorne wie gezeigt. Zentrieren Sie die Basis Drehung und Handgelenk Rolle zwischen ihren mechanischen Anschlägen; stellen Sie den Greifer auf halbem Weg zwischen geschlossen und offen. Verwenden Sie die physische Reise, um diese Positionen zu finden, nicht die unkalibrierten Zählungen.

<a id="so-101"></a>
#### SO-101

![SO-101 Kalibrierreferenz: Seiten- und Oberansichten mit allen sechs Gelenken beschriftet, Oberarm aufrecht, Unterarm nach vorne, zentrierte Handgelenkrolle und half-open Greifer](../../../../../tools/settings/images/so101-reference-pose.png)

<a id="so-102"></a>
#### SO-102

![SO-102 Kalibrierreferenz: Seiten- und Oberansichten mit allen sechs Gelenken beschriftet, Oberarm aufrecht, Unterarm nach vorne, zentrierte Handgelenkrolle und half-open Parallelgreifer](../../../../../tools/settings/images/so102-reference-pose.png)

Die Bilder veranschaulichen die manuelle Platzierung für neue Offsets. Sie stellen keine Kompatibilität mit einem bereits vorhandenen abgestimmten Gravitationsmodell her. Die Standard-Viewerkarten verwenden auch verschiedene wrist/gripper-Referenzwerte: Aktualisieren Sie das Mapping, wenn Sie diese Posen kalibrieren. [Bildquellen und Modellwinkel](images/README.md).

Die volle Fahrt muss in 0–4095 passen, nachdem die Referenz 2048 wird: höchstens 2048 zählt unterhalb der Referenz und 2047 darüber. Ein Gelenk mit fast einer vollen Drehung der Reise benötigt besonders sorgfältige Zentrierung. Eine wiederholbare Pose in der Nähe eines Endstopps kann nicht genug Raum verlassen, auch wenn die gesamte Reise weniger als eine Drehung ist.

Wenn Sie ein Simulator- oder Gravitationsmodell verwenden wollen, muss seine Winkelkonvention dieser physikalischen Pose entsprechen. **2048 ist nicht automatisch Null Grad im Modell.** Siehe das [Viewer Mapping](../simulation/README.md#models-and-calibration) und [Gravitationsmodellanforderungen](../../host/arm-control/models/README.md). Bewahren Sie eine bereits verifizierte Kalibrierung bei der Wiederverwendung seiner Aufnahmen und des Modells auf; ein Firmware-Flash, der Einstellungen bewahrt, erfordert keine Neukalibrierung.

<a id="capture-offsets-then-limits"></a>
### Offsets erfassen, dann Grenzen setzen

Ein Befehl führt beide Schritte:

1. **Referenzpose:** Platzieren Sie die ausgewählten Gelenke in eine wiederholbare Pose, die für Ihren Mechanismus ausgewählt wurde. Unterstützen, stillhalten und drücken Sie **Enter**. Das Tool schreibt Motor Offsets, so dass jedes ausgewählte Gelenk **2048** an der erfassten Pose liest und dann die gespeicherten Register überprüft.
2. **Joint limits:** verschieben jedes ausgewählte Gelenk von Ende zu Ende. An jedem Ende kurz anhalten; nicht stoppen. Überprüfen Sie das Live-Mindest-, Maximum-, Mittelpunkt- und Reiseanzahl, dann drücken Sie **Enter**. Das Tool schreibt Grenzen mit **10 Counts of Clearance** innerhalb jedes gemessenen Endpunkts.

Die Tabelle **Middle** ist `(Min + Max) / 2`, gerundet auf eine ganze Zahl. Es ist informativ: Speichern Grenzen nicht 2048 zu diesem Mittelpunkt bewegen oder ändern Sie die Offsets. Asymmetrische Grenzen sind gültig.

Wenn Motoren beim Starten angetrieben werden, fordert das Werkzeug Sie auf, den Mechanismus zu unterstützen, bevor das Drehmoment freigegeben wird. Ansonsten gibt es nur die beiden oben genannten Eingabeaufforderung. Keine Bewegung wird gesteuert; Drehmoment bleibt aus und Einstellungen werden nach dem Speichern gesperrt.

Die Referenzaufnahme verwendet den Median mehrerer Messwerte. Kleine Handbewegungen stoppen die Kalibrierung nicht und bewegen sich leicht, während Offsets gespeichert werden, erfordert keine weitere Bestätigung. Fehlerhafte Einstellungen speichern bleiben neben dem betroffenen Motor und wiederholen automatisch. Das Werkzeug liest zurück, bevor ein Schreiben erneut versucht wird, so dass eine fehlende Bestätigung nicht dazu führt, dass already-saved-Einstellungen erneut geschrieben werden. Abgeschlossene Motoren werden gehalten; es wird keine zusätzliche Bestätigung benötigt.

Offsets werden vor dem Sweep gespeichert und werden nicht verändert, wenn Limits gespeichert werden. Limits können asymmetrisch um 2048 sein. Encoder Wraparound wird verfolgt; ein Bereich, der 0 oder 4095 überquert, kann nicht als gewöhnliche Limits gespeichert werden und zeigt `crosses zero` in der Spalte **Check** an. Jedes Gelenk muss mindestens 64-Zählungen und weniger als eine volle Runde vor dem Speichern seiner Limits bewegen.

Temporäre Lesefehler erscheinen neben dem betroffenen Motor und löschen automatisch, wenn die gültigen Messwerte wieder aufgenommen werden. Schnellere Handbewegung löst keinen speed-limit-Fehler aus. Enter speichert nur, wenn alle Bereiche gültig sind; ansonsten wird die Aufzeichnung mit den gespeicherten Messungen fortgesetzt. Verwenden Sie `reset 2`, um nur den Messbereich von M2 zu löschen und das Gelenk erneut zu fegen, ohne den Referenzschritt oder andere Verbindungen zu wiederholen. Ein echter Bereich, der Null überschreitet, muss noch seine Referenzplatzierung korrigiert werden; die Messungen können diesen physikalischen Bereich nicht wieder herstellen. Alle Motorfehler bleiben neben dem betroffenen Motor sichtbar. Alarme oder unerwartete Drehmomentpausen seiner Einstellungen schreiben, bis gelöscht werden; verlorene Verbindungen werden erneut ausprobiert. Die Sitzung bleibt offen und behält die abgeschlossene Arbeit. Drücken Sie während der automatischen Wiederholungen Strg+C, um Strg+C abzubrechen.

Die Ausgabedatei wird bei jedem Lauf überschrieben. Motorische Backups werden in einem einzigartigen Verzeichnis unter `backups/` neben dieser Datei aufbewahrt und können mit `settings restore` verwendet werden. Der Bericht zeichnet Referenzwerte, Offsets, Messbereiche und abgeschlossene Schreibvorgänge auf; er speichert keine Foto- oder physikalischen Gelenkwinkel. Nur `status: "verified"` bedeutet beide Schritte abgeschlossen.

Geben Sie `cancel` ein oder drücken Sie Strg+C, um zu stoppen. **Offsets, die bereits in Schritt 1 gespeichert sind, bleiben gespeichert, wenn Schritt 2 abgebrochen wird oder fehlschlägt; die alten Limits bleiben bis zum Austausch.** Vollständige Kalibrierung vor Aktivierung der Bewegung. Sie können denselben Befehl aus der Referenzpose ausführen, ohne eine vorherige Kalibrierung JSON wiederherzustellen.

<a id="expected-travel-warnings"></a>
### Erwartete Reisewarnungen

Optional übergeben `--expected-ranges FILE.json` mit verifizierten Reisezahlen und Toleranzen, keyed by Motor ID. Beispielformat:

```json
{"1": {"counts": 2000, "tolerance": 100}}
```

Diese Zahlen veranschaulichen nur das Dateiformat. Abweichungen werden als Warnungen angezeigt; das Drücken von Enter akzeptiert den gemessenen Bereich. Omitted Joints haben keine expected-range-Kontrolle.

Nach dem Wechseln der Offsets, dem Aktualisieren oder Umrüsten des Gravity-Modells und des Simulator-Mappings. Auch wird mit diesem Befehl nicht aktualisiert. Das Kopieren von Offsets eines anderen Arms oder das Ändern der calibration-check-Felder eines Modells stellen keine korrekte Beziehung zwischen Zählen und Winkeln dar.

<a id="help-and-tests"></a>
## Hilfe und Tests

```sh
npm run settings -- --help
npm run test:settings
```

Tests laufen offline, ohne einen seriellen Port zu öffnen. Befehle beenden bei Ausfall mit einem ungleich Null-Status; eine leere Entdeckungsliste bedeutet keine Antworten auf den ausgewählten Baud.
<!-- /translated-content -->
