<!-- translation-navigation -->
[English](../../../en/tools/tuning/README.md) · [Русский](../../../ru/tools/tuning/README.md) · [Español](README.md) · [Français](../../../fr/tools/tuning/README.md) · [Deutsch](../../../de/tools/tuning/README.md) · [Português (Brasil)](../../../pt-BR/tools/tuning/README.md) · [简体中文](../../../zh-CN/tools/tuning/README.md) · [日本語](../../../ja/tools/tuning/README.md) · [हिन्दी](../../../hi/tools/tuning/README.md) · [العربية](../../../ar/tools/tuning/README.md)

[Original en inglés](../../../../../tools/tuning/README.md)

> Traducción automática completa, aún no revisada por un hablante nativo. Las imágenes y los vídeos son compartidos; su texto permanece en el idioma original.
<!-- /translation-navigation -->

<!-- translated-content -->
<a id="automated-tuning"></a>
# Sintonización automatizada

Ejecute un lote limitado de configuraciones candidatas, compare movimientos repetidos y retenciones más prolongadas y obtenga una recomendación machine-readable. Utiliza el mismo controlador, controlador y modelo de gravedad calibrado v9 como reproducción y teleoperación. No se escribe ninguna configuración en EEPROM y no se instala automáticamente ningún candidato ganador.

<a id="start"></a>
## Empezar

Desde la raíz del repositorio, instale Node.js 20+ dependencias con `npm install`. Copie `controller.example.json` y `example.json` junto a los originales como `controller.local.json` y `plan.local.json`. Configure el `config` del plan en `controller.local.json`, luego edite el puerto, las identificaciones del motor, los perfiles, los pares de viajes conjuntos seguros y los límites para su mecanismo. Los ejemplos de ganancias y poses son ilustrativos. El controlador hace referencia al [perfil de motor](../../../../../host/arm-control/profile.example.json); cópielo para su propia configuración y actualice su ruta, o inserte el perfil. Incluya todos los motores de soporte como `{ "followerId": ID }` en `joints`; no se necesita mapeo de líderes. Complete la [calibración](../settings/README.md#choose-the-reference-pose) antes de elegir las posiciones de prueba. Las posiciones utilizan recuentos de codificador corregidos; un nuevo desplazamiento cambia su significado físico. Actualice los pares de prueba, las grabaciones y el modelo de gravedad después de la recalibración. Para la gravedad, agregue `gravityModel` exactamente como se describe en la [guía del controlador compartido](../../host/arm-control/README.md).

La ruta `config` del plan es relativa al plan. El perfil del controlador y las rutas `gravityModel` son relativas a ese archivo de controlador. Se puede utilizar la misma configuración del controlador para la repetición de poses. Omita `durationMs` para realizar ajustes: el plan posee el presupuesto del lote. Asegure el mecanismo de inicio y cambios de perfil. Cambiar un perfil libera brevemente ese motor; Una nueva configuración puede liberar a todos los seguidores configurados.

```sh
npm run tune -- inspect tools/tuning/plan.local.json
npm run tune -- preflight tools/tuning/plan.local.json
npm run tune -- run tools/tuning/plan.local.json
```

La herramienta sigue apoyando las uniones en sus objetivos de retención de firmware existentes. Solo `probeId` recorre sus pares de prueba declarados. No hay reposicionamiento automático whole-arm. Los objetivos actuales y las posiciones medidas se registran para compararlos entre ejecuciones. Utilice rutas de articulación revisadas para la configuración actual del brazo.

Utilice el mismo comando para el primer lote y cada lote posterior:

```sh
npm run tune -- run NEXT_PLAN.json
```

Los cambios de inicio y perfil utilizan el [ciclo de vida del controlador compartido](../../host/arm-control/README.md#control-behaviour). No ejecute otro controlador en el mismo bus.

`inspect` no se conecta. `preflight` lee firmware, calibración, límites guardados, estado y perfiles sin cambiar los motores. `run` los mueve. Los objetivos están limitados a los límites de posición guardados; La verificación previa informa la ruta efectiva. Un par colapsado en una posición no se puede utilizar como ejercicio de sintonización.

<a id="tuning-order"></a>
## orden de afinación

1. **Línea de base:** verificar la calibración, el movimiento seguro, las temperaturas y la repetibilidad con las configuraciones existentes. Utilice `stage: "baseline"` y ningún candidato.
2. **Gravedad:** mantenga ganancias de retroalimentación modestas y compare la cámara lenta en ambas direcciones en varias poses y al menos dos velocidades. Comience con un modelo calibrado. `stage: "gravity"` recopila datos de identificación sin cambiar las ganancias.
3. **Avance de velocidad:** después de comprobar la gravedad, compare las ganancias de velocidad direccional utilizando un movimiento constante a más de una velocidad.
4. **P/D y filtrado de velocidad:** filtra un pequeño conjunto explícito de candidatos. Incluya posturas con carga de gravedad alta y baja, luego use posiciones más largas para exponer las oscilaciones. Un pequeño lote factorial puede comparar P, D y filtrado juntos; verifique la mejor combinación en los pares held-out.
5. **Integral:** solo si persiste un error persistente; compare la precisión del movimiento y las retenciones prolongadas. Incluya pequeñas inversiones: los barridos largos por sí solos pueden pasar por alto un límite integral que impide que una junta estacionaria supere la fricción. Mantenga el cero integral a menos que el resultado admita habilitarlo.
6. **Tiempo de aceleración y rampa:** con ganancias fijas, use `stage: "motion"` para comparar la aceleración y el suavizado a las velocidades requeridas.
7. **Movimiento combinado:** reproduce un recorrido grabado que ejercita cada articulación e incluye configuraciones plegadas y extendidas. Una ganancia que funciona con articulaciones de soporte estacionarias puede oscilar cuando todo el mecanismo se mueve. Vuelva a verificar las uniones modificadas en este mismo camino antes de aceptar sus configuraciones.
8. **Validación:** congela la configuración seleccionada, repite el camino a cada velocidad y aceleración requeridas, luego mantén posturas representativas por más tiempo. Registre la precisión, el exceso, el asentamiento, la temperatura y la saturación de salida para cada motor. Vuelva a verificar después de cambiar la carga útil o la calibración.

`stage` restringe los campos candidatos: `velocity` permite `velocityFeedforward`; `pid` permite `kpQ8`, `kdQ8`, `velocityFilterQ8`; `integral` permite `kiQ8` y `integralLimit`; `motion` permite `accelerationLimit` y `rampTimeMs`. Las etapas de referencia, gravedad y validación recopilan datos sin cambios en los candidatos. P/D/I y las ganancias de velocidad utilizan las unidades Q8 del firmware: divida por 256 para obtener la ganancia correspondiente. Los límites de salida siguen siendo los límites del controlador proporcionados explícitamente en todo el lote.

Mantenga fijos el tiempo de aceleración y rampa mientras compara las ganancias. Luego compare los ajustes de movimiento a las velocidades requeridas. La aceleración máxima configurable es 30,000 counts/s²; el valor útil depende de los límites de carga y esfuerzo. Compruebe las velocidades reales de referencia y medidas: es posible que las carreras cortas nunca alcancen la velocidad solicitada.

La ganancia integral y su límite deben probarse juntos. Una gran corrección acumulada puede continuar impulsando una articulación después de que se libera la fricción, provocando un exceso. El límite integral limita sólo esa corrección; la salida total del motor se controla por separado mediante `effortLimit`. Prefiera un error residual estable a una búsqueda repetida e informe cualquier criterio de precisión que la configuración seleccionada no cumpla.

<a id="reuse-settings"></a>
## Reutilizar configuración

Un perfil de controlador puede ser un archivo JSON independiente, por ejemplo `"profiles": {"1": "motor-1.json"}`. Las rutas son relativas al archivo del controlador. Los archivos de motor contienen los mismos campos que los perfiles en línea; opcionales `accelerationLimit` y `rampTimeMs` anulan los valores predeterminados compartidos. La reproducción, la teleoperación y el ajuste cargan estos archivos a través del mismo cargador. La configuración se aplica a RAM durante la configuración de la extensión, no se guarda en EEPROM.

Exporte un controlador a un nuevo directorio que contenga un archivo por motor, `controller.json`, un `gravity.json` opcional y un manifiesto:

```sh
npm run tune -- export CONFIG.json NEW_DIRECTORY
```

La exportación no se conecta a los motores ni certifica la configuración. Utilice el `controller.json` exportado con repetición, teleoperación o un plan de ajuste.

Para aplicar la configuración aceptada y mantener la posición actual:

```sh
npm run tune -- apply NEW_DIRECTORY/controller.json
```

El arranque maneja automáticamente los motores con y sin alimentación. En una sesión existente, sólo los motores cambiados se desactivan y reconfiguran brevemente, uno a la vez. Los motores de apoyo permanecen encendidos y se conservan los objetivos existentes. Omitir el modelo de gravedad borra el esfuerzo de gravedad retenido. La reproducción aplica su configuración automáticamente, por lo que este comando solo es necesario para aplicar la configuración sin reproducir.

Mantenga juntos los ajustes aceptados, el modelo de gravedad, la calibración, la descripción payload/mounting y la evidencia de validación. Otro brazo necesita su propia calibración y validación. No restablezca las compensaciones del codificador de otro brazo.

<a id="how-a-batch-works"></a>
## Cómo funciona un lote

Para la selección, la herramienta ejecuta línea de base → todos los candidatos → línea de base. Cada bloque ejercita cada par y velocidad en ambas direcciones, alternando el primer enfoque en las repeticiones. Si las dos líneas de base se desvían más allá de `driftRatio`, el lote termina sin ser concluyente y mantiene su control. La deriva de posición permite un conteo de cuantificación del codificador. Los candidatos elegibles se clasifican y hasta `finalists` repiten la comparación entre líneas de base compartidas en diferentes pares de validación con retenciones más largas. Una recomendación requiere pasar la validación y superar su línea de base.

Las métricas incluyen seguimiento de movimiento RMS, error y alcance de posición estable, sobreimpulso, tiempo de estabilización, tiempo de respuesta total y fracción de saturación. El asentamiento requiere un período final continuo dentro de la banda; un cruce temprano no cuenta. Si las retenciones de detección son más cortas que el tiempo de establecimiento permitido más la permanencia, las métricas de retención y liquidación se informan como diferidas. Luego, la selección clasifica el error de movimiento, el exceso y la saturación. La validación más larga debe superar todas las métricas antes de realizar una recomendación. La validación de uso se mantiene durante el tiempo suficiente para cubrir el tiempo de establecimiento permitido y un intervalo de observación constante. Los límites de aceptación se proporcionan en el plan. Se puede calificar una respuesta infructuosa pero válida; muestras obsoletas, alarmas, desbordamientos de control, error de seguimiento excesivo, movimiento de soporte, temperature/voltage límites o fallas de registro, detenga el lote y use la [limpieza de fallas compartidas](../../host/arm-control/README.md#checks-and-timing). Un lote fallido no proporciona ninguna recomendación.

La retroalimentación y la gravedad utilizan el [lector compartido](../../host/arm-control/README.md#checks-and-timing). El plan estima el uso de cables y rechaza solicitudes iguales o superiores al 50% de la capacidad nominal; Los espacios reales se verifican durante la ejecución. La visualización lee el registro.

**Cambiar un perfil elimina brevemente el torque de ese motor.** Los motores de soporte permanecen controlados. El controlador espera el descanso antes del cambio y luego confirma la gravedad; ver [cambios de perfil](../../host/arm-control/README.md#api-and-tests).

Una retención de punto final ya completada se reutiliza antes de invertir la dirección; la herramienta no envía un objetivo de configuración duplicado ni agrega otro retraso de configuración.

La finalización normal restaura la línea de base configurada y conserva la sujeción eléctrica con compensación de gravedad final. Ctrl+C interrumpe el lote de ajuste e intenta torque-off; Apoye el mecanismo antes de interrumpirlo. Un proceso desconectado o cancelado puede dejar el firmware reteniendo su último objetivo. La herramienta no vuelve automáticamente a la posición de reposo.

<a id="results-and-agent-workflow"></a>
## Resultados y flujo de trabajo de los agentes

Las ejecuciones se guardan en directorios `tools/tuning/logs/<run>/` ignorados:

- `events.ndjson`: exacto plan/configuration, hashes de implementación, modelo de gravedad, calibración, cambios de perfil, comandos, mediciones y resultados de pruebas.
- `summary.json`: estado de finalización, comparaciones, validación y recomendación.

Envíe un plan que contenga varios candidatos explícitos, deje que termine todo el lote y luego inspeccione el resumen. Utilice los eventos sin procesar para criterios fallidos o resultados ambiguos. Esto evita una ronda de proceso y análisis por parámetro. Un presupuesto de duración siempre acota la obra. Un lote incompleto no tiene recomendación.

Vuelva a calcular los resultados o extraiga las ventanas de identificación steady-motion:

```sh
npm run tune -- analyse tools/tuning/logs/RUN/events.ndjson
node tools/tuning/cli.js extract tools/tuning/logs/RUN/events.ndjson > tools/tuning/logs/dataset.json
node tools/tuning/cli.js fit tools/tuning/logs/dataset.json
```

La extracción requiere ejecuciones gravity/velocity completadas, en ambas direcciones y múltiples velocidades tanto en el cribado como en la validación. Rechaza ventanas aceleradas, saturadas, mal medidas y moving-support. Los ajustes mantienen separadas trayectorias completas entre el entrenamiento y la validación, y utilizan la base de la gravedad en tiempo de ejecución. Devuelven coeficientes effort-space no revisados, torque articular no medido o un modelo desplegable. Actualice el modelo y repita deliberadamente las comprobaciones de hardware independientes.

Utilice el [visor de simulación](../simulation/README.md) en el mismo archivo de evento para inspeccionar el brazo durante o después de una carrera. No agrega tráfico de autobuses.

<a id="tests"></a>
## Pruebas

Ejecute `npm run test:tuning` o `npm test` para todas las herramientas de Node.js. Las pruebas no se conectan a los motores.
<!-- /translated-content -->
