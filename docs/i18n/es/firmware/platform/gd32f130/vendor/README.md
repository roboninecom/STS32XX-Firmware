<!-- translation-navigation -->
[English](../../../../../en/firmware/platform/gd32f130/vendor/README.md) · [Русский](../../../../../ru/firmware/platform/gd32f130/vendor/README.md) · [Español](README.md) · [Français](../../../../../fr/firmware/platform/gd32f130/vendor/README.md) · [Deutsch](../../../../../de/firmware/platform/gd32f130/vendor/README.md) · [Português (Brasil)](../../../../../pt-BR/firmware/platform/gd32f130/vendor/README.md) · [简体中文](../../../../../zh-CN/firmware/platform/gd32f130/vendor/README.md) · [日本語](../../../../../ja/firmware/platform/gd32f130/vendor/README.md) · [हिन्दी](../../../../../hi/firmware/platform/gd32f130/vendor/README.md) · [العربية](../../../../../ar/firmware/platform/gd32f130/vendor/README.md)

[Original en inglés](../../../../../../../firmware/platform/gd32f130/vendor/README.md)

> Traducción automática completa, aún no revisada por un hablante nativo. Las imágenes y los vídeos son compartidos; su texto permanece en el idioma original.
<!-- /translation-navigation -->

<!-- translated-content -->
<a id="pinned-gd32f1x0-declarations"></a>
# Declaraciones GD32F1x0 fijadas

Fuente: comunidad `sts3215-firmware/firmware/lib` en la revisión del repositorio `24ba15ba80bfe8213684c6bb4523a7d7ee079998`. Los encabezados GD32 device/SPL identifican a GigaDevice V3.3.0 (2020-09-21). El encabezado principal CMSIS identifica ARM V3.30. `SHA256SUMS` registra los bytes exactos de cada encabezado copiado. No se incluye ninguna implementación del proveedor C ni fuente de inicio del sistema.

El cierre de dependencia contiene encabezados 18: 5 CMSIS y 13 SPL. El encabezado del dispositivo incluye `gd32f1x0_libopt.h`; ese agregador local hace referencia a cada encabezado periférico. Todos los encabezados vendor/CMSIS seleccionados, excepto el agregador, contienen sus propios derechos de autor, condiciones de redistribución y exención de responsabilidad. El agregador no tiene ningún aviso incorporado; La licencia MIT del repositorio de origen se incluye como `COMMUNITY_LICENSE`. Los avisos ascendentes permanecen sin modificaciones en cada archivo y deben acompañar a las distribuciones binarias y de código fuente. Incluya este directorio o reproduzca esos avisos en los materiales de distribución cuando envíe un binario.

Solo las compilaciones de destino agregan estas rutas de inclusión. `mcu.h` selecciona `GD32F130_150`. Ninguna aplicación, núcleo o interfaz pública debe incluir este encabezado de dispositivo. No reemplace el reloj de inicio, el diseño vectorial o el contrato del vinculador del proyecto con el código de implementación del proveedor como parte de una migración declaration-only.
<!-- /translated-content -->
