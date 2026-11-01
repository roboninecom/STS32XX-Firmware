<!-- translation-navigation -->
[English](../../../en/firmware/tests/README.md) · [Русский](../../../ru/firmware/tests/README.md) · [Español](README.md) · [Français](../../../fr/firmware/tests/README.md) · [Deutsch](../../../de/firmware/tests/README.md) · [Português (Brasil)](../../../pt-BR/firmware/tests/README.md) · [简体中文](../../../zh-CN/firmware/tests/README.md) · [日本語](../../../ja/firmware/tests/README.md) · [हिन्दी](../../../hi/firmware/tests/README.md) · [العربية](../../../ar/firmware/tests/README.md)

[Original en inglés](../../../../../firmware/tests/README.md)

> Traducción automática completa, aún no revisada por un hablante nativo. Las imágenes y los vídeos son compartidos; su texto permanece en el idioma original.
<!-- /translation-navigation -->

<!-- translated-content -->
<a id="firmware-tests"></a>
# Pruebas de firmware

Ejecute `make verify` desde la raíz del repositorio después de instalar la [cadena de herramientas de firmware](../README.md#build-and-verify). Crea el firmware y ejecuta pruebas C desinfectadas, register/storage verificaciones de contratos, verificaciones de límites de módulos y verificación de diseño de imágenes. No se conecta al hardware.

`fixtures/` contiene entradas de regresión requeridas. Guárdelos con las pruebas. `support/` suministra interfaces de hardware simuladas y accesorios de almacenamiento.

Consulte [verificaciones de proyecto](../../tools/README.md#offline-checks) para ver pruebas de host, flasheo y visor, y el [paquete de comparación de hardware](../../tools/hw-diff-tests/README.md) para ver factory/custom verificaciones de comportamiento en un banco dedicado.
<!-- /translated-content -->
