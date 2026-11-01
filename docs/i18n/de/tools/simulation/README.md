<!-- translation-navigation -->
[English](../../../en/tools/simulation/README.md) · [Русский](../../../ru/tools/simulation/README.md) · [Español](../../../es/tools/simulation/README.md) · [Français](../../../fr/tools/simulation/README.md) · [Deutsch](README.md) · [Português (Brasil)](../../../pt-BR/tools/simulation/README.md) · [简体中文](../../../zh-CN/tools/simulation/README.md) · [日本語](../../../ja/tools/simulation/README.md) · [हिन्दी](../../../hi/tools/simulation/README.md) · [العربية](../../../ar/tools/simulation/README.md)

[Englisches Original](../../../../../tools/simulation/README.md)

> Vollständige maschinelle Übersetzung, noch nicht von Muttersprachlern geprüft. Bilder und Videos werden gemeinsam verwendet; enthaltene Texte bleiben in der Originalsprache.
<!-- /translation-navigation -->

<!-- translated-content -->
<a id="telemetry-viewer"></a>
# Telemetrie-Betrachter

Live-Telemetrie anzeigen oder eine Controlleraufnahme in MuJoCo wieder abspielen. Der Viewer liest Log-Dateien aus; es verbindet sich nie mit Motoren oder sendet Befehle. Beide Modelle verwenden den gleichen Viewer, Diagramme und Referenzüberlagerungen. Er zeigt aufgezeichnete Bewegung an; er prognostiziert keine Motordynamik oder Tuning-Ergebnisse.

<a id="install"></a>
## Installation

Von der Projektarchiv-root, mit Python 3.12:

```sh
python3.12 -m venv tools/simulation/.venv
tools/simulation/.venv/bin/python -m pip install -r tools/simulation/requirements.txt
```

<a id="live-and-recorded-playback"></a>
## Live- und aufgezeichnete Wiedergabe

Starten Sie einmal, um die neueste Sitzung zu sehen und wechseln Sie automatisch, wenn ein weiterer Wiedergabe- oder Teleoperationslauf ein Protokoll erzeugt:

```sh
mkdir -p logs/motion
tools/simulation/.venv/bin/python tools/simulation/viewer.py live logs/motion --model so101
```

Das Verzeichnis muss vorhanden sein. Ein leeres Verzeichnis wartet auf das erste Protokoll. Fenster-, Kamera- und Anzeigeeinstellungen bleiben zwischen den Runs unverändert; Diagramme werden für jede neue Sitzung zurückgesetzt. Starten Sie die Hardware-Wiedergabe separat in einem anderen Terminal.

Um einem bestimmten Protokoll zu folgen, oder ein gespeichertes Protokoll von Anfang an abspielen:

```sh
tools/simulation/.venv/bin/python tools/simulation/viewer.py live /path/to/events.ndjson --model so101

tools/simulation/.venv/bin/python tools/simulation/viewer.py play /path/to/events.ndjson --model so101
```

Der Befehl wählt den nativen Fenster-Launcher automatisch auf macOS, einschließlich Repository-Pfads mit Leerzeichen. Wählen Sie `--model so102` für SO-102; dies ist auch der Standard, wenn weggelassen. Modelle und Meshs werden gebündelt, so dass die Anzeige keinen Download- oder Importschritt erfordert.

Verwenden Sie für eine PNG-Vorschau gewöhnliches Python auf allen Plattformen:

```sh
tools/simulation/.venv/bin/python tools/simulation/viewer.py play /path/to/events.ndjson --model so101 --render preview.png
```

Der Viewer akzeptiert Controller-Ereignisprotokolle, nicht genannt Pose-JSON-Dateien. Senden Sie Pose-Dateien durch [hardware replay](../poses/README.md#replay-poses), dann sehen Sie das resultierende Protokoll. Playback behält die Aufzeichnungszeit und hält den endgültigen Rahmen. Live-Display-Updates erst nach einem kompletten Motor-Feedback-Pass. Verzögerte Messungen werden abgeschwächt; Befehle allein können sie nicht aktualisieren. Ein ersetztes oder gekürztes Protokoll muss wieder geöffnet werden. Schließen des Viewers lässt die Hardware-Steuerung laufen.

<a id="models-and-calibration"></a>
## Modelle und Kalibrierung

| Modell | Quelle | Abbildung anzeigen |
| --- | --- | --- |
| `so101` | [Amtsblatt SO-101 Follower](urdf/so101/README.md), Apache 2.0 | Alle sechs Motoren, einschließlich Handgelenkrolle und revolute Greifer Kiefer. |
| `so102` | [SO-ARM-102](urdf/README.md), CC BY 4.0 | Bestehende kalibrierte M1–M4 Mapping; Handgelenk Rolle und Kiefer bleiben fixiert. |

SO-101 verwendet das vorgelagerte `so101_new_calib.urdf`. Seine Standardkarte übernimmt die Standardmontage und jedes URDF Gelenk Null bei der Encoderzahl 2048. Positive Werte erhöhen jeden URDF Gelenkwinkel um 2π/4096 Radiante pro Zählung. Diese Konvention muss mit der Bezugspose und den Gelenkrichtungen Ihres Arms übereinstimmen; die Displayetiketten sind dabei **Referenzpose angenommen**, nicht hardware-verified Ausrichtung. Der Greifer verwendet Encoderwinkel direkt, nicht LeRobots normalisierte 0–100 Öffnung. Seine URDF Null muss an den Kieferwinkel bei der Kalibrierreferenz angepasst werden; er wird nicht aus den gespeicherten Reisegrenzen abgeleitet.

SO-102 behält seine bestehenden encoder-calibration Kontrollen und feste Kieferkupplung. Ändern des Modells ändert nicht die Hardware-Controller oder seine Schwerkraft-Modell.

<a id="match-the-calibration-reference"></a>
### Die Kalibrierreferenz anpassen

Das [Kalibrierungswerkzeug](../settings/README.md#choose-the-reference-pose) setzt 2048 an der von Ihnen erfassten Pose. Der Betrachter wandelt diese Zählungen separat in Winkel um:

```text
angle = referenceRadians + (counts − referenceCount) × radiansPerCount
```

| Gebündelte Karte | Angezeigte Gelenkwinkel bei Zählungen sind 2048 |
| --- | --- |
| SO-101 | 0° für alle sechs URDF Gelenke; das ist eine Annahme, nicht eine nachgewiesene physikalische Pose. |
| SO-102 | M1 0°, M2 −3°, M3 1°, M4 1°; M5 und Kiefer verwenden feste Displaypositionen. |

Eine mid-travel-Kalibrierungspose, einschließlich der in LeRobots Anleitung gezeigten, stellt nicht allein fest, dass jeder URDF-Winkel gleich Null ist. Stellen Sie bei Ihrer erfassten Referenz den `referenceRadians`-Eintrag jedes Karteneintrags auf den Winkel dieses Gelenks im URDF fest. Überprüfen Sie eine kleine Handbewegung, um das Zeichen von `radiansPerCount` zu bestätigen, einschließlich Handgelenkrolle und Greifer. Überprüfen Sie auch eine zweite Pose; eine passende Pose kann keine Richtung oder Skala bestätigen. Das Werkzeug leitet diese Winkel nicht aus den minimalen und maximalen Zählungen ab.

Die Standardkarte von SO-101 hat keine exakte Offsetbindung. Die Karte von SO-102 ist an die gespeicherten Offsets des ursprünglichen Arms gebunden. Nach der Neukalibrierung aktualisieren Sie das physikalische Winkel-Mapping sowie seine Kalibrierfelder; nur diese Felder umgehen die Überprüfung, ohne die Anzeige zu korrigieren. Kalibrierberichte werden nicht automatisch importiert. Das Cyan-Overlay zeigt die geplante Pose der Firmware oder das Ziel mit kompaktem Feedback; es ist von der Kalibrierpose getrennt.

Um eine Karte an einen bestimmten Arm anzupassen oder zu binden, kopieren Sie `so101-encoder-map.json` oder `encoder-angle-map.json`, bearbeiten Sie sie und übergeben Sie `--mapping YOUR_MAP.json` mit jedem Befehl. Version 2 Karten enthalten:

- `model`: muss mit dem ausgewählten Modell übereinstimmen.
- `joints`: Motor-IDs auf URDF-Joint-Namen, `referenceCount`, `referenceRadians` und signiert `radiansPerCount`.
- `fixedJoints`: Positionen von Modellgelenken ohne Messmapping, in Radianten für Revolute-Gelenke oder Meter für Gleitgelenke.
- `encoderCalibration`: optionale exakte Einstellungen per-motor `positionCorrection`, `resolution` und `reverse`, die gegen den Aufzeichnungsvorflug geprüft wurden.

Jede Modellfuge muss gemappt oder explizit fixiert werden. Zählt im Protokoll bereits die Positionskorrektur des Servos, subtrahieren Sie sie nicht erneut. Einheiten-Encoder-Auflösung ist erforderlich. Ein umgekehrter Encoder erfordert einen expliziten Kalibriereintrag und ein passendes signiertes Winkel-Mapping. Für benutzerdefinierte Karten, die mit dem vorherigen Format erstellt wurden, kopieren Sie die Version 2-Map und übertragen Ihre Referenzwinkel und -richtungen.

<a id="display"></a>
## Anzeige

Beide Modelle haben eine neutrale Hintergrund- und transluzente Rasterebene an der Basis. Das Gitter ist eine visuelle Referenz, ohne Kollisionsreaktion; Posen darunter bleiben sichtbar. Playback hält seinen letzten Rahmen und schleift oder startet nicht. Live-Modus mit einer Datei folgt nur dieser Datei. Mit einem Verzeichnis folgt es neuen `.ndjson`-Dateien in diesem Verzeichnis, ohne Unterverzeichnisse zu suchen oder umzuschalten, wenn ein älteres Protokoll aktualisiert wird.

`1`–`6` wählen Sie einen Motor; `G` schaltet die Referenzüberlagerung; `C` Diagramme; `J` Gelenkmarker; `M`/`R` measured/reference Pose; `F` Rendering Qualität; `H` Hilfe. Das ausgewählte Gelenk trägt das Fehlerbeschriftung. Fehlende Messwerte anzeigen `--`.

Kompaktes C1-Feedback hat gemessene Positionen, aber keine Planerreferenz; sein Vergleich verwendet das angegebene Ziel. Detailliertes C2-Feedback liefert die Planerreferenz. Zielfehler während der Bewegung ist kein Trackingfehler. Neue Wiedergabeprotokolle verwenden detailliertes Feedback: Der Cyan-Schatten folgt den zwischenzeitlich geplanten Positionen der Firmware. Ältere compact-feedback-Protokolle zeigen immer noch Sprünge zwischen den Zielen; der Viewer kann fehlende Zwischenreferenzen nicht zurückgewinnen. Diagramme behalten bis zu 20-Sekunden und erstellen keine neuen Messzeitstempel.

Der Betrachter reproduziert die Geometrie mit deaktivierten Kontakten und Schwerkraften. Er simuliert keine motorische Dynamik oder prognostiziert das PID-Tuning. Gelenkpositionen werden ohne Einklemmen auf nominale CAD-Grenzwerte angezeigt.

<a id="tests"></a>
## Prüfungen

```sh
PYTHONPATH=tools/simulation tools/simulation/.venv/bin/python -m unittest discover -s tools/simulation/test -v
```
<!-- /translated-content -->
