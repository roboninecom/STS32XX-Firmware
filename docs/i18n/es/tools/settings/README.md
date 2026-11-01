<!-- translation-navigation -->
[English](../../../en/tools/settings/README.md) · [Русский](../../../ru/tools/settings/README.md) · [Español](README.md) · [Français](../../../fr/tools/settings/README.md) · [Deutsch](../../../de/tools/settings/README.md) · [Português (Brasil)](../../../pt-BR/tools/settings/README.md) · [简体中文](../../../zh-CN/tools/settings/README.md) · [日本語](../../../ja/tools/settings/README.md) · [हिन्दी](../../../hi/tools/settings/README.md) · [العربية](../../../ar/tools/settings/README.md)

[Original en inglés](../../../../../tools/settings/README.md)

> Traducción automática completa, aún no revisada por un hablante nativo. Las imágenes y los vídeos son compartidos; su texto permanece en el idioma original.
<!-- /translation-navigation -->

<!-- translated-content -->
<a id="discovery-calibration-and-settings"></a>
# Descubrimiento, calibración y configuración.

Busque los servos STS y haga una copia de seguridad o restaure sus configuraciones heredadas persistentes. Utiliza el controlador compartido del repositorio y la tabla de control STS. Requiere Node.js 20 o más reciente. Ejecute estos comandos desde la raíz del repositorio después de `npm ci`.

<a id="discover"></a>
## Descubrir

```sh
npm run settings -- discover --port /dev/cu.usbmodemYOUR_ADAPTER
```

Enumera los ID de los motores que responden y las alarmas reportadas como JSON. El descubrimiento es read-only y escanea la velocidad en baudios seleccionada, que por defecto es 1,000,000. Agregue `--baud 500000` para obtener una tarifa admitida diferente. En Linux o Windows, use el puerto de su adaptador, como `/dev/ttyUSB0` o `COM3`.

Los motores deben tener identificaciones únicas. Discovery no puede distinguir de manera confiable motores que comparten un ID ni encontrar motores que utilicen otra velocidad en baudios.

<a id="back-up"></a>
## hacer copia de seguridad

```sh
npm run settings -- backup --port /dev/cu.usbmodemYOUR_ADAPTER --id 2 \
  --file tools/settings/backups/servo-2.json
```

Guarda la identidad del dispositivo y cada configuración persistente descrita por la tabla de control compartida, incluida la calibración, los límites, las ganancias, ID y el selector de baudios. La copia de seguridad solo lee el motor. Los archivos existentes nunca se sobrescriben. Sin `--file`, se crea un archivo con marca de tiempo en `tools/settings/backups/`, que Git ignora.

<a id="restore"></a>
## Restaurar

Conecte solo el motor que se está restaurando, desactive el par, bloquee la configuración y borre las alarmas activas. Cierre otros programas usando el puerto. Utilice una copia de seguridad del mismo motor: restaurar la calibración de otro motor puede cambiar su posición informada.

```sh
npm run settings -- restore --port /dev/cu.usbmodemYOUR_ADAPTER --id 2 \
  --file tools/settings/backups/servo-2.json
```

`--id` y `--baud` describen la **conexión actual**. La copia de seguridad puede restaurar una ID o una velocidad de baudios diferente; la herramienta sigue esos cambios e informa la conexión final. Comprueba la identidad del modelo, escribe solo las configuraciones modificadas, espera a que finalice cada rango de registros guardado, vuelve a leer las configuraciones y vuelve a bloquear el motor. Nunca habilita el torque ni envía un comando de movimiento. Una restauración fallida puede dejar algunas configuraciones modificadas; Inspeccione el error antes de volver a intentarlo.

Estas copias de seguridad cubren la configuración heredada, no la configuración de la extensión ni la plantilla de restablecimiento de fábrica. Para reparar después de actualizar el firmware de fábrica a través de firmware personalizado, use la [herramienta de recuperación de configuración de fábrica](../flash/README.md#restore-factory-settings). Sus archivos de respaldo usan un formato diferente y no son intercambiables con el JSON de esta herramienta.

<a id="calibrate-joint-offsets-and-limits"></a>
## Calibrar compensaciones y límites de juntas

Calibre motores 1–6 con ID únicas de 1 a 253 y recorrido de junta limitado mecánicamente. Admite la familia de modelos GD32 STS 9, incluidas variantes de motor mixto, en modo de posición con un divisor de posición de 1. Cierre otras herramientas en serie.

```sh
npm run settings -- calibrate --port /dev/cu.usbmodemYOUR_ADAPTER --ids 1,2,3 \
  --file tools/settings/calibrations/arm.json
```

Reemplace las ID de ejemplo con sus motores. Omita `--ids` para calibrar todos los motores descubiertos, hasta seis. Una selección explícita no modifica los demás motores conectados. No se asumen nombres de articulaciones, geometría del brazo ni pose de referencia estándar.

<a id="choose-the-reference-pose"></a>
### Elige la pose de referencia

La **pose de referencia de calibración** es la pose física que capturas en el paso 1. La herramienta genera cada informe motor seleccionado **2048 en esa pose**. No reconoce la postura, no infiere los ángulos de las articulaciones ni los calcula a partir del barrido posterior.

Para una nueva calibración, coloque cada articulación cerca de la mitad de su recorrido mecánico y elija una posición que pueda reproducir. Incluye el rodillo de muñeca y la pinza; No asuma que la pinza debe estar completamente abierta o cerrada. Utilice la misma pose física cada vez. Si el mecanismo tiene una pose de referencia documentada, sígala. Para SO-101, la [guía de calibración de LeRobot y el vídeo](https://huggingface.co/docs/lerobot/so101#calibrate) muestran la ubicación de mid-travel seguida de un barrido de end-to-end.

<a id="reference-pose-images"></a>
### Imágenes de poses de referencia.

Para una **nueva calibración**, utilice las guías siguientes. Las etiquetas asumen las identificaciones de motor habituales 1–6. Coloque la base en posición vertical, la parte superior del brazo en posición vertical y el antebrazo y la pinza apuntando hacia adelante como se muestra. Centre la rotación de la base y el rodillo de muñeca entre sus topes mecánicos; Coloque la pinza a medio camino entre cerrada y abierta. Utilice el recorrido físico para encontrar estas posiciones, no los recuentos no calibrados.

<a id="so-101"></a>
#### SO-101

![SO-101 referencia de calibración: vistas lateral y superior con las seis articulaciones etiquetadas, parte superior del brazo erguida, antebrazo hacia adelante, giro de muñeca centrado y half-open pinza](../../../../../tools/settings/images/so101-reference-pose.png)

<a id="so-102"></a>
#### SO-102

![SO-102 referencia de calibración: vistas lateral y superior con las seis articulaciones etiquetadas, parte superior del brazo erguida, antebrazo hacia adelante, giro de muñeca centrado y half-open pinza paralela](../../../../../tools/settings/images/so102-reference-pose.png)

Las imágenes ilustran la colocación manual de nuevas compensaciones. No establecen compatibilidad con un modelo de gravedad sintonizado existente. Los mapas del visor predeterminados también usan diferentes valores de referencia wrist/gripper: actualice el mapeo si calibra con estas poses. [Fuentes de imágenes y ángulos del modelo](images/README.md).

El recorrido completo debe caber dentro de 0–4095 después de que la referencia se convierta en 2048: como máximo 2048 cuenta por debajo de la referencia y 2047 por encima de ella. Una articulación con casi una vuelta completa de recorrido necesita un centrado especialmente cuidadoso. Es posible que una postura repetible cerca de un tope final no deje suficiente espacio, incluso cuando el recorrido total sea inferior a una vuelta.

Si tiene la intención de utilizar un simulador o un modelo de gravedad, su convención de ángulo debe coincidir con esta pose física. **2048 no es automáticamente cero grados en el modelo.** Consulte el [mapeo del visor](../simulation/README.md#models-and-calibration) y los [requisitos del modelo de gravedad](../../host/arm-control/models/README.md)]. Mantener una calibración ya verificada al reutilizar sus grabaciones y modelo; una actualización de firmware que conserva la configuración no requiere recalibración.

<a id="capture-offsets-then-limits"></a>
### Capture compensaciones y luego límites

Un comando guía ambos pasos:

1. **Postura de referencia:** coloque las articulaciones seleccionadas en una pose repetible elegida para su mecanismo. Sostenlo, quédate quieto y presiona **Enter**. La herramienta escribe compensaciones del motor para que cada articulación seleccionada lea **2048** en la pose capturada y luego verifica los registros guardados.
2. **Límites de juntas:** mueve cada junta seleccionada de un extremo a otro. Haga una breve pausa en cada extremo; no fuerce las paradas. Revise los conteos mínimo, máximo, medio y de recorrido en vivo, luego presione **Entrar**. La herramienta escribe límites con **10 recuentos de espacio libre** dentro de cada punto final medido.

El **Medio** de la tabla es `(Min + Max) / 2`, redondeado a un recuento completo. Es informativo: los límites de ahorro no se mueven 2048 a ese punto medio ni cambian las compensaciones. Los límites asimétricos son válidos.

Si los motores reciben alimentación al arrancar, la herramienta le pide que apoye el mecanismo antes de liberar el torque. De lo contrario, solo existen las dos indicaciones anteriores. No se ordena ningún movimiento; El par permanece desactivado y los ajustes se bloquean después de guardarlos.

La captura de referencia utiliza la mediana de varias lecturas. Los pequeños movimientos de la mano no detienen la calibración y un ligero movimiento mientras se guardan las compensaciones no requiere otra confirmación. Los ajustes fallidos al guardar permanecen junto al motor afectado y se vuelven a intentar automáticamente. La herramienta vuelve a leer antes de volver a intentar escribir, por lo que una confirmación faltante no provoca que se vuelvan a escribir las configuraciones already-saved. Se conservan los motores completos; no se necesita confirmación adicional.

Las compensaciones se guardan antes del barrido y no se modifican cuando se guardan los límites. Los límites pueden ser asimétricos alrededor de 2048. Se realiza un seguimiento del ajuste del codificador; un cruce de rango 0 o 4095 no se puede almacenar como límites ordinarios y muestra `crosses zero` en la columna **Verificar**. Cada articulación debe moverse al menos 64 conteos y menos de una vuelta completa antes de que se puedan guardar sus límites.

Los errores de lectura temporales aparecen junto al motor afectado y se eliminan automáticamente cuando se reanudan las lecturas válidas. Un movimiento de mano más rápido no provoca un error speed-limit. Ingrese los guardados solo cuando todos los rangos sean válidos; de lo contrario, el registro continúa con las mediciones retenidas. Utilice `reset 2` para borrar solo el rango medido de M2 y barra esa articulación nuevamente, sin repetir el paso de referencia ni otras articulaciones. Un rango genuino que cruza cero aún necesita corregir su ubicación de referencia; restablecer las medidas no puede hacer que ese rango físico se ajuste. Todos los errores del motor permanecen visibles junto al motor afectado. Las alarmas o el par inesperado pausan la escritura de sus configuraciones hasta que se borran; Se vuelven a intentar las conexiones perdidas. La sesión permanece abierta y conserva el trabajo completado. Durante los reintentos automáticos, presione Ctrl+C para cancelar.

El archivo de salida se sobrescribe en cada ejecución. Las copias de seguridad del motor se guardan en un directorio único en `backups/` junto a ese archivo y se pueden usar con `settings restore`. El informe registra lecturas de referencia, compensaciones, rangos medidos y escrituras completadas; no almacena una fotografía ni ángulos físicos de las articulaciones. Solo `status: "verified"` significa que ambos pasos se completaron.

Escriba `cancel` o presione Ctrl+C para detener. **Las compensaciones ya guardadas en el paso 1 permanecen guardadas si el paso 2 se cancela o falla; los límites antiguos permanecen hasta que se reemplazan.** Complete la calibración antes de habilitar el movimiento. Puedes volver a ejecutar el mismo comando desde la pose de referencia, sin restaurar una calibración anterior JSON.

<a id="expected-travel-warnings"></a>
### Advertencias de viaje esperadas

Opcionalmente, pase `--expected-ranges FILE.json` que contiene tolerancias y recuentos de recorrido verificados, codificados por el motor ID. Formato de ejemplo:

```json
{"1": {"counts": 2000, "tolerance": 100}}
```

Estos números sólo ilustran el formato del archivo. Las desviaciones se muestran como advertencias; Al presionar Enter se acepta el rango medido. Las uniones omitidas no tienen control expected-range.

Termine la calibración antes de grabar poses o ajustar la compensación de gravedad. Después de cambiar las compensaciones, registre las poses nuevamente y actualice o reajuste el modelo de gravedad y el mapeo del simulador. Ninguno de los dos se actualiza con este comando. Copiar las compensaciones de otro brazo o cambiar solo los campos calibration-check de un modelo no establece la relación correcta entre recuentos y ángulos.

<a id="help-and-tests"></a>
## Ayuda y pruebas

```sh
npm run settings -- --help
npm run test:settings
```

Las pruebas se ejecutan sin conexión sin abrir un puerto serie. Los comandos salen con un estado distinto de cero en caso de falla; una lista de descubrimiento vacía significa que no hay respuestas en los baudios seleccionados.
<!-- /translated-content -->
