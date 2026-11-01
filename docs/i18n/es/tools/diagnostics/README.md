<!-- translation-navigation -->
[English](../../../en/tools/diagnostics/README.md) · [Русский](../../../ru/tools/diagnostics/README.md) · [Español](README.md) · [Français](../../../fr/tools/diagnostics/README.md) · [Deutsch](../../../de/tools/diagnostics/README.md) · [Português (Brasil)](../../../pt-BR/tools/diagnostics/README.md) · [简体中文](../../../zh-CN/tools/diagnostics/README.md) · [日本語](../../../ja/tools/diagnostics/README.md) · [हिन्दी](../../../hi/tools/diagnostics/README.md) · [العربية](../../../ar/tools/diagnostics/README.md)

[Original en inglés](../../../../../tools/diagnostics/README.md)

> Traducción automática completa, aún no revisada por un hablante nativo. Las imágenes y los vídeos son compartidos; su texto permanece en el idioma original.
<!-- /translation-navigation -->

<!-- translated-content -->
<a id="bus-benchmark-and-telemetry-diagnostics"></a>
# Diagnóstico de telemetría y benchmark de bus

Dos herramientas command-line para servos STS: miden el rendimiento de la comunicación y verifican la telemetría estacionaria para detectar lecturas inusuales. Requiere Node.js 20 o más reciente. Desde la raíz del repositorio, instale las dependencias con `npm install`.

Mantenga los motores estacionarios con el torque desactivado y los ajustes bloqueados. Detenga otros programas que utilicen el puerto serie. Ambas herramientas verifican los servos seleccionados antes y después de una ejecución. Ninguno de los dos habilita el torque, mueve un motor, actualiza el firmware o guarda la configuración.

<a id="bus-benchmark"></a>
## Punto de referencia de autobús

```sh
npm run bus-benchmark -- --port /dev/cu.usbmodemXXXX --ids 1,2 --repetitions 1000
```

De forma predeterminada, mide las solicitudes PING y READ de diferentes tamaños. Cada caso ejecuta 20 intentos de calentamiento, luego 1,000 intentos medidos por motor. El orden del motor rota entre rondas. Los intentos fallidos siguen siendo fracasos; los reintentos nunca los reemplazan.

Opciones útiles:

- `--list`: enumera casos sin abrir un puerto.
- `--cases ping,read-table-87`: ejecuta casos seleccionados.
- `--warmup 20`, `--repetitions 1000`: intentos por caso y motor.
- `--gap-ms 1`: pausa entre solicitudes; El valor predeterminado no es ninguna pausa adicional.
- `--results DIR`: padre de salida; el valor predeterminado es `tools/diagnostics/results`.
- `--include-writes`: también compara las escrituras reconocidas en los registros RAM 51–54. Estos registros no están documentados en otro firmware; Utilice esta opción sólo en un servo compatible verificado. Los valores originales se restablecen al finalizar, fallar o interrumpirse correctamente. Los reconocimientos de escritura deben estar habilitados.

Cada ejecución crea un nuevo directorio que contiene `summary.csv`, `report.json` y `samples.jsonl`. El resumen incluye mediana, p95, p99 y latencia máxima, además de recuentos de tiempo de espera y errores. Los registros sin procesar incluyen intercambios de calentamiento y limpieza.

La latencia va desde la llamada de escritura en serie hasta una respuesta decodificada coincidente. Incluye retrasos USB y operating-system; no es un tiempo de respuesta firmware-only ni una medición de la capacidad máxima del autobús. Los tiempos de espera se cuentan por separado y no se incluyen en los percentiles de latencia.

<a id="telemetry"></a>
## Telemetria

```sh
npm run telemetry -- --port /dev/cu.usbmodemXXXX --ids 1,2 \
  --samples 1000 --interval-ms 20 --output tools/diagnostics/results/telemetry-check
```

Lee 17 bytes comenzando en el registro 56, una vez por motor por ronda. El valor predeterminado es 100,000 muestras por motor sin pausa adicional. Utilice un nuevo directorio de salida para cada ejecución; Los archivos de muestra existentes nunca se sobrescriben.

- `--interval-ms 20`: intervalo mínimo entre inicios de ronda. Los espacios perdidos se omiten y se cuentan en `missedDeadlines`; Las rondas retrasadas no provocan ráfagas.
- `--gap-ms 1`: en su lugar, haga una pausa después de cada solicitud del motor. No se puede combinar con `--interval-ms`.
- `--voltage-min 5.5 --voltage-max 8.4`: rango de voltaje esperado en voltios; El valor predeterminado es 8–16 V. Configúrelo para los motores conectados y la fuente de alimentación.

Salidas: `samples.csv` contiene todos los intentos, `anomalies.jsonl` contiene lecturas marcadas e intercambios sin procesar, y `report.json` contiene recuentos, rangos, estadísticas de tiempo y before/after configuraciones. CSV el voltaje está en décimas de voltio; La posición, la velocidad, la corriente y el esfuerzo conservan sus unidades de registro sin procesar.

Comprueba los cambios de temperatura y voltaje del indicador, las lecturas inverosímiles, el estado distinto de cero y el esfuerzo mientras el torque está desactivado. La detección de picos de temperatura requiere tres respuestas válidas consecutivas; una respuesta faltante o no válida rompe la secuencia. Estos indicadores identifican lecturas que se deben inspeccionar, no pruebas de una falla del firmware o del sensor. Las lecturas estacionarias idénticas son normales y no demuestran datos obsoletos.

<a id="common-options-and-tests"></a>
## Opciones y pruebas comunes

Ambas herramientas aceptan `--baud 1000000`, `--timeout-ms 100` y `--help`. Los ID predeterminados son `1,2`; especificar los motores realmente conectados. El tiempo de espera de respuesta comienza después de que se agota la escritura en serie. Después de un tiempo de espera, las herramientas esperan un bus silencioso antes de continuar porque las respuestas no contienen números de secuencia.

Ctrl+C detiene la ejecución y realiza la limpieza. Los errores, las ejecuciones incompletas y las muestras marcadas producen un código de salida distinto de cero. Git ignora los resultados inferiores a `results/`.

```sh
npm run test:diagnostics
```

Estas pruebas fuera de línea no se conectan al hardware.
<!-- /translated-content -->
