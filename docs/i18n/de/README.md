<!-- translation-navigation -->
[English](../en/README.md) · [Русский](../ru/README.md) · [Español](../es/README.md) · [Français](../fr/README.md) · [Deutsch](README.md) · [Português (Brasil)](../pt-BR/README.md) · [简体中文](../zh-CN/README.md) · [日本語](../ja/README.md) · [हिन्दी](../hi/README.md) · [العربية](../ar/README.md)

[Englisches Original](../../../README.md)

> Vollständige maschinelle Übersetzung, noch nicht von Muttersprachlern geprüft. Bilder und Videos werden gemeinsam verwendet; enthaltene Texte bleiben in der Originalsprache.
<!-- /translation-navigation -->

<!-- translated-content -->
<a id="sts32xx-firmware"></a>
# STS32XX Firmware

Firmware für GD32F130-based STS3215 Servos. Standard-STS-Befehle sind im Legacy-Modus verfügbar; Der Erweiterungsmodus fügt lokal geplante sanfte Bewegungen, konfigurierbare Positionssteuerung, Geschwindigkeitsvorsteuerung und host-calculated Schwerkraftkompensation hinzu.

Beginnen Sie mit der **[Schnellstartanleitung](QUICKSTART.md)** oder lesen Sie die [ausführliche Dokumentation](DETAILED_DOCUMENTATION.md) für Konfigurations- und Protokolldetails.

[![Übersicht: aufgezeichnete SO-101 und SO-102 before-and-after Tests](../../../assets/readme/posters/overview.jpg)](https://youtu.be/AsxFs24vXQs)

[Auf YouTube ansehen](https://youtu.be/AsxFs24vXQs) | [MP4](../../../assets/readme/videos/overview.mp4)

Näherungswerte beschreiben die aufgezeichneten Demonstrationen, keine garantierte Genauigkeit im gesamten Arbeitsbereich.

Wählen Sie ein Videobild oder den YouTube-Link darunter aus, um den Stummfilm anzusehen. Alle Dokumentationsvideos sind per Link verfügbar (nicht gelistet); MP4 Kopien werden ebenfalls bereitgestellt.

- [Warum wir es gebaut haben](#why-we-built-it)
- [Welche Änderungen in der Kontrolle](#what-changes-in-control)
- [Ergebnisse am SO-101 / SO-102](#results-on-so-101--so-102)
- [Roboter und Links](#robots-and-links)
- [Schnellstart](#quick-start)
- [Detaillierte Dokumentation](#detailed-documentation)

<a id="why-we-built-it"></a>
## Warum wir es gebaut haben

Ein Roboterarm kann ständig zum selben Punkt zurückkehren und trotzdem das befohlene Ziel verfehlen. **Wiederholbarkeit** beschreibt diese Konsistenz; **Absolute Positionierungsgenauigkeit** beschreibt, wie nahe der Arm dem Ziel kommt.

**Wiederholte Renditen gemessen mit einem Indikator**

[![Wiederholte Renditen gemessen mit einem Indikator](../../../assets/readme/posters/repeatability.jpg)](https://youtu.be/_VN10zWybBU)

[Auf YouTube ansehen](https://youtu.be/_VN10zWybBU) | [MP4](../../../assets/readme/videos/repeatability.mp4)

**Wiederholbarkeit versus absolute Positionierungsgenauigkeit**

[![Konzeptionelle Erklärung von Wiederholgenauigkeit und absoluter Positioniergenauigkeit](../../../assets/readme/posters/repeatability-vs-accuracy.jpg)](https://youtu.be/L5FINW5FATI)

[Auf YouTube ansehen](https://youtu.be/L5FINW5FATI) | [MP4](../../../assets/readme/videos/repeatability-vs-accuracy.mp4)

Wir haben versucht, Positionierungsfehler zu reduzieren, indem wir PID in der Standard-Firmware eingestellt haben. In einigen Testszenarien verursachten die Einstellungen, die den Fehler reduzierten, auch Oszillationen. Wir haben eine benutzerdefinierte Firmware entwickelt, um uns mehr Kontrolle über die Bewegungsplanung und Positionssteuerung zu geben.

[![Standard-Firmware: Oszillation während PID Tuning](../../../assets/readme/posters/stock-pid-oscillation.jpg)](https://youtu.be/wIBd3jnOwRk)

[Auf YouTube ansehen](https://youtu.be/wIBd3jnOwRk) | [MP4](../../../assets/readme/videos/stock-pid-oscillation.mp4)

<a id="what-changes-in-control"></a>
## Welche Änderungen in der Kontrolle

Der Host sendet Ziele und Einstellungen; Jedes Servo plant und steuert seine eigene Bewegung.

1. Der Host sendet Ziele und Einstellungen und berechnet bei Konfiguration die Schwerkraftkompensation.
2. Jedes Servo plant seine eigene S-curve-Bewegung.
3. Lokale PID- und Feedforward-Steuerung passen die Motorleistung anhand der gemessenen Position und der geschätzten Geschwindigkeit an.

[Sehen Sie sich die aufgezeichnete Übersicht auf YouTube an](https://youtu.be/AsxFs24vXQs) | [MP4](../../../assets/readme/videos/overview.mp4)

<a id="s-curve-motion"></a>
### S-curve Bewegung

Sorgt für sanfteres Beschleunigen und Bremsen. Die Kurve veranschaulicht die Beschleunigung über die Zeit.

[![Konzeptionelle Darstellung von s-curve Bewegung](../../../assets/readme/illustrations/s-curve.png)](https://youtu.be/92mDt4rbobY)

[Auf YouTube ansehen](https://youtu.be/92mDt4rbobY) | [MP4](../../../assets/readme/videos/s-curve.mp4)

[Konfiguration und Einschränkungen](DETAILED_DOCUMENTATION.md#s-curve-motion).

<a id="pid-control"></a>
### PID Steuerung

Passt an, wie das Servo Positionsfehler korrigiert. Die graue Kurve veranschaulicht die Schwingung; Die weiße Kurve zeigt eine gedämpftere Reaktion. Die gestrichelte Linie ist das Ziel.

[![Konzeptionelle Darstellung der PID-Regelung](../../../assets/readme/illustrations/pid-tuning.png)](https://youtu.be/TEpvaAMlfrg)

[Auf YouTube ansehen](https://youtu.be/TEpvaAMlfrg) | [MP4](../../../assets/readme/videos/pid-tuning.mp4)

[Konfiguration und Einschränkungen](DETAILED_DOCUMENTATION.md#pid-controller).

<a id="velocity-feedforward"></a>
### Geschwindigkeitsvorsteuerung

Addiert die Motorleistung basierend auf der geplanten Geschwindigkeit, die im Servo berechnet wird. Beide Kurven verlaufen im Zeitverlauf von links nach rechts.

[![Konzeptionelle Darstellung der Geschwindigkeitsvorsteuerung](../../../assets/readme/illustrations/velocity-feedforward.png)](https://youtu.be/osGGs-nhk9I)

[Auf YouTube ansehen](https://youtu.be/osGGs-nhk9I) | [MP4](../../../assets/readme/videos/velocity-feedforward.mp4)

[Konfiguration und Einschränkungen](DETAILED_DOCUMENTATION.md#velocity-feedforward).

<a id="gravity-compensation"></a>
### Schwerkraftkompensation

Der Host berechnet den Beitrag und der Servo wendet ihn an. Der Abwärtspfeil stellt das Gewicht dar; Der Aufwärtspfeil steht für Unterstützung.

[![Konzeptionelle Darstellung der Schwerkraftkompensation](../../../assets/readme/illustrations/gravity-compensation.png)](https://youtu.be/25sc41PTDIA)

[Auf YouTube ansehen](https://youtu.be/25sc41PTDIA) | [MP4](../../../assets/readme/videos/gravity-compensation.mp4)

[Konfiguration und Einschränkungen](DETAILED_DOCUMENTATION.md#gravity-compensation).

Bei diesen erklärenden Grafiken und Animationen handelt es sich um konzeptionelle und nicht um gemessene Hardware-Plots. Weitere Informationen zu Einstellungen, Protokolldetails und Einschränkungen finden Sie in der [ausführlichen Dokumentation](DETAILED_DOCUMENTATION.md)]. Erweiterungsclients müssen **Protokoll v9.0** unterstützen; Erweiterungseinstellungen sind temporär und müssen nach einem Reset oder Aus- und Wiedereinschalten erneut gesendet werden.

<a id="results-on-so-101--so-102"></a>
## Ergebnisse am SO-101 / SO-102

Die folgenden Clips zeigen aufgezeichnete before-and-after-Tests an SO-101 und SO-102. Bei jedem Vergleich wird zunächst das ursprüngliche Verhalten angezeigt, gefolgt vom custom-firmware-Setup.

**SO-101: vorher, dann nachher**

[![SO-101 aufgezeichneter before-and-after Vergleich](../../../assets/readme/posters/so101-before-after.jpg)](https://youtu.be/ZdLlv8q73gE)

[Auf YouTube ansehen](https://youtu.be/ZdLlv8q73gE) | [MP4](../../../assets/readme/videos/so101-before-after.mp4)

**SO-102: vorher, dann nachher**

[![SO-102 aufgezeichneter before-and-after Vergleich](../../../assets/readme/posters/so102-before-after.jpg)](https://youtu.be/0rmO15pFqJ4)

[Auf YouTube ansehen](https://youtu.be/0rmO15pFqJ4) | [MP4](../../../assets/readme/videos/so102-before-after.mp4)

Die angezeigten Näherungswerte beschreiben diese Demonstrationen und stellen keine garantierte Genauigkeit im gesamten Arbeitsbereich des Arms dar. Wiederholgenauigkeit, absolute Positioniergenauigkeit und mechanische Auslenkung sind unterschiedliche Messungen.

<a id="complete-coordinated-movement"></a>
### Vollständige koordinierte Bewegung

[![Komplette aufgezeichnete SO-101 Bewegung](../../../assets/readme/posters/coordinated-motion.jpg)](https://youtu.be/dCtcS5aAko0)

[Auf YouTube ansehen](https://youtu.be/dCtcS5aAko0) | [MP4](../../../assets/readme/videos/coordinated-motion.mp4)

Dieser Clip bewahrt die gesamte aufgezeichnete Bewegung. Jedes Servo plant lokal; Das gemeinsame Senden von Zielen allein garantiert nicht das gleichzeitige Eintreffen.

<a id="mechanical-limitations"></a>
### Mechanische Einschränkungen

[![Getriebespiel und Rahmenflex](../../../assets/readme/posters/mechanical-limits.jpg)](https://youtu.be/53l7at5aE6k)

[Auf YouTube ansehen](https://youtu.be/53l7at5aE6k) | [MP4](../../../assets/readme/videos/mechanical-limits.mp4)

Getriebespiel und Rahmenbiegung wirken sich immer noch auf die Endpunktposition des Arms aus. Durch das Controller-Tuning werden diese mechanischen Einschränkungen nicht beseitigt. Überprüfen Sie die Einstellungen für den tatsächlichen Mechanismus und die Last. siehe [aktuelle Grenzwerte](DETAILED_DOCUMENTATION.md#current-limits).

<a id="robots-and-links"></a>
## Roboter und Links

Sind Sie daran interessiert, ein ähnliches Setup aufzubauen? Entdecken Sie die SO-ARM101- und SO-ARM102-Kits von Robonine. Der Inhalt des Kits ist auf den Produktseiten dokumentiert.

| SO-ARM101 | SO-ARM102 |
| --- | --- |
| ![SO-ARM101 Roboterbausatz](../../../assets/readme/illustrations/hardware-so101.jpg) | ![SO-ARM102 Roboterbausatz](../../../assets/readme/illustrations/hardware-so102.jpg) |
| [Kaufen Sie das SO-ARM101-Kit bei Robonine](https://robonine.com/ru/shop/so-arm101-black-white-robotic-arm-kit/) | [Kaufen Sie das SO-ARM102-Kit bei Robonine](https://robonine.com/ru/shop/so-arm102-robotic-arm-kit/) |

[Entdecken Sie SO-ARM102 Hardware, CAD und BOM](https://github.com/roboninecom/SO-ARM102).

<a id="quick-start"></a>
## Schnellstart

Befolgen Sie die **[vorhandene Kurzanleitung](QUICKSTART.md)** für die Voraussetzungen, Befehle, Prüfungen und Vorsichtsmaßnahmen beim Flashen. Die Setup-Reihenfolge lautet:

1. Installieren Sie die erforderlichen Werkzeuge und wählen Sie den Servoanschluss aus.
2. Sichern Sie die Motoreinstellungen und flashen Sie die veröffentlichte benutzerdefinierte Firmware.
3. Kalibrieren Sie Gelenkversätze und Verfahrgrenzen nach Bedarf für die Einrichtung.
4. Überprüfen Sie die Kommunikation bei abgeschaltetem Drehmoment.
5. Nehmen Sie Posen auf, zeigen Sie eine Vorschau der Wiedergabe an und führen Sie den ersten Bewegungstest durch.
6. Aktivieren Sie die Schwerkraftkompensation mit einem Modell, das zum Arm und seiner Kalibrierung passt.
7. Stimmen Sie die Bewegung ab und betrachten Sie sie.

**Das Flashen kann das Servo beschädigen oder die Kalibrierung löschen.** Befolgen Sie die in der Anleitung aufgeführten Vorsichtsmaßnahmen für Leistung, Drehmoment und Wiederherstellung, bevor Sie fortfahren.

Für eine neue SO-101- oder SO-102-Kalibrierung verwenden Sie die vorhandenen reference-pose-Bilder und folgen Sie der [Kalibrierungsanleitung](tools/settings/README.md#reference-pose-images). Behalten Sie eine vorhandene verifizierte Kalibrierung bei, wenn Sie die Aufzeichnungen und das Schwerkraftmodell wiederverwenden.

**SO-101 Referenzpose**

[![SO-101 Referenzpose mit sechs beschrifteten Gelenken](../../../tools/settings/images/so101-reference-pose.png)](../../../tools/settings/images/so101-reference-pose.png)

**SO-102 Referenzpose**

[![SO-102 Referenzpose mit sechs beschrifteten Gelenken](../../../tools/settings/images/so102-reference-pose.png)](../../../tools/settings/images/so102-reference-pose.png)

<a id="detailed-documentation"></a>
## Ausführliche Dokumentation

Die **[detaillierte Dokumentation](DETAILED_DOCUMENTATION.md)** umfasst Konfiguration, Protokolle, Register, Aufbau und Verifizierung. Technische Diagramme und relevante Videodemonstrationen werden neben den entsprechenden Abschnitten angezeigt.

- [Legacy-Modus](DETAILED_DOCUMENTATION.md#legacy-mode)
- [So funktioniert der Erweiterungsmodus](DETAILED_DOCUMENTATION.md#how-extension-mode-works)
- [S-curve Bewegung](DETAILED_DOCUMENTATION.md#s-curve-motion)
- [Kalibrierungsreferenzposen](DETAILED_DOCUMENTATION.md#calibration-reference-poses)
- [PID Controller](DETAILED_DOCUMENTATION.md#pid-controller)
- [Geschwindigkeitsvorsteuerung](DETAILED_DOCUMENTATION.md#velocity-feedforward)
- [Schwerkraftkompensation](DETAILED_DOCUMENTATION.md#gravity-compensation)
- [Erweiterungsmodus starten und stoppen](DETAILED_DOCUMENTATION.md#starting-and-stopping-extension-mode)
- [Erweiterungsprotokoll](DETAILED_DOCUMENTATION.md#extension-protocol)
- [Erweiterungsregister](DETAILED_DOCUMENTATION.md#extension-registers)
- [Build und Verifizierung](DETAILED_DOCUMENTATION.md#build-and-verification)
- [Repository-Layout](DETAILED_DOCUMENTATION.md#repository-layout)
- [Aktuelle Grenzwerte](DETAILED_DOCUMENTATION.md#current-limits)


Siehe [tools](tools/README.md) für einzelne Befehlshandbücher und [firmware](firmware/README.md) für die Build-Toolchain.
<!-- /translated-content -->
