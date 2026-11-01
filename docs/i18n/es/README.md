<!-- translation-navigation -->
[English](../en/README.md) · [Русский](../ru/README.md) · [Español](README.md) · [Français](../fr/README.md) · [Deutsch](../de/README.md) · [Português (Brasil)](../pt-BR/README.md) · [简体中文](../zh-CN/README.md) · [日本語](../ja/README.md) · [हिन्दी](../hi/README.md) · [العربية](../ar/README.md)

[Original en inglés](../../../README.md)

> Traducción automática completa, aún no revisada por un hablante nativo. Las imágenes y los vídeos son compartidos; su texto permanece en el idioma original.
<!-- /translation-navigation -->

<!-- translated-content -->
<a id="sts32xx-firmware"></a>
# STS32XX Firmware

Firmware para servos GD32F130-based STS3215. Los comandos estándar STS están disponibles en modo heredado; El modo de extensión agrega un movimiento suave planificado localmente, control de posición configurable, avance de velocidad y compensación de gravedad host-calculated.

Comience con la guía **[Inicio rápido](QUICKSTART.md)** o lea la [documentación detallada](DETAILED_DOCUMENTATION.md) para obtener detalles sobre la configuración y el protocolo.

[![Resumen: pruebas SO-101 y SO-102 before-and-after grabadas](../../../assets/readme/posters/overview.jpg)](https://youtu.be/AsxFs24vXQs)

[Ver en YouTube](https://youtu.be/AsxFs24vXQs) | [MP4](../../../assets/readme/videos/overview.mp4)

Los valores aproximados describen las demostraciones grabadas, no se garantiza la precisión en todo el espacio de trabajo.

Seleccione una imagen de video o el enlace de YouTube debajo para ver el clip silencioso. Todos los vídeos de documentación están disponibles mediante enlace (no listados); MP4 también se proporcionan copias.

- [Por qué lo construimos](#why-we-built-it)
- [Qué cambios en el control](#what-changes-in-control)
- [Resultados en SO-101 / SO-102](#results-on-so-101--so-102)
- [Robots y enlaces](#robots-and-links)
- [Inicio rápido](#quick-start)
- [Documentación detallada](#detailed-documentation)

<a id="why-we-built-it"></a>
## Por qué lo construimos

Un brazo robótico puede regresar constantemente al mismo punto y aun así no alcanzar el objetivo ordenado. **Repetibilidad** describe esa consistencia; **precisión de posicionamiento absoluta** describe qué tan cerca llega el brazo al objetivo.

**Retornos repetidos medidos con un indicador**

[![Rendimientos repetidos medidos con un indicador](../../../assets/readme/posters/repeatability.jpg)](https://youtu.be/_VN10zWybBU)

[Ver en YouTube](https://youtu.be/_VN10zWybBU) | [MP4](../../../assets/readme/videos/repeatability.mp4)

**Repetibilidad versus precisión de posicionamiento absoluta**

[![Explicación conceptual de repetibilidad y precisión de posicionamiento absoluta](../../../assets/readme/posters/repeatability-vs-accuracy.jpg)](https://youtu.be/L5FINW5FATI)

[Ver en YouTube](https://youtu.be/L5FINW5FATI) | [MP4](../../../assets/readme/videos/repeatability-vs-accuracy.mp4)

Intentamos reducir el error de posicionamiento ajustando PID en el firmware original. En algunos escenarios de prueba, las configuraciones que redujeron el error también provocaron oscilación. Desarrollamos firmware personalizado para brindarnos más control sobre la planificación del movimiento y el control de posición.

[![Firmware original: oscilación durante PID sintonización](../../../assets/readme/posters/stock-pid-oscillation.jpg)](https://youtu.be/wIBd3jnOwRk)

[Ver en YouTube](https://youtu.be/wIBd3jnOwRk) | [MP4](../../../assets/readme/videos/stock-pid-oscillation.mp4)

<a id="what-changes-in-control"></a>
## ¿Qué cambios en el control?

El anfitrión envía objetivos y configuraciones; cada servo planifica y controla su propio movimiento.

1. El host envía objetivos y configuraciones y calcula la compensación de gravedad cuando se configura.
2. Cada servo planifica su propio movimiento S-curve.
3. El control local PID y de avance ajusta la salida del motor utilizando la posición medida y la velocidad estimada.

[Vea la descripción general grabada en YouTube](https://youtu.be/AsxFs24vXQs) | [MP4](../../../assets/readme/videos/overview.mp4)

<a id="s-curve-motion"></a>
### S-curve movimiento

Hace que la aceleración y el frenado sean más graduales. La curva ilustra la aceleración en el tiempo.

[![Ilustración conceptual de s-curve movimiento](../../../assets/readme/illustrations/s-curve.png)](https://youtu.be/92mDt4rbobY)

[Ver en YouTube](https://youtu.be/92mDt4rbobY) | [MP4](../../../assets/readme/videos/s-curve.mp4)

[Configuración y limitaciones](DETAILED_DOCUMENTATION.md#s-curve-motion).

<a id="pid-control"></a>
### PIDcontrolar

Ajusta cómo el servo corrige el error de posición. La curva gris ilustra la oscilación; la curva blanca ilustra una respuesta más amortiguada. La línea discontinua es el objetivo.

[![Ilustración conceptual del control pid](../../../assets/readme/illustrations/pid-tuning.png)](https://youtu.be/TEpvaAMlfrg)

[Ver en YouTube](https://youtu.be/TEpvaAMlfrg) | [MP4](../../../assets/readme/videos/pid-tuning.mp4)

[Configuración y limitaciones](DETAILED_DOCUMENTATION.md#pid-controller).

<a id="velocity-feedforward"></a>
### avance de velocidad

Agrega salida del motor según la velocidad planificada, calculada dentro del servo. Ambas curvas progresan de izquierda a derecha a lo largo del tiempo.

[![Ilustración conceptual de avance de velocidad](../../../assets/readme/illustrations/velocity-feedforward.png)](https://youtu.be/osGGs-nhk9I)

[Ver en YouTube](https://youtu.be/osGGs-nhk9I) | [MP4](../../../assets/readme/videos/velocity-feedforward.mp4)

[Configuración y limitaciones](DETAILED_DOCUMENTATION.md#velocity-feedforward).

<a id="gravity-compensation"></a>
### Compensación de gravedad

El anfitrión calcula la contribución y el servo la aplica. La flecha hacia abajo representa el peso; la flecha hacia arriba representa el soporte.

[![Ilustración conceptual de compensación de gravedad](../../../assets/readme/illustrations/gravity-compensation.png)](https://youtu.be/25sc41PTDIA)

[Ver en YouTube](https://youtu.be/25sc41PTDIA) | [MP4](../../../assets/readme/videos/gravity-compensation.mp4)

[Configuración y limitaciones](DETAILED_DOCUMENTATION.md#gravity-compensation).

Estos gráficos y animaciones explicativos son gráficos conceptuales, no medidos por hardware. Consulte la [documentación detallada](DETAILED_DOCUMENTATION.md) para conocer la configuración, los detalles del protocolo y las limitaciones. Los clientes de extensión deben admitir el **protocolo v9.0**; La configuración de la extensión es temporal y debe enviarse nuevamente después de un reinicio o ciclo de encendido.

<a id="results-on-so-101--so-102"></a>
## Resultados en SO-101 / SO-102

Los clips a continuación muestran pruebas before-and-after grabadas en SO-101 y SO-102. Cada comparación muestra primero el comportamiento original, seguido de la configuración custom-firmware.

**SO-101: antes, luego después**

[![SO-101 grabado before-and-after comparación](../../../assets/readme/posters/so101-before-after.jpg)](https://youtu.be/ZdLlv8q73gE)

[Ver en YouTube](https://youtu.be/ZdLlv8q73gE) | [MP4](../../../assets/readme/videos/so101-before-after.mp4)

**SO-102: antes, luego después**

[![SO-102 grabado before-and-after comparación](../../../assets/readme/posters/so102-before-after.jpg)](https://youtu.be/0rmO15pFqJ4)

[Ver en YouTube](https://youtu.be/0rmO15pFqJ4) | [MP4](../../../assets/readme/videos/so102-before-after.mp4)

Los valores aproximados que se muestran describen estas demostraciones y no garantizan la precisión en todo el espacio de trabajo del brazo. La repetibilidad, la precisión de posicionamiento absoluta y la deflexión mecánica son medidas diferentes.

<a id="complete-coordinated-movement"></a>
### Movimiento coordinado completo

[![Movimiento SO-101 grabado completo](../../../assets/readme/posters/coordinated-motion.jpg)](https://youtu.be/dCtcS5aAko0)

[Ver en YouTube](https://youtu.be/dCtcS5aAko0) | [MP4](../../../assets/readme/videos/coordinated-motion.mp4)

Este clip conserva el movimiento grabado completo. Cada servo planifica localmente; Enviar objetivos juntos no garantiza por sí solo la llegada simultánea.

<a id="mechanical-limitations"></a>
### Limitaciones mecánicas

[![Juego de la caja de cambios y flexión del marco](../../../assets/readme/posters/mechanical-limits.jpg)](https://youtu.be/53l7at5aE6k)

[Ver en YouTube](https://youtu.be/53l7at5aE6k) | [MP4](../../../assets/readme/videos/mechanical-limits.mp4)

El juego de la caja de cambios y la flexión del marco aún afectan la posición final del brazo. El ajuste del controlador no elimina estas limitaciones mecánicas. Validar la configuración del mecanismo y la carga reales; consulte [límites actuales](DETAILED_DOCUMENTATION.md#current-limits).

<a id="robots-and-links"></a>
## Robots y enlaces.

¿Interesado en construir una configuración similar? Explora los kits SO-ARM101 y SO-ARM102 de Robonine. El contenido del kit está documentado en las páginas del producto.

| SO-ARM101 | SO-ARM102 |
| --- | --- |
| ![SO-ARM101 kit de robot](../../../assets/readme/illustrations/hardware-so101.jpg) | ![SO-ARM102 kit de robot](../../../assets/readme/illustrations/hardware-so102.jpg) |
| [Compre el kit SO-ARM101 de Robonine](https://robonine.com/ru/shop/so-arm101-black-white-robotic-arm-kit/) | [Compre el kit SO-ARM102 de Robonine](https://robonine.com/ru/shop/so-arm102-robotic-arm-kit/) |

[Explore el hardware SO-ARM102, CAD y BOM](https://github.com/roboninecom/SO-ARM102).

<a id="quick-start"></a>
## Inicio rápido

Siga la **[guía de inicio rápido existente](QUICKSTART.md)** para conocer los requisitos previos, comandos, comprobaciones y precauciones de actualización. Su secuencia de configuración es:

1. Instale las herramientas necesarias y seleccione el puerto del servo.
2. Haga una copia de seguridad de la configuración del motor y actualice el firmware personalizado publicado.
3. Calibre las compensaciones de las juntas y los límites de recorrido según sea necesario para la configuración.
4. Verifique la comunicación con torque desactivado.
5. Grabe poses, obtenga una vista previa de la reproducción y realice la primera prueba de movimiento.
6. Habilite la compensación de la gravedad con un modelo que coincida con el brazo y su calibración.
7. Sintoniza y visualiza el movimiento.

**El flasheo puede dañar el servo o borrar la calibración.** Siga las precauciones de potencia, torsión y recuperación de la guía antes de continuar.

Para una nueva calibración SO-101 o SO-102, utilice las imágenes reference-pose existentes y siga la [guía de calibración](tools/settings/README.md#reference-pose-images). Mantenga una calibración verificada existente cuando reutilice sus grabaciones y modelo de gravedad.

**SO-101 pose de referencia**

[![SO-101 pose de referencia con seis articulaciones etiquetadas](../../../tools/settings/images/so101-reference-pose.png)](../../../tools/settings/images/so101-reference-pose.png)

**SO-102 pose de referencia**

[![SO-102 pose de referencia con seis articulaciones etiquetadas](../../../tools/settings/images/so102-reference-pose.png)](../../../tools/settings/images/so102-reference-pose.png)

<a id="detailed-documentation"></a>
## Documentación detallada

La **[documentación detallada](DETAILED_DOCUMENTATION.md)** cubre configuración, protocolos, registros, construcción y verificación. Los diagramas técnicos y las demostraciones en vídeo relevantes aparecen junto a las secciones correspondientes.

- [Modo heredado](DETAILED_DOCUMENTATION.md#legacy-mode)
- [Cómo funciona el modo de extensión](DETAILED_DOCUMENTATION.md#how-extension-mode-works)
- [S-curve movimiento](DETAILED_DOCUMENTATION.md#s-curve-motion)
- [Posturas de referencia de calibración](DETAILED_DOCUMENTATION.md#calibration-reference-poses)
- [PID controlador](DETAILED_DOCUMENTATION.md#pid-controller)
- [Avance de velocidad](DETAILED_DOCUMENTATION.md#velocity-feedforward)
- [Compensación de gravedad](DETAILED_DOCUMENTATION.md#gravity-compensation)
- [Iniciando y deteniendo el modo de extensión](DETAILED_DOCUMENTATION.md#starting-and-stopping-extension-mode)
- [Protocolo de extensión](DETAILED_DOCUMENTATION.md#extension-protocol)
- [Registros de extensión](DETAILED_DOCUMENTATION.md#extension-registers)
- [Construcción y verificación](DETAILED_DOCUMENTATION.md#build-and-verification)
- [Diseño del repositorio](DETAILED_DOCUMENTATION.md#repository-layout)
- [Límites actuales](DETAILED_DOCUMENTATION.md#current-limits)


Consulte [tools](tools/README.md) para ver guías de comandos individuales y [firmware](firmware/README.md) para ver la cadena de herramientas de compilación.
<!-- /translated-content -->
