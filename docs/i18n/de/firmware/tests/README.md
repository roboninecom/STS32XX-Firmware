<!-- translation-navigation -->
[English](../../../en/firmware/tests/README.md) · [Русский](../../../ru/firmware/tests/README.md) · [Español](../../../es/firmware/tests/README.md) · [Français](../../../fr/firmware/tests/README.md) · [Deutsch](README.md) · [Português (Brasil)](../../../pt-BR/firmware/tests/README.md) · [简体中文](../../../zh-CN/firmware/tests/README.md) · [日本語](../../../ja/firmware/tests/README.md) · [हिन्दी](../../../hi/firmware/tests/README.md) · [العربية](../../../ar/firmware/tests/README.md)

[Englisches Original](../../../../../firmware/tests/README.md)

> Vollständige maschinelle Übersetzung, noch nicht von Muttersprachlern geprüft. Bilder und Videos werden gemeinsam verwendet; enthaltene Texte bleiben in der Originalsprache.
<!-- /translation-navigation -->

<!-- translated-content -->
<a id="firmware-tests"></a>
# Firmware-Tests

Führen Sie `make verify` im Repository-Stammverzeichnis aus, nachdem Sie die [Firmware-Toolchain](../README.md#build-and-verify) installiert haben. Es erstellt die Firmware und führt bereinigte C-Tests, register/storage Vertragsprüfungen, Modulgrenzenprüfungen und Bildlayoutüberprüfungen durch. Es stellt keine Verbindung zur Hardware her.

`fixtures/` enthält erforderliche Regressionseingaben. Bewahren Sie diese bei den Tests auf. `support/` stellt simulierte Hardwareschnittstellen und Speichervorrichtungen bereit.

Siehe [Projektprüfungen](../../tools/README.md#offline-checks) für Host-, Flash- und Viewer-Tests und die [Hardware-Vergleichssuite](../../tools/hw-diff-tests/README.md) für factory/custom Verhaltensprüfungen auf einem dedizierten Prüfstand.
<!-- /translated-content -->
