<!-- translation-navigation -->
[English](../../../en/tools/poses/README.md) · [Русский](../../../ru/tools/poses/README.md) · [Español](README.md) · [Français](../../../fr/tools/poses/README.md) · [Deutsch](../../../de/tools/poses/README.md) · [Português (Brasil)](../../../pt-BR/tools/poses/README.md) · [简体中文](../../../zh-CN/tools/poses/README.md) · [日本語](../../../ja/tools/poses/README.md) · [हिन्दी](../../../hi/tools/poses/README.md) · [العربية](../../../ar/tools/poses/README.md)

[Original en inglés](../../../../../tools/poses/README.md)

> Traducción automática completa, aún no revisada por un hablante nativo. Las imágenes y los vídeos son compartidos; su texto permanece en el idioma original.
<!-- /translation-navigation -->

<!-- translated-content -->
<a id="record-and-replay-poses"></a>
# Grabar y reproducir poses.

Registre posiciones con nombre sin torsión y luego reprodúzcalas con configuraciones heredadas guardadas o configuraciones de extensión ajustadas. Los comandos se ejecutan desde la raíz del repositorio.

| Comando | Entrada | firmware |
| --- | --- | --- |
| `npm run record-poses` | Posicionamiento manual | Fábrica o personalizado |
| `npm run replay` | Poses con nombre o una sesión de teleoperación. | Extensión v9 |
| `npm run replay-legacy` | Poses nombradas | V9 de fábrica o personalizado |

<a id="record-poses"></a>
## Grabar poses

Instale Node.js 20 o posterior, luego ejecútelo desde la raíz del repositorio:

```sh
npm install
npm run record-poses -- --port /dev/ttyUSB0 --ids 1,2,3
```

Reemplace el puerto y las ID para su configuración. Los indicadores opcionales son `--baud` (predeterminado 1000000), `--output DIR` y `--timeout-ms` (predeterminado 1000).

Termine [calibración de compensación y límite](../settings/README.md#calibrate-joint-offsets-and-limits) primero. Las poses grabadas son puntos de referencia de movimiento; capturar una pose llamada `home` o `reference` no cambia la calibración del motor.

1. Apoye el mecanismo para que no pueda caer cuando se libere el torque.
2. Presione Entrar en el mensaje de confirmación. El registrador desactiva el par en los motores seleccionados y verifica que esté apagado. Otros motores no se cambian.
3. Mueva el mecanismo, manténgalo quieto y luego presione Entrar para capturar una pose. En su lugar, puede escribir un nombre único; las poses sin nombre se convierten en `position-1`, `position-2`, etc.
4. Repita según sea necesario. Escriba `done` para finalizar o presione Ctrl+C para interrumpir.

El torque permanece apagado después de grabar. Las lecturas son secuenciales, por lo que cada pose es una instantánea de un mecanismo estacionario, no una medición de movimiento sincronizada. Una lectura faltante, alarma o motor habilitado detiene la sesión. Al salir, la herramienta intenta desactivar el torque nuevamente e informa cualquier verificación fallida.

<a id="saved-files"></a>
## Archivos guardados

Se crea un nuevo archivo JSON en `tools/poses/recordings/` para cada sesión. Cada captura exitosa reemplaza ese archivo de forma atómica; Las poses guardadas anteriormente permanecen disponibles si falla una captura posterior. Git ignora las grabaciones.

El formato `sts-poses` versión 1 identifica las posiciones por motor ID, no por orden de matriz:

```json
{
  "format": "sts-poses",
  "version": 1,
  "units": "encoder-counts",
  "ids": [1, 3],
  "readMode": "sequential",
  "poses": [
    {
      "name": "home",
      "capturedAt": "2026-10-24T12:00:00.000Z",
      "durationMs": 4.2,
      "positions": {"1": 2048, "3": 3100}
    }
  ]
}
```

Los archivos también incluyen el tiempo de sesión, el puerto serie y la velocidad en baudios. Poseer marcas de tiempo que marquen cuándo comienza la lectura; `durationMs` mide la adquisición total. Los recuentos son posiciones informadas firmadas, que ya incluyen el ajuste de dirección y compensación del motor, sin conversión a ángulos. El archivo no tiene configuraciones de velocidad, aceleración o tiempo de reproducción, ni instantánea de calibración. Re-record posa después de cambiar la calibración del codificador; La reproducción no puede detectar que un archivo de pose antiguo utiliza diferentes compensaciones.

<a id="replay-poses"></a>
## Repetir posturas

Copie [replay.example.json](../../../../../tools/poses/replay.example.json) junto al original, por ejemplo como `tools/poses/controller.local.json`. Configure `followerPort` y proporcione una entrada `profiles` por motor registrado. Las identificaciones provienen de la grabación; no se necesita ningún líder ni mapeo conjunto. El ejemplo hace referencia al [perfil de motor](../../../../../host/arm-control/profile.example.json)] compartido. Copie ese perfil para su propia configuración y actualice su ruta, o coloque la configuración en línea. Todos los perfiles y rutas de gravedad son relativos al archivo del controlador. Las ganancias de ejemplo ilustran el formato; Utilice la configuración probada en su mecanismo.

```sh
npm run replay -- CONFIG.json POSES.json
npm run replay -- CONFIG.json POSES.json --run
```

El primer comando obtiene una vista previa de la ruta completa sin cambiar la configuración e informa los objetivos limitados a los límites guardados. `--run` inicia el movimiento, incluido el acercamiento desde la posición actual a la primera pose. Sólo se abre el puerto seguidor. Se aceptan y validan archivos de hasta 64 MiB antes de que se abra un puerto.

El [controlador compartido](../../host/arm-control/README.md) aplica perfiles, maneja sesiones activas existentes y proporciona compensación de gravedad cuando `gravityModel` está configurado. **La finalización normal y Ctrl+C retienen la energía.** Las fallas utilizan la limpieza del controlador; Ctrl+C no es una parada de emergencia. Opcional top-level `durationMs` finaliza la reproducción antes de tiempo; omítalo para reproducir todo el archivo.

Cada pose se envía en un comando grupal. Las velocidades de las juntas aumentan con la distancia recorrida, sujetas a la velocidad de repetición y al límite de velocidad de cada motor. Cada motor genera su propio S-curve, por lo que la llegada es aproximada y los puntos de referencia no se combinan. La reproducción espera a que finalicen los planificadores y entren todas las posiciones medidas en `toleranceCounts`, luego inicia la espera. Un movimiento superior a `moveTimeoutMs` falla. Las marcas de tiempo grabadas manualmente no establecen la velocidad de reproducción.

| `replay` ajuste | Predeterminado | Significado |
| --- | --- | --- |
| `speed` | 1000 | Velocidad máxima, 1–65535 codificador counts/s. |
| `holdMs` | 1000 | Pausa después de la llegada, 0–600000 ms. |
| `repeat` | 1 | Número de pases, 1–1000; cada pase vuelve a la primera pose. |
| `moveTimeoutMs` | 30000 | Tiempo de espera de llegada, 1–600000 ms. |
| `toleranceCounts` | 10 | Error de posición medido permitido, 0–32767 cuenta. |

<a id="replay-a-recorded-session"></a>
## Reproducir una sesión grabada

Reproducir un registro de teleoperación sin conectar al líder:

```sh
npm run replay -- CONFIG.json SESSION.ndjson
npm run replay -- CONFIG.json SESSION.ndjson --run
```

La grabación debe contener un `preflight` con límites de líder y mapeo conjunto, seguido de `command` eventos con marcas de tiempo monótonas y todas las posiciones de líder. Utilice el mismo mapeo conjunto en la configuración actual. Las posiciones del líder registradas se asignan a través de los límites del líder registrados y los límites actuales del seguidor. Se aplican perfiles actuales y gravedad; Los escenarios y esfuerzos históricos no se reutilizan. Es posible que un comando previsto en un registro fallido nunca haya llegado a los motores.

La reproducción conserva los espacios grabados; los retrasos en el procesamiento estiran el tiempo en lugar de enviar ráfagas catch-up. Los comentarios y las actualizaciones de gravedad continúan durante las pausas. Se aplican `replay.repeat`, `moveTimeoutMs` y `toleranceCounts`; `speed` y `holdMs` se aplican solo a poses nombradas. El último cuadro debe llegar antes de completarse.

<a id="legacy-replay"></a>
## Repetición heredada

Utilice la configuración PID guardada de los motores sin avance de velocidad de extensión ni compensación de gravedad. No se necesita ningún archivo de controlador y la configuración persistente no se modifica. Los motores necesitan modo de posición absoluta y resolución del codificador unitario.

```sh
npm run replay-legacy -- POSES.json --port /dev/ttyUSB0
npm run replay-legacy -- POSES.json --port /dev/ttyUSB0 --run
```

El primer comando muestra una vista previa; `--run` se mueve. Las identificaciones provienen del archivo de pose; Otros motores en el adaptador se dejan solos. El firmware personalizado cambia al modo heredado. La configuración desactiva brevemente y re-enables cada motor seleccionado, iniciando primero su posición actual.

| Opción | Predeterminado | Significado |
| --- | --- | --- |
| `--speed` | 1000 | Velocidad máxima, 1–32767 codificador counts/s. |
| `--acceleration` | 5000 | Counts/s², 100–25400 en múltiplos de 100. Se aplican límites guardados. |
| `--hold-ms` | 1000 | Mantenga presionado después de cada movimiento planificado, 0–600000 ms. |
| `--baud` | 1000000 | Velocidad en baudios del adaptador. |

Cada postura utiliza un comando grupal y velocidades distance-scaled para una llegada aproximadamente simultánea. Los objetivos están limitados a los límites de posición guardados. La reproducción espera a que finalicen los perfiles de movimiento internos y luego se detiene; no requiere error de posición medido cero. Un movimiento que dura más de 30 segundos falla.

La finalización retiene el torque en la postura final. A diferencia de la reproducción de extensión, **Ctrl+C intenta torque-off**, al igual que los fallos. Se informan fallas de limpieza.

<a id="logs-and-visualization"></a>
## Registros y visualización

Ambos comandos de reproducción guardan registros en ignorado `logs/motion/`, incluida la calibración, la identidad de la fuente, los comandos y los comentarios. Inicie el [visor de telemetría](../simulation/README.md) una vez, luego ejecute las repeticiones en otra terminal:

```sh
mkdir -p logs/motion
tools/simulation/.venv/bin/python tools/simulation/viewer.py live logs/motion --model so102
```

Utilice `--model so101` para el otro modelo incluido y una asignación de codificador coincidente. La repetición de extensión lee comentarios detallados de la referencia en movimiento mostrada por el espectador. Para reducir el tráfico, agregue `--compact`; el movimiento medido y la compensación permanecen activos, pero la sombra muestra destinos en lugar de posiciones intermedias del planificador. PID También se omiten los términos y las contribuciones de compensación aplicadas. Consulte [comentarios y tiempos](../../host/arm-control/README.md#checks-and-timing).

Ejecute pruebas de grabación sin conexión, reproducción de extensión y reproducción heredada con `npm run test:poses`.
<!-- /translated-content -->
