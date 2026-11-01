<!-- translation-navigation -->
[English](../../en/firmware/README.md) · [Русский](../../ru/firmware/README.md) · [Español](../../es/firmware/README.md) · [Français](../../fr/firmware/README.md) · [Deutsch](README.md) · [Português (Brasil)](../../pt-BR/firmware/README.md) · [简体中文](../../zh-CN/firmware/README.md) · [日本語](../../ja/firmware/README.md) · [हिन्दी](../../hi/firmware/README.md) · [العربية](../../ar/firmware/README.md)

[Englisches Original](../../../../firmware/README.md)

> Vollständige maschinelle Übersetzung, noch nicht von Muttersprachlern geprüft. Bilder und Videos werden gemeinsam verwendet; enthaltene Texte bleiben in der Originalsprache.
<!-- /translation-navigation -->

<!-- translated-content -->
<a id="firmware-sources"></a>
# Firmware-Quellen

GD32F130 Firmware, einschließlich tragbarem Steuercode, Hardwaretreibern und Tests. Das Erweiterungsprotokoll ist in der [ausführlichen Dokumentation](../DETAILED_DOCUMENTATION.md#extension-protocol)] dokumentiert.

| Verzeichnis | Inhalt |
| --- | --- |
| `app/` | Hauptschleife und Koordination zwischen Komponenten |
| `core/` | Steuerung, Erfassung, Protokoll, Register und Speicherung |
| `include/` | Gemeinsame C-Deklarationen und Datentypen |
| `platform/gd32f130/` | Hardwaretreiber, Startcode, Linker-Skript und Hersteller-Header |
| [`tests/`](tests/README.md) | C-Regressionstests, Python-Prüfungen und erforderliche Fixtures |

<a id="build-and-verify"></a>
## Erstellen und überprüfen

Aus dem Repository-Stammverzeichnis:

```sh
make
make verify
```

Installieren Sie `arm-none-eabi-gcc`, einen Host-C-Compiler mit address/undefined-behavior Sanitizern, Python 3 und Make. Für eine Toolchain außerhalb von PATH:

```sh
make verify ARM_PREFIX=/path/to/toolchain/bin/arm-none-eabi-
```

Das Root-Makefile delegiert an dieses Verzeichnis. `make -C firmware` und `make -C firmware verify` funktionieren auch. Beide schreiben Firmware-Images in `build/motor-release/` und native Test-Ausführungsdateien in `build/host/` im Repository-Stammverzeichnis. `make clean` entfernt das generierte `build/`-Verzeichnis.

Diese Befehle flashen keine Hardware. Verwenden Sie das [Flash-Tool](../tools/flash/README.md) mit einer publisher-supplied-Version. Host-Bibliotheken und command-line-Tools bleiben unter [`host/`](../host/servo-driver/README.md) und [`tools/`](../tools/README.md).
<!-- /translated-content -->
