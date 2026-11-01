<!-- translation-navigation -->
[English](../../../../en/tools/settings/images/README.md) · [Русский](../../../../ru/tools/settings/images/README.md) · [Español](README.md) · [Français](../../../../fr/tools/settings/images/README.md) · [Deutsch](../../../../de/tools/settings/images/README.md) · [Português (Brasil)](../../../../pt-BR/tools/settings/images/README.md) · [简体中文](../../../../zh-CN/tools/settings/images/README.md) · [日本語](../../../../ja/tools/settings/images/README.md) · [हिन्दी](../../../../hi/tools/settings/images/README.md) · [العربية](../../../../ar/tools/settings/images/README.md)

[Original en inglés](../../../../../../tools/settings/images/README.md)

> Traducción automática completa, aún no revisada por un hablante nativo. Las imágenes y los vídeos son compartidos; su texto permanece en el idioma original.
<!-- /translation-navigation -->

<!-- translated-content -->
<a id="calibration-illustrations"></a>
# Ilustraciones de calibración

Vistas lateral y superior representadas a partir de los modelos de robot incluidos, con etiquetas de juntas e instrucciones de ubicación agregadas. Estas son guías para una **nueva calibración manual**, no fotografías ni medidas de los brazos afinados.

- `so101-reference-pose.png`: La geometría SO-101 de Robot Studio, distribuida en Apache-2.0. [Fuente fijada y licencia](../../simulation/urdf/so101/README.md).
- `so102-reference-pose.png`: Geometría SO-ARM-102 de Robonine, CC BY 4.0. [Fuente fijada y licencia](../../simulation/urdf/README.md). Esta ilustración es una adaptación con la pose, cámara, fondo y etiquetas establecidas para esta guía; también está disponible en CC BY 4.0.

<a id="poses-used-in-the-images"></a>
## Poses utilizadas en las imágenes.

M1–M4 utiliza las asignaciones de visor incluidas en el recuento 2048. Las posiciones de giro de muñeca y agarre se establecen por separado en los puntos medios de los límites de recorrido del modelo. Los topes físicos del mecanismo real determinan esos puntos medios durante la colocación manual.

| modelo | M1–M4 ángulos articulares | Rollo de muñeca | Pinza |
| --- | --- | --- | --- |
| SO-101 | 0°, 0°, 0°, 0° | 2.789° | Mandíbula móvil 45° |
| SO-102 | 0°, −3°, 1°, 1° | −1° | Posiciones de mandíbula deslizante +0.02075 my −0.02075 m |

Los ángulos son relativos a cada marco de unión URDF, no son ángulos medidos contra la mesa. Estas posiciones wrist/gripper difieren de los mapas de visualización predeterminados; Ni los mapas ni los modelos de gravedad publicados fueron modificados para estas imágenes. Para hacer coincidir una nueva calibración, actualice los ángulos de referencia del visor y el enlace de calibración como se describe en la [guía del visor](../../simulation/README.md#match-the-calibration-reference).
<!-- /translated-content -->
