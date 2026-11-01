<!-- translation-navigation -->
[English](../en/QUICKSTART.md) · [Русский](../ru/QUICKSTART.md) · [Español](QUICKSTART.md) · [Français](../fr/QUICKSTART.md) · [Deutsch](../de/QUICKSTART.md) · [Português (Brasil)](../pt-BR/QUICKSTART.md) · [简体中文](../zh-CN/QUICKSTART.md) · [日本語](../ja/QUICKSTART.md) · [हिन्दी](../hi/QUICKSTART.md) · [العربية](../ar/QUICKSTART.md)

[Original en inglés](../../../QUICKSTART.md)

> Traducción automática completa, aún no revisada por un hablante nativo. Las imágenes y los vídeos son compartidos; su texto permanece en el idioma original.
<!-- /translation-navigation -->

<!-- translated-content -->
<a id="quick-start"></a>
# Inicio rápido

Para servos GD32F130-based STS TTL. Los comandos siguientes utilizan la sintaxis de shell macOS/Linux y se ejecutan desde la raíz del repositorio. Las herramientas de movimiento de extensión requieren firmware v9; La reproducción heredada también admite firmware de fábrica.

<a id="1-install"></a>
## 1. Instalar

Instale Node.js 20+ y Python 3.10+; el visor de simulación opcional necesita Python 3.12.

```sh
npm ci
python3 -m venv tools/flash/.venv
tools/flash/.venv/bin/python -m pip install -r tools/flash/requirements.txt
export SERVO_PORT=/dev/cu.usbmodemYOUR_ADAPTER
```

Reemplace el puerto con el suyo, como `/dev/ttyUSB0` en Linux. Los ejemplos utilizan motor ID **1** y baudios **1000000**; ajústelos para que coincidan con su servo.

<a id="2-back-up-and-flash"></a>
## 2. Hacer copia de seguridad y flashear

**La programación del firmware puede dañar el servo o borrar la calibración.** Asegure el mecanismo, utilice una alimentación estable, desactive el par y cierre otros programas que usen el puerto serie. Antes de programar, los ajustes deben estar bloqueados y las alarmas borradas. Durante la programación normal del firmware personalizado, los motores con ID únicos pueden seguir conectados: programe un ID cada vez y no realice un power-cycle del bus. Para la recuperación, conecte únicamente el servo que se va a recuperar.

```sh
npm run settings -- discover --port "$SERVO_PORT"
npm run settings -- backup --port "$SERVO_PORT" --id 1
```

Descargue el **firmware personalizado ZIP** de la [v0.1-versión preliminar](https://github.com/roboninecom/STS32XX-Firmware/releases/tag/v0.1-preview) en **Activos**. Extraiga su imagen de firmware y `release.json` juntos en `tools/flash/releases/custom/`. No utilice los archivos de **Código fuente** de GitHub para flashear.

```sh
tools/flash/.venv/bin/python tools/flash/flash.py inspect \
  --manifest tools/flash/releases/custom/release.json
tools/flash/.venv/bin/python tools/flash/flash.py flash \
  --manifest tools/flash/releases/custom/release.json --port "$SERVO_PORT" --id 1
```

Escriba `FLASH` cuando se le solicite y mantenga la alimentación conectada hasta que finalice la verificación. Repita el comando flash para cada motor ID, esperando la verificación cada vez. Consulte [flasheo y recuperación](tools/flash/README.md) si falla la verificación.

El **firmware de fábrica ZIP** es para volver al firmware de fábrica, no para las herramientas de movimiento siguientes. Extráigalo en una carpeta separada y siga [restauración de la configuración de fábrica](tools/flash/README.md#restore-factory-settings) después de flashear. Mantenga cada imagen de firmware con su propia `release.json`.

<a id="3-calibrate-joint-offsets-and-limits"></a>
## 3. Calibrar compensaciones y límites de juntas

Para un mecanismo con recorrido de articulación limitado, seleccione los ID del motor para calibrar:

```sh
npm run settings -- calibrate --port "$SERVO_PORT" --ids 1,2,3 \
  --file tools/settings/calibrations/arm.json
```

Reemplace los ID de ejemplo con los suyos; omita `--ids` para utilizar todos los motores descubiertos (hasta seis). Para SO-101 y SO-102, consulte las [imágenes de pose de referencia etiquetadas](tools/settings/README.md#reference-pose-images). El comando tiene dos pasos:

1. Coloque cada articulación seleccionada, incluida la muñeca y la pinza, en la postura de referencia del mecanismo. Para una nueva configuración sin uno, elija una postura repetible cerca de la mitad del recorrido de cada articulación. Quédate quieto y presiona **Entrar** para guardar las compensaciones para que lean 2048 en esa pose.
2. Mueva cada articulación seleccionada de un extremo a otro, deteniéndose brevemente en los extremos. Revise la tabla en vivo y presione **Entrar** para guardar los límites.

Apoyar el mecanismo en todo momento; no fuerce las paradas. El par permanece apagado. El archivo se actualiza automáticamente y se conservan las copias de seguridad del motor. Si el segundo paso falla, las compensaciones del primer paso permanecen guardadas: finalice la calibración antes de habilitar el movimiento. El punto medio medido no reemplaza la referencia capturada. 2048 es sólo una referencia del codificador; no establece un ángulo físico para simulación o gravedad. Ver [elegir la pose de referencia](tools/settings/README.md#choose-the-reference-pose). Haga esto antes de grabar poses o ajustar la compensación de gravedad. Los brazos existentes con calibración verificada no necesitan recalibración después de un destello settings-preserving.

<a id="4-check-communication"></a>
## 4. Comprobar comunicación

Mantenga el torque apagado. Establezca `--ids` para los motores conectados.

```sh
npm test
npm run bus-benchmark -- --port "$SERVO_PORT" --ids 1 --repetitions 100
npm run telemetry -- --port "$SERVO_PORT" --ids 1 --samples 1000 --interval-ms 20 \
  --output tools/diagnostics/results/first-check
```

`npm test` está desconectado. Los otros comandos leen hardware e imprimen rutas de informes. Utilice un nuevo directorio de salida de telemetría cada vez; ajuste `--voltage-min` y `--voltage-max` si su suministro está fuera del rango predeterminado de 8–16 V. Inspeccione fallas y lecturas marcadas antes del movimiento. Para comparaciones factory/custom, siga la [guía de prueba de hardware](tools/hw-diff-tests/README.md): su conjunto completo mueve motores y reemplaza las configuraciones guardadas y las plantillas de restablecimiento.

<a id="5-record-and-replay-poses"></a>
## 5. Grabar y reproducir poses.

Apoye el mecanismo antes de soltar el torque. Muévelo con la mano, ingresa un nombre para guardar cada pose y luego escribe `done`. Utilice todas las identificaciones de motor necesarias para un brazo.

```sh
npm run record-poses -- --port "$SERVO_PORT" --ids 1
cp tools/poses/replay.example.json tools/poses/controller.local.json
```

Editar `tools/poses/controller.local.json`: establezca `followerPort`, proporcione una entrada `profiles` para cada motor y elija ganancias, límites de esfuerzo, velocidad y aceleración adecuados. Los valores de ejemplo son ilustrativos. El ejemplo hace referencia a un perfil compartido; copie ese perfil para su propio beneficio y actualice su ruta, o coloque la configuración en línea. Las rutas son relativas al archivo del controlador. Primero verifique la calibración guardada y los límites de posición. El bus seguidor debe contener exactamente los motores configurados. Replay maneja motores con y sin alimentación y aplica las configuraciones modificadas automáticamente.

Reemplace `POSES.json` con la ruta guardada de la grabadora:

```sh
npm run replay -- tools/poses/controller.local.json POSES.json
npm run replay -- tools/poses/controller.local.json POSES.json --run
```

El primer comando muestra una vista previa; `--run` habilita el movimiento. **La finalización normal deja los motores encendidos, manteniendo el objetivo final. Ctrl+C no es una parada de emergencia.** Consulte [configuración de reproducción](tools/poses/README.md#replay-poses).

Para comparar utilizando la configuración heredada PID guardada de los motores, sin compensación:

```sh
npm run replay-legacy -- POSES.json --port "$SERVO_PORT" --run
```

No se necesita ningún archivo de controlador. Omita `--run` para obtener una vista previa de read-only. Consulte [repetición heredada](tools/poses/README.md#legacy-replay) para conocer las configuraciones de velocidad y aceleración.

<a id="6-enable-gravity-compensation"></a>
## 6. Habilitar compensación de gravedad

Para `tools/poses/controller.local.json`, agregue este campo top-level:

```json
"gravityModel": "../../host/arm-control/models/arm-upright-empty.json"
```

El modelo incluido es para **SO-ARM-102 vertical calibrado con pinza vacía**. Incluye motores 1–6 y los seis perfiles. Los motores 2–4 reciben compensación; los demás reciben cero. La calibración del codificador debe coincidir; El montaje, la geometría o la carga útil modificados necesitan un modelo validado. No cambie la calibración simplemente para evitar una discrepancia. Para un mecanismo o calibración diferente, ajuste y valide un modelo coincidente.

[SO-101 y SO-102 los perfiles de controlador](host/arm-control/profiles/README.md) incluyen PID, avance de velocidad y modelos de gravedad coincidentes. Lea sus limitaciones antes de su uso; están ligados a la calibración de los brazos ajustados.

La reproducción, la teleoperación y la sintonización utilizan este mismo campo. La gravedad sigue las posiciones medidas mientras la herramienta funciona; después de la salida, sólo se retiene el esfuerzo final. Consulte la [guía de gravedad](host/arm-control/README.md) para conocer los requisitos del modelo.

<a id="7-tune-and-view-motion"></a>
## 7. Sintoniza y ve el movimiento

Copie y edite el [plan de ajuste](../../../tools/tuning/example.json) y el [ejemplo de controlador](../../../tools/tuning/controller.example.json); establezca la ruta `config` del plan a su archivo de controlador. Para la primera carrera, utilice pequeños movimientos seguros, `"stage": "baseline"` y `"candidates": []`.

```sh
npm run tune -- inspect PLAN.json
npm run tune -- preflight PLAN.json
npm run tune -- run PLAN.json
```

Sólo `run` mueve hardware. Siga el [orden de ajuste](tools/tuning/README.md#tuning-order): línea de base → gravedad → avance de velocidad → P/D y filtrado → integral si es necesario → acceleration/ramp tiempo → movimiento combinado → validación.

Para la visualización, instale el [visor de simulación](tools/simulation/README.md), luego use la ruta event-log impresa mediante reproducción o ajuste:

```sh
tools/simulation/.venv/bin/python tools/simulation/viewer.py live EVENTS.ndjson --model so101
tools/simulation/.venv/bin/python tools/simulation/viewer.py play EVENTS.ndjson --model so101
```

Utilice `--model so102` para el otro modelo de brazo incluido. Consulte la convención reference-pose en la guía del visor. El comando maneja automáticamente el iniciador de ventanas de macOS. El espectador muestra un movimiento medido; no predice los resultados de ajuste. Para el control hand-operated utilizando adaptadores de líder y seguidor separados, consulte [teleoperación](tools/teleoperation/README.md).
<!-- /translated-content -->
