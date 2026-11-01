<!-- translation-navigation -->
[English](../../../en/tools/hw-diff-tests/README.md) · [Русский](../../../ru/tools/hw-diff-tests/README.md) · [Español](README.md) · [Français](../../../fr/tools/hw-diff-tests/README.md) · [Deutsch](../../../de/tools/hw-diff-tests/README.md) · [Português (Brasil)](../../../pt-BR/tools/hw-diff-tests/README.md) · [简体中文](../../../zh-CN/tools/hw-diff-tests/README.md) · [日本語](../../../ja/tools/hw-diff-tests/README.md) · [हिन्दी](../../../hi/tools/hw-diff-tests/README.md) · [العربية](../../../ar/tools/hw-diff-tests/README.md)

[Original en inglés](../../../../../tools/hw-diff-tests/README.md)

> Traducción automática completa, aún no revisada por un hablante nativo. Las imágenes y los vídeos son compartidos; su texto permanece en el idioma original.
<!-- /translation-navigation -->

<!-- translated-content -->
<a id="hardware-comparison-tests"></a>
# Pruebas de comparación de hardware

Compare firmware de fábrica y personalizado en servos STS. La suite cubre el protocolo heredado, la configuración, el movimiento, la calibración y la protección. No prueba el control del protocolo de extensión v9. Las pruebas utilizan el [controlador compartido](../../host/servo-driver/README.md).

**Utilice un banco exclusivo con servos asegurados y ejes libres.** Algunas pruebas realizan movimientos largos o continuos y reemplazan las configuraciones o calibraciones guardadas. Primero haga una copia de seguridad de cada servo. Mantenga una manera de desconectar la energía del motor inmediatamente.

<a id="setup"></a>
## Configuración

Instale Node.js **20 o más reciente**, luego ejecútelo desde la raíz del repositorio:

```sh
npm ci
npm run test:diff
npm run diff -- --list
```

Estos comandos se ejecutan sin conexión. `--list` muestra la etapa de cada escenario, clasificación de movimiento y nombre exacto. Utilice `--help` para todas las opciones de comando.

Conecte sólo los servos de prueba: en algunos casos se utilizan transmisiones. Cierre otros programas utilizando el adaptador y proporcione una alimentación de motor adecuada. Las conexiones predeterminadas son:

| Configuración | Predeterminado |
|---|---|
| Servo de fábrica ID | `1` |
| Servo de firmware personalizado ID | `2` |
| Velocidad de baudios | `1000000` |

Establezca diferentes valores con `--factory-id`, `--candidate-id` y `--baud`. Las identificaciones deben ser distintas; Deje los ID **250 y 251** sin usar porque las pruebas los usan temporalmente. Comience con el torque desactivado, las escrituras de configuración están bloqueadas y sin alarmas activas. Utilice motores, fuentes de alimentación y cargas comparables al comparar el movimiento.

```sh
export SERVO_PORT=/dev/cu.usbmodemYOUR_ADAPTER
```

Reemplace el puerto por el suyo. Linux usa comúnmente `/dev/ttyUSB0`; en Windows, pase un puerto directamente, como `--port COM3`.

<a id="run-tests"></a>
## Ejecutar pruebas

Comience con una verificación de comunicación:

```sh
npm run diff -- --port "$SERVO_PORT" --case test_ping
```

Ejecute el grupo predeterminado:

```sh
npm run diff -- --port "$SERVO_PORT" --stage safe
```

El grupo `safe` verifica PING, registra lecturas y rechaza una escritura en un registro read-only. No acciona los motores, pero envía un paquete WRITE.

Seleccione un grupo con `--stage`, o un escenario exacto con `--case`:

```sh
npm run diff -- --port "$SERVO_PORT" \
  --case test_motion_write_order_gap_matrix --allow-motion
```

`--case` anula `--stage`. Las ejecuciones enfocadas utilizan la configuración de servo existente; no instalan la configuración de prueba del conjunto completo. Verifique los requisitos previos informados de un caso si no puede iniciarse.

| Permiso | Permite |
|---|---|
| `--allow-motion` | Habilitar la conducción o emitir comandos de movimiento |
| `--allow-persistence-write` | Escrituras de configuración guardadas, calibración y restore-defaults |
| `--allow-template-write` | Reemplazo de la plantilla de reinicio guardada |
| `--allow-current-protection` | Pruebas current-protection impulsadas; también necesita permiso de movimiento |

El conjunto completo requiere los cuatro permisos y una velocidad en baudios inicial de 1000000:

```sh
npm run diff -- --port "$SERVO_PORT" --stage all \
  --allow-motion --allow-persistence-write \
  --allow-template-write --allow-current-protection
```

Agregue `--fail-fast` para detenerse después del primer caso non-passing. De lo contrario, los casos independientes continúan después de fallos ordinarios. Los requisitos previos fallidos, los errores de limpieza y la pérdida de comunicación detienen las pruebas adicionales.

<a id="settings-and-cleanup"></a>
## Configuración y limpieza

**El paquete completo no restaura su configuración original.** Instala una configuración de prueba guardada y finaliza cargando la plantilla de reinicio del servo. La prueba de plantilla reemplaza esa plantilla con la configuración del conjunto.

Estas pruebas enfocadas también tienen efectos duraderos:

- `prerequisites` incluye restore-defaults y calibración. Su prueba de compensación guarda una nueva compensación que coloca la posición mostrada en 2048.
- `restore-defaults` carga la plantilla de reinicio guardada (`0x06`), que puede diferir de la configuración original del fabricante.
- `template` reemplaza la plantilla de reinicio (`0x09`) con la configuración activa pre-test. Esta suite no puede volver a leer ni restaurar la plantilla anterior.

Otros casos de persistencia intentan restaurar la configuración que cambiaron. Inspeccione siempre los errores de limpieza antes de otra ejecución. Consulte la [guía de copia de seguridad y recuperación de configuración](../flash/README.md#restore-factory-settings) para obtener comandos de copia de seguridad y recuperación de fábrica.

**Ctrl+C no garantiza la limpieza ni un informe guardado.** El ejecutor no tiene un controlador de interrupciones elegante. Si el movimiento debe detenerse inmediatamente, desconecte la alimentación del motor; luego verifique la comunicación, la configuración y el estado del torque antes de continuar.

<a id="compare-against-a-saved-factory-run"></a>
## Comparar con una ejecución de fábrica guardada

Utilice los mismos casos, revisión del conjunto, velocidad en baudios y condiciones de banco comparables:

```sh
npm run diff -- --port "$SERVO_PORT" --mode factory --case test_ping

npm run diff -- --port "$SERVO_PORT" --mode candidate --case test_ping \
  --reference tools/hw-diff-tests/results/FACTORY_TIMESTAMP/report.json
```

Reemplace la ruta de referencia con el informe de la primera ejecución. Mantenga el ID original de fábrica en `--factory-id`; el candidato debe tener un ID diferente, incluso cuando pruebe el mismo servo físico después del flasheo. La suite no cambia eso ID para ti. Los casos Pair-only se omiten en el modo single-device. Sin `--reference`, un pase single-device verifica solo las afirmaciones de ese escenario, no la equivalencia de fábrica.

<a id="results"></a>
## Resultados

Los informes se guardan en `tools/hw-diff-tests/results/` o en el directorio proporcionado con `--results`. Git ignora los resultados y los registros.

Abra `report.json` para las observaciones, comparaciones, paquetes transmitidos, respuestas recibidas y tiempos de cada dispositivo. Inspeccione `fatal`, `cleanupError` y `closeError`, así como los resultados del caso.

| Resultado | Significado |
|---|---|
| `passed` | Se aprobaron las afirmaciones y cualquier comparación disponible. |
| `mismatch` | Las observaciones de la fábrica y del candidato diferían |
| `failed` | Falló una verificación de afirmación, comunicación o recuperación |
| `inconclusive` | La fábrica no produjo el efecto necesario para la comparación. |
| `skipped` | El caso no fue llevado |

El código de salida **0** significa que no se informaron fallas; Es posible que queden casos omitidos. **1** significa un error argument/setup o una excepción no controlada. **2** significa que el informe contiene una falla, una discrepancia, un resultado no concluyente o un error cleanup/connection-close.

El tiempo incluye la programación del host, USB y retrasos en serie; no es una medición directa del tiempo de ejecución del firmware. Conserve el informe y reproduzca un caso específico antes de atribuir una diferencia de movimiento al firmware.
<!-- /translated-content -->
