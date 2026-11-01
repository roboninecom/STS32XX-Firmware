<!-- translation-navigation -->
[English](../../../../../en/firmware/platform/gd32f130/vendor/README.md) · [Русский](../../../../../ru/firmware/platform/gd32f130/vendor/README.md) · [Español](../../../../../es/firmware/platform/gd32f130/vendor/README.md) · [Français](../../../../../fr/firmware/platform/gd32f130/vendor/README.md) · [Deutsch](README.md) · [Português (Brasil)](../../../../../pt-BR/firmware/platform/gd32f130/vendor/README.md) · [简体中文](../../../../../zh-CN/firmware/platform/gd32f130/vendor/README.md) · [日本語](../../../../../ja/firmware/platform/gd32f130/vendor/README.md) · [हिन्दी](../../../../../hi/firmware/platform/gd32f130/vendor/README.md) · [العربية](../../../../../ar/firmware/platform/gd32f130/vendor/README.md)

[Englisches Original](../../../../../../../firmware/platform/gd32f130/vendor/README.md)

> Vollständige maschinelle Übersetzung, noch nicht von Muttersprachlern geprüft. Bilder und Videos werden gemeinsam verwendet; enthaltene Texte bleiben in der Originalsprache.
<!-- /translation-navigation -->

<!-- translated-content -->
<a id="pinned-gd32f1x0-declarations"></a>
# Angeheftete GD32F1x0-Deklarationen

Quelle: Community `sts3215-firmware/firmware/lib` bei Repository-Revision `24ba15ba80bfe8213684c6bb4523a7d7ee079998`. Die Header GD32 device/SPL identifizieren GigaDevice V3.3.0 (2020-09-21). Der CMSIS-Kernheader identifiziert ARM V3.30. `SHA256SUMS` zeichnet die genauen Bytes jedes kopierten Headers auf. Es ist keine C-Implementierung oder Systemstartquelle des Anbieters enthalten.

Der Abhängigkeitsabschluss enthält 18 Header: 5 CMSIS und 13 SPL. Der Geräteheader enthält `gd32f1x0_libopt.h`; Dieser lokale Aggregator referenziert jeden peripheren Header. Alle ausgewählten vendor/CMSIS-Header mit Ausnahme des Aggregators enthalten ihr eigenes Upstream-Urheberrecht, Weiterverbreitungsbedingungen und einen Haftungsausschluss. Der Aggregator verfügt über keinen eingebetteten Hinweis. Die MIT-Lizenz des Quell-Repositorys ist als `COMMUNITY_LICENSE` enthalten. Die Upstream-Hinweise bleiben in jeder Datei unverändert und müssen Quell- und Binärverteilungen beiliegen. Fügen Sie dieses Verzeichnis hinzu oder reproduzieren Sie diese Hinweise in den Verteilungsmaterialien, wenn Sie eine Binärdatei versenden.

Nur Ziel-Builds fügen diese Include-Pfade hinzu. `mcu.h` wählt `GD32F130_150` aus. Keine Anwendung, kein Kern oder keine öffentliche Schnittstelle sollte diesen Geräteheader enthalten. Ersetzen Sie im Rahmen einer declaration-only-Migration nicht den Taktstart, das Vektorlayout oder den Linkervertrag des Projekts durch den Implementierungscode des Anbieters.
<!-- /translated-content -->
