<!-- translation-navigation -->
[English](../../../../en/tools/simulation/urdf/README.md) · [Русский](../../../../ru/tools/simulation/urdf/README.md) · [Español](README.md) · [Français](../../../../fr/tools/simulation/urdf/README.md) · [Deutsch](../../../../de/tools/simulation/urdf/README.md) · [Português (Brasil)](../../../../pt-BR/tools/simulation/urdf/README.md) · [简体中文](../../../../zh-CN/tools/simulation/urdf/README.md) · [日本語](../../../../ja/tools/simulation/urdf/README.md) · [हिन्दी](../../../../hi/tools/simulation/urdf/README.md) · [العربية](../../../../ar/tools/simulation/urdf/README.md)

[Original en inglés](../../../../../../tools/simulation/urdf/README.md)

> Traducción automática completa, aún no revisada por un hablante nativo. Las imágenes y los vídeos son compartidos; su texto permanece en el idioma original.
<!-- /translation-navigation -->

<!-- translated-content -->
<a id="so-arm-102-model"></a>
# SO-ARM 102 modelo

URDF y ocho mallas STL de [SO-ARM-102](https://github.com/roboninecom/SO-ARM-102/tree/0f0dd95526638042a3213598ee0ae7f167c40efe/simulation/urdf) de Robonine, comete `0f0dd95526638042a3213598ee0ae7f167c40efe`. Los archivos se copian sin cambios. `source.json` registra sus sumas de verificación. Xacro y el andamio del paquete ROS no son necesarios para cargar el URDF independiente.

Copyright (c) 2026 Robonine. Atribución: Robonine, SO-ARM 102, https://github.com/roboninecom/SO-ARM-102, CC BY 4.0. Consulte [LICENSE.txt](../../../../../../tools/simulation/urdf/LICENSE.txt) y el [mapa de licencia](https://github.com/roboninecom/SO-ARM-102/blob/0f0dd95526638042a3213598ee0ae7f167c40efe/LICENSING.md)] ascendente.

<a id="model-assumptions"></a>
## Supuestos del modelo

La estimación de masa aguas arriba es **0.889 kg**. Asume PLA de impresión y 70 g por servo. Consulte la [configuración de exportación](https://github.com/roboninecom/SO-ARM-102/blob/0f0dd95526638042a3213598ee0ae7f167c40efe/simulation/urdf/export_settings.json) y las [propiedades de masa](https://github.com/roboninecom/SO-ARM-102/blob/0f0dd95526638042a3213598ee0ae7f167c40efe/simulation/urdf/mass_properties.json)]. Éstas son estimaciones; el modelo de gravedad del hardware medido permanece separado.

URDF cero es la pose CAD exportada. El [mapa codificador](../../../../../../tools/simulation/encoder-angle-map.json) establece M1–M4 ángulos en el conteo 2048 a 0°, −3°, 1° y 1°, respectivamente. M5 y la calibración de la pinza siguen sin verificarse. La pantalla de mandíbula fija utiliza +0.016 my −0.016 m, coincidiendo con el acoplamiento opposite-sign del URDF.

La fuente conserva sus cuadros de colisión. La preparación del modelo los omite de la vista previa generada porque estas herramientas desactivan la simulación de contactos. Conserva visuales, inerciales y acoplamiento articular. Los resultados de la simulación no calibran la dinámica real del motor ni establecen ganancias de ajuste del hardware.
<!-- /translated-content -->
