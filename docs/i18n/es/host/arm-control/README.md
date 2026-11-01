<!-- translation-navigation -->
[English](../../../en/host/arm-control/README.md) · [Русский](../../../ru/host/arm-control/README.md) · [Español](README.md) · [Français](../../../fr/host/arm-control/README.md) · [Deutsch](../../../de/host/arm-control/README.md) · [Português (Brasil)](../../../pt-BR/host/arm-control/README.md) · [简体中文](../../../zh-CN/host/arm-control/README.md) · [日本語](../../../ja/host/arm-control/README.md) · [हिन्दी](../../../hi/host/arm-control/README.md) · [العربية](../../../ar/host/arm-control/README.md)

[Original en inglés](../../../../../host/arm-control/README.md)

> Traducción automática completa, aún no revisada por un hablante nativo. Las imágenes y los vídeos son compartidos; su texto permanece en el idioma original.
<!-- /translation-navigation -->

<!-- translated-content -->
<a id="shared-arm-controller-and-gravity-compensation"></a>
# Controlador de brazo compartido y compensación de gravedad.

La teleoperación en vivo, la sintonización, la repetición named-pose y la repetición timed-session utilizan un controlador seguidor. Maneja la configuración, los objetivos, la retroalimentación medida, la gravedad y la limpieza. El [servocontrolador](../servo-driver/README.md) posee la codificación y el transporte de paquetes.

<a id="motor-settings-files"></a>
## Archivos de configuración del motor

Consulte los perfiles [SO-101 y SO-102](profiles/README.md) para conocer las configuraciones de referencia y sus límites operativos.

`profiles` puede contener configuraciones en línea o rutas relativas al archivo del controlador:

```json
"profiles": {"1": "motor-1.json", "2": "motor-2.json"}
```

El [perfil de ejemplo](../../../../../host/arm-control/profile.example.json) es compartido por los ejemplos de herramientas. Cópielo para su propia configuración y actualice la referencia, o inserte el perfil. Si mueve un archivo de controlador, ajuste su perfil y sus rutas de gravedad. Git ignora los archivos denominados `*.local.json`.

Establezca `acceleration` en counts/s² (1–30000) y `rampTimeMs` en milisegundos (1–255) en el controlador. Cada motor puede anularlos con `accelerationLimit` y `rampTimeMs` en su perfil. Los perfiles son configuraciones de extensión RAM; Las compensaciones del codificador guardadas y los límites de recorrido permanecen separados.

| Campo de perfil | Significado |
| --- | --- |
| `kpQ8`, `kdQ8`, `kiQ8` | Ganancias del controlador multiplicadas por 256. |
| `integralLimit`, `effortLimit` | Límites de producción integral y total en PWM unidades de esfuerzo. |
| `velocityLimit` | Velocidad máxima en counts/s; El valor predeterminado es 65535. |
| `velocityFilterQ8` | Configuración del filtro de velocidad medida, 1–255. |
| `gravitySlewEffortPerS` | Límite de tasa para cambios de esfuerzo por gravedad. |
| `velocityFeedforward` | `positiveGainQ8`, `negativeGainQ8`, `effortLimit`; ponga a cero los tres para desactivarlos. |

Consulte la [guía de registro de firmware](../../DETAILED_DOCUMENTATION.md#configuration--0xa0) para conocer unidades y rangos completos. Estas son configuraciones de per-motor, no perfiles de firmware intercambiables.

Uso de la aplicación de ajuste y configuración `joints: [{ "followerId": 1 }]`; agregue una entrada por motor controlado. Named-pose la reproducción obtiene los ID de la grabación y no necesita una matriz `joints`. Solo la teleoperación en vivo y la repetición recorded-leader necesitan `leaderId`, `mapping` y opcional direction/centers; ver [mapeo de teleoperación](../../tools/teleoperation/README.md#mapping-and-control).

<a id="enable-gravity"></a>
## Habilitar la gravedad

Agregue `gravityModel` a su configuración existente. Las rutas son relativas al **archivo de configuración**, no al directorio de trabajo. Para una configuración guardada en la raíz del repositorio:

```json
"gravityModel": "host/arm-control/models/arm-upright-empty.json"
```

Esta línea es una adición a una configuración completa, no un archivo independiente. Proporcionar `profiles` probado para cada seguidor; `effortLimit` limita la potencia total del motor y `gravitySlewEffortPerS` limita la rapidez con que cambia el esfuerzo de gravedad. Configurar el giro por sí solo no habilita la gravedad. Sin `gravityModel`, la repetición borra cualquier esfuerzo de gravedad retenido y luego se ejecuta sin compensación de gravedad.

Los [modelos de brazo](models/README.md) suministrados preservan la calibración de cada brazo vertical, empty-gripper. Sus coeficientes para motores 2–4 utilizan recuentos de codificadores medidos, incluidas las juntas acopladas; los motores 1, 5 y 6 usan explícitamente cero. Cada seguidor controlado necesita un modelo, y todas las uniones utilizadas por sus términos deben controlarse y medirse. Los modelos Angle-dependent también declaran `encoderCalibration` para cada entrada: firmado `positionCorrection`, `resolution: 1` y `reverse` (el indicador de inversión del codificador). Preflight los compara con los registros del motor y rechaza una discrepancia antes de la configuración o la habilitación del par. Restaure una copia de seguridad coincidente de ese mismo brazo o actualice y valide el modelo después de la recalibración. Una captura de referencia en 2048 no establece por sí misma los ángulos físicos del modelo; consulte la [guía de calibración](../../tools/settings/README.md#choose-the-reference-pose). Para cualquiera de los modelos six-motor suministrados, incluya los ID 1–6 y los seis perfiles. No reutilice el modelo después de cambiar las compensaciones, el montaje, la geometría o la carga útil del codificador sin verificar la calibración.

Utilice el mismo campo de configuración para cada comando:

```sh
npm run teleoperate -- CONFIG.json
npm run replay -- CONFIG.json POSES.json
npm run replay -- CONFIG.json SESSION.ndjson
```

Estos comandos solo muestran una vista previa. Agregue `--run` para iniciar el control. La configuración actual y las posiciones medidas de los seguidores determinan la gravedad; Los valores de gravedad registrados y las ganancias históricas nunca se repiten. El modelo se valida antes de su uso y su ruta y el hash SHA-256 se incluyen en el registro de la sesión.

<a id="control-behaviour"></a>
## Comportamiento de control

1. La verificación previa verifica el firmware, los límites guardados, el estado, los perfiles y las entradas del modelo.
2. Todas las herramientas del controlador continúan una sesión motorizada compatible o preparan una nueva automáticamente. Los perfiles coincidentes mantienen el torque; Los perfiles modificados se aplican un motor a la vez. La nueva configuración maneja la liberación, configuración y selección del par y luego habilita todos los motores preparados juntos.
3. La gravedad se mide, envía y confirma antes del primer objetivo de movimiento.
4. Durante el movimiento y las pausas, un pase de retroalimentación proporciona controles de salud y cálculos de gravedad. La gravedad se actualiza aproximadamente cada 50 ms. No hay un segundo lector de telemetría ni un bucle de avance de velocidad del host.
5. En una salida normal, la gravedad continúa durante el movimiento final y la gravedad del firmware restante se desplaza. El controlador espera 200 ms de descanso, con un tiempo de espera de finalización de 30 s, luego confirma la actualización final de la gravedad. El torque permanece; El firmware conserva el último objetivo y el esfuerzo de gravedad.

Para reproducción y teleoperación, Ctrl+C detiene nuevos objetivos y sigue la misma secuencia de finalización. En cambio, el ajuste interrumpe el lote e intenta torque-off. Ctrl+C no es una parada de emergencia. Descanso significa que los planificadores se han detenido y cada posición medida permanece dentro de un rango de one-count durante todo el intervalo de 200 ms. No prueba que el error de seguimiento sea cero; pose/session la reproducción también aplica su tolerancia de llegada configurada.

El proceso deja de refrescar la gravedad después de la salida. Si posteriormente se mueve el brazo o cambia su carga, el esfuerzo retenido no se adapta. Un proceso interrumpido o un bus desconectado también pueden dejar activo el último objetivo y esfuerzo.

<a id="checks-and-timing"></a>
## Controles y tiempos

Gravity utiliza posiciones de seguidores medidas, nunca objetivos solicitados. Una muestra de comentarios debe ser saludable, nueva y pertenecer a la sesión actual. Cada actualización de gravedad tiene su propia secuencia; la aceptación se verifica en el siguiente pase de retroalimentación. Todos los resultados se comparan con el modelo y los límites de esfuerzo motor antes de cualquier escritura. Un resultado excesivo es un error, no un valor recortado.

Las mediciones acopladas son secuenciales. La adquisición, la puesta en cola y las escrituras posteriores deben permanecer dentro de los 100 ms del inicio de su pase de retroalimentación. La próxima actualización también debe ocurrir dentro de ese límite; un lector, registrador o bus retrasado provoca una falla en lugar de continuar silenciosamente con la antigua gravedad. Estas son comprobaciones del host, no tiempos de espera del firmware. El asincrónico I/O puede retrasar la detección; no convierten al host en un controlador real-time.

Los controles de salud en vivo se ejecutan aproximadamente cada 250 ms sin gravedad o cada 50 ms con ella. La reproducción utiliza retroalimentación detallada C2 cada 50 ms durante las pausas y la reproducción cronometrada; los controles de llegada pueden sondear más rápido. `--compact` sustituye a paquetes C1 más pequeños, que omiten las posiciones intermedias del planificador y las contribuciones PID. El ajuste lee comentarios detallados para todos los motores al inicio, luego C2 para la sonda y C1 para los motores de soporte. Los comentarios siempre comparten el lector de gravedad.

Errores de modelo, actualizaciones rechazadas, missing/stale comentarios, pérdida de propiedad, alarmas y temperaturas iguales o superiores a 60 °C, intento verificado torque-off en cada seguidor preparado. Se informan fallas de limpieza.

Una excepción es el incumplimiento de la fecha límite gravity-update durante una retención establecida: el controlador retiene el torque solo si dos nuevos pases de retroalimentación confirman motores estacionarios y en buen estado en la misma sesión. La ejecución aún falla e informa `holdRetained: true`; no se reanuda automáticamente.

Los registros de telemetría incluyen retroalimentación medida y la última gravedad solicitada effort/sequence. Los comentarios del firmware confirman esa solicitud en una muestra posterior; una solicitud registrada por sí sola no es prueba de aceptación. `settledAt` es una estimación conservadora del anfitrión de cuándo puede finalizar el movimiento de gravedad solicitado.

<a id="api-and-tests"></a>
## API y pruebas

`session.run` gestiona conexiones serie, registros de sesiones y limpieza de una fuente de entrada. `ArmController` acepta un controlador seguidor, configuración, fuente de entrada y una instancia `GravityModel` opcional. Cargue modelos con `await GravityModel.load(filename)`; el CLI resuelve el camino configuration-relative. Las fuentes de entrada proporcionan `joints`, `preflight`, `describe`, `sample` y `play`; La entrada en vivo también verifica que su líder no esté encendido. La sintonización automatizada puede solicitar información detallada para el motor de su sonda a través del mismo lector. `changeProfile` verifica el control estacionario, libera solo ese motor, lo configura y re-enables, luego confirma la gravedad nuevamente. Los motores de soporte permanecen encendidos. El motor modificado pierde brevemente el par y al volver a arrancar recupera su posición medida; Utilice una postura con apoyo o mecánicamente segura para los cambios de perfil. Los errores de perfil utilizan la limpieza de fallas normal all-motor.

Las fuentes envían posiciones a través del controlador y utilizan sus esperas atendidas, por lo que las pausas prolongadas continúan con las actualizaciones de retroalimentación.

Ejecute `npm run test:arm` para el controlador compartido, `npm run test:poses` para recording/replay y `npm run test:teleoperation` para control en vivo. Las pruebas utilizan respuestas en serie simuladas.
<!-- /translated-content -->
