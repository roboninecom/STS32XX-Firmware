<!-- translation-navigation -->
[English](../../../en/host/servo-driver/README.md) · [Русский](../../../ru/host/servo-driver/README.md) · [Español](README.md) · [Français](../../../fr/host/servo-driver/README.md) · [Deutsch](../../../de/host/servo-driver/README.md) · [Português (Brasil)](../../../pt-BR/host/servo-driver/README.md) · [简体中文](../../../zh-CN/host/servo-driver/README.md) · [日本語](../../../ja/host/servo-driver/README.md) · [हिन्दी](../../../hi/host/servo-driver/README.md) · [العربية](../../../ar/host/servo-driver/README.md)

[Original en inglés](../../../../../host/servo-driver/README.md)

> Traducción automática completa, aún no revisada por un hablante nativo. Las imágenes y los vídeos son compartidos; su texto permanece en el idioma original.
<!-- /translation-navigation -->

<!-- translated-content -->
<a id="sts32xx-servo-driver"></a>
# STS32XX servocontrolador

Controlador Node.js para los servos serie STS y el firmware STS32XX **extensión de movimiento v9**. Proporciona descubrimiento, acceso a registros, operaciones de configuración, S-curve comandos de movimiento, compensación de gravedad y retroalimentación a través de una conexión en serie. Requiere **Node.js 20 o posterior** y un adaptador serie compatible.

Las operaciones heredadas utilizan la tabla de control STS incluida en este paquete. Las operaciones de extensión requieren firmware personalizado v9; El firmware de fábrica no los proporciona. El paquete es para Node.js, no para el navegador Web Serial.

<a id="install"></a>
## Instalar

De este repositorio:

```sh
npm ci
npm run test:driver
npm pack --workspace sts32xx-servo-driver --pack-destination /tmp
```

En otro proyecto Node.js, instale el archivo generado por el último comando:

```sh
npm install /tmp/sts32xx-servo-driver-0.1.0.tgz
```

Esto funciona sin publicar en un registro npm. El archivo contiene la biblioteca, ejemplos, README y licencia. Las dependencias seriales se instalan a través de npm; firmware, registros y resultados de pruebas no están incluidos.

JS común:

```js
const { StsServo } = require('sts32xx-servo-driver');
```

ES módulos:

```js
import driver from 'sts32xx-servo-driver';
const { StsServo } = driver;
```

Las herramientas de repositorio existentes pueden continuar importando `host/servo-driver` directamente. Utilice la exportación principal del paquete; Las rutas de archivos internos no forman parte de su público API.

<a id="connect-and-read"></a>
## Conéctate y lee

```js
const { StsServo } = require('sts32xx-servo-driver');

const servo = new StsServo({
  serial: { path: '/dev/cu.usbmodemYOUR_ADAPTER', baudRate: 1000000 },
});

async function main() {
  try {
    const found = await servo.connect();
    for (const id of found.ids) {
      const values = await servo.bus.read(id,
        ['presentPosition', 'presentVoltage', 'servoStatus']);
      console.log(id, values, found.alarms.get(id) ?? []);
    }
  } finally {
    await servo.close();
  }
}
main().catch(console.error);
```

Utilice `/dev/ttyUSB0`, `COM3` o el puerto real de su adaptador, según corresponda. Discovery encuentra ID que responden en los baudios seleccionados; no cambia la configuración del motor ni escanea otras velocidades en baudios. Las identificaciones deben ser únicas. Cuenta de espera para el ID más alto posible y baudios seleccionados. `connect()` abre el puerto y descubre motores; `open()` solo abre el puerto. Los métodos de bus y extensión requieren ID descubiertas.

Los valores de registro utilizan unidades sin procesar. Por ejemplo, `presentVoltage: 120` significa 12 V. `ControlTable` describe direcciones, codificaciones, rangos y escalas de visualización. Los campos Multi-byte utilizan la codificación little-endian; los valores heredados con signo utilizan bits de signo.

<a id="main-api"></a>
## Principal API

Todas las operaciones que se comunican con el hardware prometen retornos.

| API | Propósito |
| --- | --- |
| `servo.connect()` / `servo.close()` | Open/discover o cerrar la conexión serie. |
| `servo.bus.discover()` | Actualiza la lista de ID conocidos. |
| `servo.bus.scan()` | Descubra sin reemplazar la lista known-ID. |
| `servo.bus.verify(ids)` | Haga ping a motores conocidos individualmente. |
| `servo.bus.read(id, keys, options)` | Leer registros con nombre; devuelve un objeto codificado por nombre de registro. |
| `servo.bus.write(id, values, options)` | Escribe un objeto de registros con nombre. |
| `servo.bus.readMany(ids, keys, options)` | Lea varios motores utilizando solicitudes grupales. |
| `servo.bus.syncWrite(entries, options)` | Escribe entradas con forma de `{ id, values }` en un grupo. |
| `servo.bus.device(id)` | Obtenga un objeto de conveniencia con los métodos `read`, `write` y reset/calibration. |
| `servo.settings.read(id)` | Lea la configuración heredada persistente. |
| `servo.settings.save(id, values)` | Desbloquee, guarde, verifique y vuelva a bloquear la configuración normal. |
| `servo.arm` | Acceda a los métodos v9 a continuación. |

Los guardados de configuración utilizan un tiempo de espera de solicitud de 250 ms. Después de una confirmación de escritura perdida, el controlador espera la persistencia y vuelve a leer el registro antes de volver a intentarlo. Already-applied las escrituras no se repiten. Las fallas temporales de comunicación tienen hasta tres intentos; Las fallas persistentes aún informan un error e intentan volver a bloquear el motor. Pase `{ timeoutMs }` a `settings.save` para anular el tiempo de espera.

Ejemplo heredado, para un motor asegurado en modo de posición que está destinado a moverse:

```js
await servo.bus.write(id, { targetPosition: 2048 },
  { timeoutMs: 100, rejectOnAlarm: true });
```

Una escritura de objetivo heredada puede habilitar automáticamente el torque, según la configuración guardada. Las escrituras persistentes pueden cambiar la calibración, los límites o las ganancias. Desactive el torque antes de cambiar la configuración. Los ajustes API guardan ID, baudios y response-level cambian; use la [configuración CLI](../../tools/settings/README.md) en el repositorio para obtener el backup/restore completo. Los comandos de restablecimiento de fábrica, reset-template y calibración se exponen a través de `servo.protocol`; llámelos sólo cuando se pretendan realizar esos cambios.

<a id="v9-control-lifecycle"></a>
## ciclo de vida del control v9

1. Comience sin torque. Leer capacidades y configuración.
2. Aplique una configuración validada con `arm.configure()` mientras el torque está desactivado.
3. Seleccione el modo de extensión con una nueva sesión distinta de cero ID.
4. Habilite el torque usando el registro heredado 40, luego lea los comentarios hasta que la sesión esté armada, nueva, drive-enabled y output-ready.
5. Envía objetivos y actualizaciones de gravedad. Verifique sus números de secuencia aceptados en comentarios nuevos.
6. Escriba `torqueEnable: 0` cuando la aplicación pretenda liberar el motor.

```js
const options = { timeoutMs: 100, rejectOnAlarm: true };
const caps = await servo.arm.capabilities(id, options);
if (caps?.major !== 9) throw new Error('Extension v9 is required');

// config must contain values validated for this motor and mechanism.
await servo.arm.configure(id, config, options);
await servo.arm.select(id, true, session, options);
await servo.bus.write(id, { torqueEnable: 1 }, options);
// Check readiness using servo.arm.feedback() before sending motion.

await servo.arm.setTargets([
  { id, target: { sequence: 1, positionQ8: 2048 * 256, speedLimit: 100 } },
], session, options);

await servo.arm.updateGravity(id,
  { session, sequence: 1, gravityEffort: -20 }, options);
```

Este fragmento muestra las llamadas; el [ejemplo de movimiento completo](../../../../../host/servo-driver/examples/v9-move.js) incluye validación, sondeo de preparación, verificaciones de aceptación y limpieza torque-off. Si los reconocimientos de escritura están deshabilitados, las escrituras heredadas necesitan `expectResponse: false` y verificación de relectura. El ejemplo completo maneja esto automáticamente.

El firmware mantiene el último objetivo y retiene el último esfuerzo de gravedad hasta que se reemplaza o se desactiva el torque. No hay latidos, tiempo de espera de comando ni vencimiento de la gravedad. **Cerrar la conexión en serie no detiene ni libera el motor.** Elija la limpieza de la aplicación que se adapte al mecanismo; soltar un brazo cargado puede hacerlo caer. La protección del sensor y del motor permanece activa en el firmware.

La habilitación de par captura la posición medida. No inicie una sesión de extensión con escrituras de objetivos heredadas. El par o una falla finaliza la sesión; Prepare una nueva sesión antes de reiniciar. Para seleccionar el modo heredado con torque desactivado, use `arm.select(id, false, 0)`.

<a id="extension-methods"></a>
### Métodos de extensión

| Método | Resultado o efecto |
| --- | --- |
| `capabilities(id, options)` | `{ major, minor, tickMs }` para una firma reconocida; el firmware no compatible puede rechazar la solicitud o agotar el tiempo de espera. |
| `configuration(id, options)` | Lea la configuración RAM actual. |
| `configure(id, config, options)` | Escriba la configuración y verifique los bytes codificados mediante lectura. |
| `select(id, enabled, session, options)` | Prepare el control v9 o seleccione el modo heredado con `false, 0`. |
| `setTargets(entries, session, options)` | Envíe una transmisión que contenga de uno a seis motores únicos. |
| `updateGravity(id, command, options)` | Enviar esfuerzo de gravedad firmado con su propio número de secuencia. |
| `feedback(id, options)` | Lea una muestra operativa coherente. |
| `tuning(id, options)` | Lea comentarios operativos más movimientos de referencia y términos de esfuerzo individual. |
| `invalidate(id)` | Borre las capacidades almacenadas en caché después de un ciclo de energía externo o un cambio de firmware; omita ID para borrar todo. |

El controlador invalida automáticamente las capacidades al descubrir, cambiar ID, cambiar de conexión y restablecerse emitidos a través de su protocolo API.

<a id="configuration-and-units"></a>
### Configuración y unidades

Cada campo de configuración es explícito. Este objeto ilustra el formato, no un perfil de ajuste recomendado:

```js
const config = {
  kpQ8: 256, kdQ8: 0, kiQ8: 0,
  integralLimit: 0, effortLimit: 100,
  velocityLimit: 100, accelerationLimit: 500,
  velocityFilterQ8: 64, rampTimeMs: 30,
  velocityFeedforward: {
    positiveGainQ8: 0, negativeGainQ8: 0, effortLimit: 0,
  },
  gravitySlewEffortPerS: 1000,
};
```

| Campos | Unidades y límites |
| --- | --- |
| `kpQ8`, `kdQ8`, `kiQ8` | Ganancias multiplicadas por 256; números enteros 0–65535. |
| `effortLimit`, `integralLimit` | PWM unidades de esfuerzo; límite general 1–1000, límite integral 0–límite general. |
| `velocityLimit`, objetivo `speedLimit` | Codificador counts/s; 1–65535. |
| `accelerationLimit` | Counts/s²; 1–30000, compartido por la aceleración y la frenada. |
| `rampTimeMs` | S-curve tiempo de rampa de aceleración; 1–255 sra. |
| `velocityFilterQ8` | Coeficiente de filtro multiplicado por 256; 1–255. |
| Ganancias de avance de velocidad | Direction-specific ganancias multiplicadas por 256; 0–65535. Su límite de esfuerzo no puede exceder el límite general. Establezca ambas ganancias y el límite en cero para desactivarlo. |
| `gravitySlewEffortPerS` | Cambio de esfuerzo de gravedad por segundo; 1–10000. |
| Objetivo `positionQ8` | Posición del codificador multiplicada por 256; −32767×256 a 32767×256. |
| `gravityEffort` | Firmado PWM esfuerzo; −1000 a 1000. El firmware aplica sus límites de esfuerzo. |

Los límites de viaje provienen de los límites de posición heredados guardados. El firmware limita los objetivos a los límites activos. La configuración es el estado RAM, no un perfil de ajuste persistente. La avance de velocidad local sigue la referencia de movimiento del firmware; la aplicación proporciona compensación de gravedad por separado.

Los ID de destino de la extensión son 1–253. Una sesión es 1–65535. Cada motor rastrea las secuencias de destino y de gravedad por separado. Incrementa la secuencia correspondiente para cada nuevo comando, ajustando 65535 a 0; Se aceptan espacios hacia adelante de hasta 32767. Comience una nueva sesión con la secuencia 1. La finalización de la transmisión significa que el paquete fue enviado, no que todos los motores lo aceptaron. Marque `acceptedSequence`, `gravitySequence` y `session` en comentarios posteriores.

<a id="feedback-and-errors"></a>
### Comentarios y errores

`feedback()` incluye medida position/velocity en Q8 unidades, esfuerzo aplicado, corriente ADC delta, voltaje bruto, temperatura validada, fallas, sesión y secuencias aceptadas. Utilice `fresh`, `ageMs`, `sampleSequence`, `armed`, `driveEnabled` y `outputReady` para juzgar si una muestra es utilizable. La temperatura solo se puede utilizar cuando `temperatureValid` es verdadero. `running: false` significa que el planificador ya no se mueve; no garantiza un error de posición cero.

`tuning()` agrega la referencia position/velocity, el esfuerzo solicitado, los términos P/D/I, el esfuerzo de gravedad, la velocidad de avance y el recuento de exceso.

Las opciones de lectura y escritura incluyen `timeoutMs` y `rejectOnAlarm`. Las alarmas heredadas no rechazan de forma predeterminada respuestas que de otro modo serían válidas; pase `rejectOnAlarm: true` cuando una alarma debería cancelar una operación. Los errores escritos incluyen `RequestTimeoutError`, `MissingResponseError`, `ServoStatusError`, `SettingsVerificationError` y `InvalidPacketError`. El contexto adicional está en `error.details`; Los rechazos de extensiones incluyen `extensionStatus` allí.

El planificador serializa solicitudes y admite prioridades y transacciones exclusivas. Espere órdenes y use objetivos grupales para un movimiento coordinado. El tiempo de espera de respuesta comienza después de que se agota la escritura en serie; Las operaciones de transporte tienen sus propios plazos. Estos tiempos de espera no cambian el comportamiento motor. Los paquetes heredados no tienen número de secuencia, por lo que una respuesta inusualmente tardía no siempre se puede distinguir de una solicitud posterior con la misma forma de respuesta.

Las exportaciones Low-level incluyen `SerialTransport`, `StsProtocol`, `RequestScheduler`, `PacketEncoder`, `PacketDecoder`, `RegisterCodec`, `RegisterLayout`, `ArmCodec`, constantes y errores. Permanecen separados del autobús high-level API.

<a id="runnable-examples"></a>
## Ejemplos ejecutables

Desde este directorio, o utilizando los archivos de ejemplo incluidos en el paquete instalado:

```sh
node examples/discover.js /dev/cu.usbmodemYOUR_ADAPTER
node examples/v9-feedback.js /dev/cu.usbmodemYOUR_ADAPTER 2
node examples/v9-move.js /dev/cu.usbmodemYOUR_ADAPTER 2 2048 100 /path/to/config.json
```

Los dos primeros ejemplos solo leen. El ejemplo de movimiento requiere una configuración JSON con los campos anteriores y usa 1 Mbaud. Ejecútelo con un motor seguro y descargado con recorrido libre. Desactiva el torque después del movimiento, un error o Ctrl+C elegante. Espera hasta 3 segundos para el inicio y 30 segundos para el movimiento. Argumento final opcional: esfuerzo de gravedad con signo, valor predeterminado cero. No lo utilice para soportar una carga en el brazo.

<a id="tests-and-license"></a>
## Pruebas y licencia

Desde la raíz del repositorio:

```sh
npm run test:driver
npm run test:driver-package
npm test
```

Las pruebas utilizan transportes falsos y no abren puertos serie. La verificación del paquete instala el archivo real en un proyecto temporal, utilizando las dependencias almacenadas en caché de npm desde `npm ci`, y verifica las importaciones CommonJS/ESM y los puntos de entrada de ejemplo. No publica el paquete. La instalación de producción puede requerir herramientas de compilación nativas si un enlace serial-port no está disponible para el sistema operativo y CPU.

[MIT](../../../../../host/servo-driver/LICENSE), derechos de autor 2026 STS32XX-Firmware colaboradores. Esta licencia cubre este directorio de controladores, incluidos ejemplos y pruebas. No otorga nuevas licencias de firmware ni de código de proveedor en ninguna otra parte del repositorio. Las dependencias conservan sus propias licencias.
<!-- /translated-content -->
