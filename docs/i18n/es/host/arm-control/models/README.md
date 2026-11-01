<!-- translation-navigation -->
[English](../../../../en/host/arm-control/models/README.md) · [Русский](../../../../ru/host/arm-control/models/README.md) · [Español](README.md) · [Français](../../../../fr/host/arm-control/models/README.md) · [Deutsch](../../../../de/host/arm-control/models/README.md) · [Português (Brasil)](../../../../pt-BR/host/arm-control/models/README.md) · [简体中文](../../../../zh-CN/host/arm-control/models/README.md) · [日本語](../../../../ja/host/arm-control/models/README.md) · [हिन्दी](../../../../hi/host/arm-control/models/README.md) · [العربية](../../../../ar/host/arm-control/models/README.md)

[Original en inglés](../../../../../../host/arm-control/models/README.md)

> Traducción automática completa, aún no revisada por un hablante nativo. Las imágenes y los vídeos son compartidos; su texto permanece en el idioma original.
<!-- /translation-navigation -->

<!-- translated-content -->
<a id="gravity-models"></a>
# Modelos de gravedad

Se incluyen dos modelos verticales empty-gripper:

- `arm-upright-empty.json`: SO-102.
- `so101-upright-empty.json`: SO-101.

Ambos incluyen calibración de codificador y términos acoplados para motores 2–4. Los motores 1, 5 y 6 tienen compensación cero explícita. Asumen el montaje original, las compensaciones del codificador y la geometría del enlace. Vuelva a verificar el hardware antes de usar una configuración diferente. Los [perfiles de controlador](../profiles/README.md) coincidentes describen sus configuraciones operativas y las limitaciones restantes.

El archivo contiene coeficientes de esfuerzo PWM con signo y la configuración del codificador en la que se ajustaron. `encoderCalibration` enumera las correcciones de posición con signo, la resolución de la unidad y la inversión del codificador para cada motor. La verificación previa requiere que coincidan con el brazo conectado. Los límites y las ganancias son configuraciones separadas.

La calibración hace que la pose física capturada se lea 2048; no identifica los ángulos de articulación utilizados por estos modelos. Esos ángulos ya están incluidos en el término pesos y compensaciones. Reproducir la misma postura en otro brazo puede producir diferentes compensaciones motoras. Ajustar o adaptar el modelo a ese brazo y verificar su salida; no copie compensaciones del modelo suministrado en los motores. Cambiar solo `encoderCalibration` no actualiza el cálculo de gravedad. Ver [elegir una pose de referencia](../../../tools/settings/README.md#choose-the-reference-pose).

Cada motor tiene un `maxEffort`, un `note` explicativo y una lista de `terms`. Un término contribuye `coefficient * sin(angle)` o `coefficient * cos(angle)`, donde `angle = offsetRad + sum(measuredEncoderCounts[id] * weights[id])`. Los ángulos son radianes. Un término `constant` aporta su coeficiente y no tiene pesos. Una lista vacía solicita explícitamente una compensación cero.

Todos los ID de motor ponderados deben estar entre los seguidores controlados. Cada seguidor requiere un modelo explícito. La evaluación rechaza entradas faltantes, valores no finitos y esfuerzos por encima del límite del modelo o del límite de esfuerzo del motor configurado; nunca recorta silenciosamente un resultado excesivo.
<!-- /translated-content -->
