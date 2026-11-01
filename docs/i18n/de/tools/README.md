<!-- translation-navigation -->
[English](../../en/tools/README.md) · [Русский](../../ru/tools/README.md) · [Español](../../es/tools/README.md) · [Français](../../fr/tools/README.md) · [Deutsch](README.md) · [Português (Brasil)](../../pt-BR/tools/README.md) · [简体中文](../../zh-CN/tools/README.md) · [日本語](../../ja/tools/README.md) · [हिन्दी](../../hi/tools/README.md) · [العربية](../../ar/tools/README.md)

[Englisches Original](../../../../tools/README.md)

> Vollständige maschinelle Übersetzung, noch nicht von Muttersprachlern geprüft. Bilder und Videos werden gemeinsam verwendet; enthaltene Texte bleiben in der Originalsprache.
<!-- /translation-navigation -->

<!-- translated-content -->
<a id="tools"></a>
# Werkzeuge

Utilities für die Arbeit mit STS Servos. Jede Anleitung enthält Setup-Anweisungen, Befehle und Hardware-Anforderungen. Für die Anwendungsentwicklung verwenden Sie den [Node.js Servotreiber](../host/servo-driver/README.md), erhältlich als eigenständiges npm Paket aus diesem Projektarchiv. Replay und Teleoperation teilen sich die [Arm Controller und Gravitationsmodell](../host/arm-control/README.md).

Für einen neuen Mechanismus: [Kalibrieren Sie Offsets und Limits](settings/README.md#choose-the-reference-pose), aufnehmen Posen, dann stimmen und validieren Kompensation. Halten Sie verifizierte Kalibrierung bei der Wiederverwendung von vorhandenen Posen und Gravitationsmodellen.

| Werkzeug | Zweck |
| --- | --- |
| [Automatisierte Abstimmung](tuning/README.md) | Vergleichen Sie begrenzte Mengen von Einstellungen mit wiederholten Bewegungen und längeren Validierung hält. |
| [Telemetrie-Viewer](simulation/README.md) | Live-Telemetrie anzeigen und Aufnahmen mit gebündelten SO-101- und SO-102-Modellen abspielen; kein Buszugriff. |
| [Teleoperation](teleoperation/README.md) | Kontrollieren Sie einen Follower von einem hand-operated Leader. |
| [Aufzeichnung und Wiedergabe](poses/README.md) | Record named poses; Wiedergabe mit Legacy- oder Erweiterungseinstellungen oder Wiedergabe einer aufgezeichneten Teleoperationssitzung. |
| [Discovery, Kalibrierung und Einstellungen](settings/README.md) | Finden Sie Motoren, kalibrieren Gelenk Offsets und Grenzen, und sichern oder wiederherstellen persistente Einstellungen. |
| [Hardware Vergleichstests](hw-diff-tests/README.md) | Vergleichen Sie Fabrik und benutzerdefinierte Firmware Verhalten auf einer dedizierten Servobank. |
| [Bus Benchmark und Telemetrie](diagnostics/README.md) | Messen Sie die Kommunikationslatenz und überprüfen Sie stationäre Messwerte auf ungewöhnliche Werte. |
| [Firmware flashen und wiederherstellung](flash/README.md) | Flash benutzerdefinierte oder gebündelte Fabrik Firmware, Wiederherstellen unterbrochene Uploads und Reparatur Werk Einstellungen. |

Node.js-Tools erfordern Node.js 20 oder neuer. Flashen und Einstellungen Recovery erfordern Python 3.10 oder neuer. Simulation verwendet Python 3.12. Führen Sie Befehle aus dem Repository Root und folgen Sie der entsprechenden Anleitung, bevor Sie Hardware verbinden: Vergleichstests können Motoren und Überschreiben Einstellungen bewegen, und Flashen kann ein Servo beschädigen.

<a id="offline-checks"></a>
## Offline-Kontrollen

Führen Sie vom Projektarchiv-Root aus. Installieren Sie zuerst die Abhängigkeiten von Knoten und die Anforderungen jedes Python-Tools. Keiner dieser Befehle öffnet einen seriellen Port oder verschiebt Hardware.

| Befehl | Geltungsbereich |
| --- | --- |
| `make verify` | Firmware Build, C Regressionstests, register/storage Verträge und Bildlayout. Siehe [toolchain setup](../firmware/README.md). |
| `npm test` | Treiber, Shared Controller und alle Node.js Tools. |
| `npm run test:driver-package` | Treiber-Verpackung und isolierte Installation mit zwischengespeicherten npm Abhängigkeiten. |
| `make flash-verify PYTHON=tools/flash/.venv/bin/python` | Flashing und Werkseinstellungen Wiederherstellung mit simulierten seriellen Geräten. |
| `PYTHONPATH=tools/simulation tools/simulation/.venv/bin/python -m unittest discover -s tools/simulation/test` | Modelle, Aufnahme von Lesern und Zuschauerverhalten. |

Hardware-Vergleich verwendet die [dedicated bench suite](hw-diff-tests/README.md); es kann Einstellungen ersetzen und zurücksetzen Vorlagen. Verwenden Sie [Diagnostics](diagnostics/README.md) für die Kommunikation und stationäre Telemetrie auf einem zusammengesetzten Mechanismus.
<!-- /translated-content -->
