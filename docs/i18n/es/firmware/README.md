<!-- translation-navigation -->
[English](../../en/firmware/README.md) · [Русский](../../ru/firmware/README.md) · [Español](README.md) · [Français](../../fr/firmware/README.md) · [Deutsch](../../de/firmware/README.md) · [Português (Brasil)](../../pt-BR/firmware/README.md) · [简体中文](../../zh-CN/firmware/README.md) · [日本語](../../ja/firmware/README.md) · [हिन्दी](../../hi/firmware/README.md) · [العربية](../../ar/firmware/README.md)

[Original en inglés](../../../../firmware/README.md)

> Traducción automática completa, aún no revisada por un hablante nativo. Las imágenes y los vídeos son compartidos; su texto permanece en el idioma original.
<!-- /translation-navigation -->

<!-- translated-content -->
<a id="firmware-sources"></a>
# Fuentes de firmware

GD32F130 firmware, incluido código de control portátil, controladores de hardware y pruebas. El protocolo de extensión está documentado en la [documentación detallada](../DETAILED_DOCUMENTATION.md#extension-protocol).

| Directorio | Contenidos |
| --- | --- |
| `app/` | Bucle principal y coordinación entre componentes. |
| `core/` | Control, sensado, protocolo, registros y almacenamiento. |
| `include/` | Declaraciones C compartidas y tipos de datos |
| `platform/gd32f130/` | Controladores de hardware, código de inicio, secuencia de comandos del vinculador y encabezados de proveedores |
| [`tests/`](tests/README.md) | Pruebas de regresión C, comprobaciones de Python y accesorios requeridos |

<a id="build-and-verify"></a>
## Construir y verificar

Desde la raíz del repositorio:

```sh
make
make verify
```

Instale `arm-none-eabi-gcc`, un compilador host de C con address/undefined-behavior desinfectantes, Python 3 y Make. Para una cadena de herramientas afuera PATH:

```sh
make verify ARM_PREFIX=/path/to/toolchain/bin/arm-none-eabi-
```

El Makefile raíz delega a este directorio. `make -C firmware` y `make -C firmware verify` también funcionan. Ambos escriben imágenes de firmware en `build/motor-release/` y ejecutables de prueba nativos en `build/host/` en la raíz del repositorio. `make clean` elimina el directorio `build/` generado.

Estos comandos no actualizan el hardware. Utilice la [herramienta flash](../tools/flash/README.md) con una liberación publisher-supplied. Las bibliotecas de host y las herramientas command-line permanecen en [`host/`](../host/servo-driver/README.md) y [`tools/`](../tools/README.md).
<!-- /translated-content -->
