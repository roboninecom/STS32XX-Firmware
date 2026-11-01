<!-- translation-navigation -->
[English](../en/DETAILED_DOCUMENTATION.md) · [Русский](../ru/DETAILED_DOCUMENTATION.md) · [Español](DETAILED_DOCUMENTATION.md) · [Français](../fr/DETAILED_DOCUMENTATION.md) · [Deutsch](../de/DETAILED_DOCUMENTATION.md) · [Português (Brasil)](../pt-BR/DETAILED_DOCUMENTATION.md) · [简体中文](../zh-CN/DETAILED_DOCUMENTATION.md) · [日本語](../ja/DETAILED_DOCUMENTATION.md) · [हिन्दी](../hi/DETAILED_DOCUMENTATION.md) · [العربية](../ar/DETAILED_DOCUMENTATION.md)

[Original en inglés](../../../DETAILED_DOCUMENTATION.md)

> Traducción automática completa, aún no revisada por un hablante nativo. Las imágenes y los vídeos son compartidos; su texto permanece en el idioma original.
<!-- /translation-navigation -->

<!-- translated-content -->
<a id="detailed-documentation"></a>
# Documentación detallada

Comience con la guía **[Inicio rápido](QUICKSTART.md)** para flashear, probar, reproducir y compensar la gravedad. Consulte [herramientas](tools/README.md) para obtener guías de comandos individuales.

Firmware para servos GD32F130-based STS3215, con dos formas de controlar el motor:

- **El modo heredado** utiliza los comandos estándar STS para posición, velocidad y potencia del motor. Está habilitado de forma predeterminada.
- **Modo de extensión** agrega un movimiento suave, control de posición ajustable y compensación por movimiento y gravedad. La computadora conectada envía configuraciones y destinos; cada servo calcula su movimiento localmente.

Este documento explica cómo funcionan las funciones y luego proporciona el comando y la referencia de registro para el **protocolo de extensión v9.0**. La configuración de la extensión se guarda en la memoria temporal y debe enviarse nuevamente después de un reinicio o ciclo de encendido. El software de control debe ser compatible con la versión 9; Los clientes de extensiones más antiguos no son compatibles.

- [Modo heredado](#legacy-mode)
- [Cómo funciona el modo de extensión](#how-extension-mode-works)
- [S-curve movimiento](#s-curve-motion)
- [Posturas de referencia de calibración](#calibration-reference-poses)
- [PID controlador](#pid-controller)
- [Avance de velocidad](#velocity-feedforward)
- [Compensación de gravedad](#gravity-compensation)
- [Iniciando y deteniendo el modo de extensión](#starting-and-stopping-extension-mode)
- [Protocolo de extensión](#extension-protocol)
- [Registros de extensión](#extension-registers)
- [Construcción y verificación](#build-and-verification)
- [Diseño del repositorio](#repository-layout)
- [Límites actuales](#current-limits)

<a id="legacy-mode"></a>
## Modo heredado

El modo heredado admite la interfaz de registro estándar STS, incluida la potencia del motor, el modo de funcionamiento, los comandos de posición y velocidad y las lecturas de estado. El software STS existente puede usar registros **0–86** sin habilitar la extensión.

En los modos de posición heredados, habilitar la potencia del motor sin un nuevo comando de posición mantiene la posición medida, incluso fuera de los límites guardados. No reproduce un objetivo antiguo ni mueve el eje al límite más cercano. Los nuevos comandos de posición todavía están limitados a los límites guardados.

La extensión utiliza su propia configuración de movimiento y control. Los valores de ganancia no deben copiarse directamente entre los dos modos porque sus escalas difieren. La compatibilidad con los comandos estándar no garantiza un comportamiento físico idéntico en todos los modelos de servo.

<a id="how-extension-mode-works"></a>
## Cómo funciona el modo de extensión

[Vea la descripción general grabada en YouTube](https://youtu.be/AsxFs24vXQs) | [MP4](../../../assets/readme/videos/overview.mp4)

El **host** es la computadora o controlador conectado a los servos. Envía un **objetivo**: un destino y un límite de velocidad. Los ajustes de aceleración y compensación se configuran antes de habilitar la potencia del motor. Cada servo entonces:

1. Planifica un movimiento suave hacia el destino.
2. Mide su posición y estima su velocidad.
3. Ajusta la salida del motor para seguir el movimiento planificado.
4. Mantiene el destino cuando finaliza el movimiento.

La posición planificada y la velocidad en cualquier momento se denominan **referencia**. El controlador los compara con el movimiento medido, por lo que una posición de referencia y una posición real pueden diferir.

Algunos términos utilizados a lo largo de este documento:

| Término | Significado |
| --- | --- |
| Recuento del codificador | Una unidad de medida de posición; nominalmente 4096 cuentas por revolución |
| Esfuerzo | El comando con signo motor-output: su signo establece la dirección y su tamaño establece la intensidad de salida |
| Ganar | Una configuración que determina la fuerza con la que responde el controlador. |
| avance | Salida adicional del motor calculada a partir de la demanda esperada, en lugar de esperar un error de posición o velocidad |
| Comentarios | Medidas y estado devueltos por el servo. |
| Regístrate | Un entorno o lectura identificado por un número. |
| Sesión | Un período de control de extensión, identificado por un número proporcionado por el anfitrión |

El esfuerzo se expresa en unidades PWM, las unidades utilizadas para controlar la salida eléctrica al motor. La extensión permite un límite de salida de hasta **1000** en cualquier dirección. Estos valores no son mediciones directas de par o corriente.

<a id="s-curve-motion"></a>
## S-curve movimiento

[![Ilustración conceptual de s-curve movimiento](../../../assets/readme/illustrations/s-curve.png)](https://youtu.be/92mDt4rbobY)

[Ver en YouTube](https://youtu.be/92mDt4rbobY) | [MP4](../../../assets/readme/videos/s-curve.mp4)

Hace que la aceleración y el frenado sean más graduales. La curva ilustra la aceleración en el tiempo. Ilustración conceptual, datos de hardware no medidos.

Un S-curve hace que la aceleración aumente y disminuya gradualmente. En lugar de aplicar repentinamente una aceleración o frenado total, el servo entra y sale de cada parte del movimiento. Esto puede reducir las sacudidas mecánicas y las vibraciones.

Un movimiento completo de reposo a reposo tiene estas etapas:

| etapa | que pasa |
| --- | --- |
| 1 | La aceleración aumenta gradualmente |
| 2 | El servo acelera a un ritmo constante. |
| 3 | La aceleración disminuye gradualmente hasta cero. |
| 4 | El servo se mueve a una velocidad constante. |
| 5 | El frenado aumenta gradualmente |
| 6 | El servo frena a un ritmo constante. |
| 7 | El frenado disminuye gradualmente a medida que el servo se detiene. |

Los movimientos cortos se saltan etapas cuando no hay suficiente distancia para alcanzar la velocidad o aceleración solicitada. Se aplica el mismo límite de aceleración al acelerar y al frenar.

La configuración `ramp_time_ms` controla cuánto tiempo tarda la aceleración en aumentar desde cero hasta su límite. Una rampa más larga ofrece un cambio más suave, pero generalmente necesita más tiempo y distancia para acelerar o detenerse.

**Jerk** significa la velocidad a la que cambia la aceleración. Este planificador limita las sacudidas, por lo que la aceleración cambia suavemente. El tirón en sí todavía puede cambiar abruptamente entre etapas. Su magnitud aproximada es:

```text
jerk = 1000 × acceleration / ramp_time_ms    [counts/s³]
```

<a id="changing-a-destination-during-movement"></a>
### Cambiar un destino durante el movimiento

Un nuevo objetivo continúa desde el movimiento planeado actual, preservando su posición, velocidad y aceleración. Enviar nuevamente el mismo destino no reinicia el movimiento. Mantener el mismo límite de velocidad solicitado mientras se desplaza; puede cambiar para el siguiente movimiento una vez que el movimiento planificado se haya detenido. El tiempo de aceleración y rampa pertenecen a la configuración y requieren el apagado del motor y una sesión desarmada para cambiar.

Un destino fuera de los límites de posición Legacy guardados se **ajusta al límite más cercano**. La velocidad solicitada también se limita al máximo configurado. El servo utiliza la aceleración configurada en cada movimiento. Una velocidad cero o una aceleración configurada igual a cero no son válidas.

Todo el movimiento planificado debe permanecer dentro de los límites de posición. Por lo tanto, se puede rechazar un nuevo objetivo si el servo ya se está acercando a un límite demasiado rápido para detenerse dentro de él, incluso cuando el destino en sí está permitido.

Al llegar, el servo mantiene automáticamente el destino con el motor encendido. Es posible que la posición medida aún tenga algún error debido a la fricción, la carga, los límites de salida o la sintonización. La retención continúa para corregir el error de posición; no congela la salida del motor en un valor fijo.

Cada servo planifica su propio movimiento. Enviar varios objetivos juntos no garantiza que todos los servos lleguen al mismo tiempo.

<a id="shared-position-limits"></a>
### Límites de posición compartida

El control heredado y de extensión utiliza los mismos registros position-limit: **9–10** contiene el mínimo y **11–12** el máximo. Cada uno es un valor de 16 bits sin signo en recuentos de codificador corregidos, incluida la dirección configurada del servo y la corrección de posición. No hay configuraciones de extensión separadas position-limit.

La calibración asigna recuentos del codificador a posiciones físicas. La [herramienta de calibración](tools/settings/README.md#choose-the-reference-pose) hace que la pose de referencia capturada se lea 2048 y luego mide los límites de viaje. Ese recuento no es automáticamente un ángulo de articulación zero-degree y el punto medio del recorrido medido no reemplaza la referencia capturada. Los modelos de gravedad y las visualizaciones necesitan un mapeo count-to-angle coincidente.

El firmware lee estos registros al iniciar el control. Si los límites están habilitados, el mínimo debe ser inferior al máximo, el máximo no debe superar 32767 y la posición medida debe estar dentro del intervalo. En caso contrario, el inicio falla y el motor no se mueve. El planificador mantiene todo el movimiento, incluido el frenado, dentro del intervalo leído.

**Valores mínimos y máximos iguales desactivan los límites de viaje**, lo que coincide con el comportamiento heredado. Los comandos de extensión aún permanecen dentro del rango de posiciones admitidas de −32767 a 32767.

Una escritura aceptada en cualquiera de los límites finaliza una sesión de extensión activa y apaga el motor, incluidas las escrituras que solo se aplican en RAM. Armar una nueva sesión para usar los valores modificados. La persistencia de la configuración heredada normal aún se aplica.

<a id="calibration-reference-poses"></a>
## Posturas de referencia de calibración

Para una nueva calibración SO-101 o SO-102, utilice las posiciones de las articulaciones ilustradas. Centre la base y el rodillo de muñeca entre sus topes y deje la pinza medio abierta. La herramienta de calibración guarda esta pose colocada manualmente como 2048 para cada motor. Mantenga una calibración verificada existente cuando reutilice sus grabaciones y modelo de gravedad.

**SO-101 pose de referencia**

[![SO-101 pose de referencia con seis articulaciones etiquetadas](../../../tools/settings/images/so101-reference-pose.png)](../../../tools/settings/images/so101-reference-pose.png)

**SO-102 pose de referencia**

[![SO-102 pose de referencia con seis articulaciones etiquetadas](../../../tools/settings/images/so102-reference-pose.png)](../../../tools/settings/images/so102-reference-pose.png)

Abra una imagen para verla más grande. Siga la [guía de calibración](tools/settings/README.md#reference-pose-images) para conocer el procedimiento two-step y los requisitos model-mapping.

<a id="pid-controller"></a>
## PID controlador

[![Ilustración conceptual del control pid](../../../assets/readme/illustrations/pid-tuning.png)](https://youtu.be/TEpvaAMlfrg)

[Ver en YouTube](https://youtu.be/TEpvaAMlfrg) | [MP4](../../../assets/readme/videos/pid-tuning.mp4)

Ajusta cómo el servo corrige el error de posición. La curva gris ilustra la oscilación; la curva blanca ilustra una respuesta más amortiguada. La línea discontinua es el objetivo. Ilustración conceptual, datos de hardware no medidos.

El controlador PID ajusta la salida del motor para seguir el movimiento planificado. Sus tres configuraciones tienen diferentes trabajos:

| Configuración | que hace | Principal compensación |
| --- | --- | --- |
| **P — corrección de posición** | Tira del motor hacia la posición planificada; Los errores más grandes producen más corrección. | Una P más alta puede reducir el error pero también puede causar oscilación. |
| **I — corrección acumulada** | Acumula correcciones adicionales cuando persiste un error | Puede reducir un error duradero, pero puede aumentar el exceso o el tiempo de estabilización. |
| **D — corrección de velocidad** | Responde a la diferencia entre velocidad planificada y medida; resiste el movimiento mientras sostiene | Puede mejorar la amortiguación, pero una respuesta excesiva a lecturas de velocidad ruidosas puede hacer que la salida sea desigual |

El cálculo es:

```text
position error = planned position − measured position
speed error = planned speed − filtered measured speed

motor output = Kp × position error
             + Kd × speed error
             + accumulated I correction
             + gravity compensation
             + velocity feedforward
```

El resultado se limita a la potencia máxima configurada. La protección del motor puede reducirlo aún más. La retroalimentación informa tanto la salida solicitada como la aplicada para que el host pueda ver cuándo se está limitando el motor.

La velocidad medida se suaviza utilizando lecturas de posición recientes y un filtro ajustable. Una configuración `velocity_filter_q8` más grande responde más rápido a los cambios pero elimina menos ruido de medición.

<a id="preventing-excessive-accumulated-correction"></a>
### Prevenir la corrección acumulada excesiva

La contribución I tiene su propio límite. El controlador también evita que continúe aumentando en una dirección en la que la salida del motor ya está limitada; esto se llama comúnmente **anti-windup**. Aún puede disminuir para ayudar al motor a recuperarse de ese límite. Establecer `Ki` en cero deshabilita y borra la corrección I.

Cuando el servo lleva al menos 50 ms casi inmóvil y el error de posición no supera una cuenta del codificador, I deja de acumularse. P, D y ambas formas de control anticipativo permanecen activos. Desactivar la salida del motor borra la corrección I.

<a id="velocity-feedforward"></a>
## avance de velocidad

[![Ilustración conceptual de avance de velocidad](../../../assets/readme/illustrations/velocity-feedforward.png)](https://youtu.be/osGGs-nhk9I)

[Ver en YouTube](https://youtu.be/osGGs-nhk9I) | [MP4](../../../assets/readme/videos/velocity-feedforward.mp4)

Agrega salida del motor según la velocidad planificada, calculada dentro del servo. Ambas curvas progresan de izquierda a derecha a lo largo del tiempo. Ilustración conceptual, datos de hardware no medidos.

La velocidad de avance proporciona parte de la salida que se espera que sea necesaria para el movimiento antes de que se desarrolle un error de seguimiento. Se calcula **dentro del servo** a partir de la velocidad planificada:

```text
velocity feedforward = velocity gain × planned speed
```

Hay una ganancia para cada dirección y un límite en la salida resultante. Ambas ganancias no son negativas; La dirección del movimiento determina el signo de salida. Su límite de salida no debe ser mayor que el límite principal motor-output.

Debido a que el servo conoce su propia velocidad planificada, la compensación sigue la aceleración y el frenado automáticamente y se vuelve cero cuando se detiene el movimiento planificado. El anfitrión sólo proporciona su configuración; no necesita enviar valores velocity-feedforward continuos.

Configure esta función junto con las otras configuraciones en `0xA0`, mientras el motor está apagado y la sesión está desarmada. Establezca ambas ganancias y su límite de salida en cero para desactivarlo.

<a id="gravity-compensation"></a>
## Compensación de gravedad

[![Ilustración conceptual de compensación de gravedad](../../../assets/readme/illustrations/gravity-compensation.png)](https://youtu.be/25sc41PTDIA)

[Ver en YouTube](https://youtu.be/25sc41PTDIA) | [MP4](../../../assets/readme/videos/gravity-compensation.mp4)

El anfitrión calcula la contribución y el servo la aplica. La flecha hacia abajo representa el peso; la flecha hacia arriba representa el soporte. Ilustración conceptual, datos de hardware no medidos.

La compensación de gravedad proporciona la potencia necesaria para soportar el peso de un brazo y su carga. Es útil incluso cuando el motor está quieto, donde la velocidad de avance es cero.

El **host calcula la compensación de gravedad** y envía un valor de salida firmado a cada servo. El cálculo puede utilizar ángulos de articulación, dimensiones del brazo, pesos de los eslabones y carga útil. El anfitrión debe convertir la carga estimada en las unidades de salida del servo. El firmware no contiene un modelo del brazo.

La dirección importa: la salida de extensión positiva sigue a recuentos crecientes de codificadores. La convención joint-angle de un brazo puede funcionar en la dirección opuesta, por lo que la conversión del anfitrión debe tener en cuenta eso.

Cada actualización de gravedad contiene el valor de salida deseado. La **tasa de respuesta** (la rapidez con la que puede cambiar la compensación, en unidades de salida por segundo) es parte de la configuración principal y permanece fija durante toda la sesión.

El servo cambia gradualmente su compensación hacia el valor solicitado y lo suma a la salida del controlador. Todas las contribuciones juntas quedan sujetas al límite de potencia configurado y a la protección del motor.

**Si las actualizaciones de gravedad dejan de llegar, el servo continúa hacia la última compensación solicitada a su velocidad de giro configurada y luego mantiene ese valor.** No hay un temporizador de caducidad. El anfitrión debe actualizar la compensación cuando cambia la postura del brazo o la carga. Establecer el registro torque-enable **40** en cero borra la compensación y desactiva la salida del motor.

<a id="starting-and-stopping-extension-mode"></a>
## Iniciar y detener el modo de extensión

La siguiente secuencia utiliza los números de registro y los comandos documentados más adelante. La selección prepara una sesión; habilitando el control de arranque de potencia del motor.

1. Encuentre las ID de los servos conectados y lea las capacidades de cada servo. Verifique `ARMC` y la versión `9.0`. Repita esta verificación después de un reinicio o cambio de firmware.
2. Apague el motor configurando el registro torque-enable heredado **40** en `0`. Finalice cualquier sesión existente y aplique cualquier configuración heredada permanente.
3. Escriba y lea la configuración completa (`0xA0`), incluidas las configuraciones de avance de velocidad y la velocidad de giro de la gravedad.
4. Escriba `mode=1` y un nuevo número de sesión distinto de cero en `0xB8` (3 bytes en total). Esto selecciona el modo de extensión y prepara el próximo inicio; la energía permanece apagada.
5. Establezca el registro **40** en `1`. El firmware verifica los sensores, el estado de protección, la configuración y los límites de posición guardados, luego captura la posición medida como objetivo de retención inicial. Los contadores de comando, corrección I y compensación de gravedad comienzan en cero. Lea `0xC1` y espere la sesión correcta, las mediciones actuales utilizables, el accionamiento del motor habilitado y la salida lista.
6. Envíe objetivos y cualquier actualización de gravedad. Lea los comentarios para verificar qué comandos fueron aceptados y qué tan cerca los sigue el servo.
7. El servo finaliza su último movimiento y mantiene el destino hasta que se le asigna un nuevo objetivo. Configure el registro **40** en `0` para apagar el motor y finalizar la sesión. Para volver al modo heredado, mantenga apagado y escriba `mode=0, session=0` en `0xB8`.

Si falla un inicio, el registro **40** vuelve a `0`. Su reconocimiento de escritura normal por sí solo no confirma un inicio exitoso: verifique la lectura y la retroalimentación del registro. Cada intento de inicio consume la sesión preparada. Después de un inicio fallido, torque-off o apagado de la protección, corrija la causa y escriba `0xB8` con un nuevo número de sesión antes de volver a habilitar el torque. La repetición de la habilitación del par mientras el control está en funcionamiento conserva sus contadores de objetivo, compensación y comando.

Los comandos que mueven o ajustan un motor motorizado requieren hardware listo, no se reporta ninguna falla y las lecturas del sensor no tienen más de **2 ms** de antigüedad. El controlador normalmente actualiza cada **1 ms** y acepta intervalos de hasta 2 ms. Los espacios más largos provocan que se desactive la salida del motor.

Mientras usa la extensión, evite escrituras heredadas en el registro de modo operativo **33** o en los registros de movimiento **41–47**: apagan el motor y abandonan el modo de extensión. Guardar la configuración permanente también finaliza el control de la extensión. Configurar el registro **40** en `0` deja el modo de extensión seleccionado, listo para configurar otra sesión.

<a id="if-host-commands-stop-arriving"></a>
### Si los comandos del host dejan de llegar

El servo finaliza el último movimiento aceptado y sigue manteniendo ese destino. La compensación de gravedad continúa hasta su último valor solicitado y permanece allí. No se necesitan mensajes repetidos para mantener la sesión activa, y la pérdida de comunicación con el host no cambia el objetivo ni apaga el motor.

Para cambiar dónde va el servo, envíe otro objetivo. Para liberar el motor, establezca la habilitación de par en cero. Las comprobaciones de frescura del sensor, la protección del motor y el dispositivo de vigilancia del firmware permanecen activos mientras se mueve y se sostiene.

<a id="extension-protocol"></a>
## Protocolo de extensión

Esta sección describe los mensajes exactos intercambiados entre el host y el servo. Está destinado a lectores que conectan su propio software.

<a id="message-format-and-number-encoding"></a>
### Formato de mensaje y codificación de números.

Cada mensaje es un paquete: una secuencia de bytes que contiene el destino, el comando, los datos y una suma de verificación utilizada para detectar errores de transmisión. Los comandos de extensión utilizan el formato de paquete estándar STS:

```text
Request:  FF FF ID LENGTH INSTRUCTION PARAMETERS... CHECKSUM
Response: FF FF ID LENGTH LEGACY_ERROR EXT_STATUS DATA... CHECKSUM
```

- Solicitar `LENGTH = parameter_bytes + 2`.
- Respuesta `LENGTH = data_bytes + 3`; el estado de la extensión ocupa el primer parámetro de respuesta, por separado del byte de error heredado normal.
- `CHECKSUM = ~(ID + LENGTH + instruction_or_error + all_parameter_bytes) & 0xFF`. La suma de la respuesta incluye `EXT_STATUS` y cualquier dato.
- Un campo que ocupa varios bytes envía primero el byte menos significativo (**little-endian**). Por ejemplo, el número 256 se envía como `00 01` en dos bytes.
- `u8`, `u16` y `u32` son números enteros no negativos que ocupan 1, 2 y 4 bytes. `i16` y `i32` ocupan 2 y 4 bytes y también pueden representar números negativos. Los valores de extensión con signo utilizan **complemento a dos**: por ejemplo, −1 es `FF FF` en un campo `i16`. Esto difiere de la codificación heredada de valores con signo.
- **Q8** significa que un valor se multiplica por 256 antes de la transmisión para que las fracciones se puedan representar como números enteros. Divide por 256 al leerlo. Por ejemplo, la posición 1000 cuenta se envía como 256000 y la ganancia 4.5 se envía como 1152.
- La posición está en los recuentos del codificador y la velocidad está en counts/s. El host maneja cualquier conversión a ángulos de articulación, incluidos cambios de dirección o posición cero.
- **Unicast** significa un mensaje dirigido a un servo. **Transmitir** usa ID `0xFE` y llega a todos los servos. Los comandos de extensión de transmisión nunca generan respuestas.

Ejemplo: lea el bloque de capacidades de 8 bytes del servo ID 1:

```text
FF FF 01 04 90 90 08 D2
```

Un **selector** identifica un bloque de registro completo, como configuración o retroalimentación. Acceda a él con la extensión READ/WRITE y el tamaño de bloque exacto que se detalla a continuación. No se admite leer o escribir solo una parte de un bloque y los comandos READ/WRITE heredados no pueden acceder a estos bloques.

<a id="instructions"></a>
### Instrucciones

Los tamaños de parámetros siguientes excluyen el encabezado del paquete y la suma de comprobación. En una respuesta, `EXT_STATUS` informa si el comando de extensión tuvo éxito, independientemente de `LEGACY_ERROR`, el byte de error normal del servo. Una lectura exitosa agrega los datos solicitados después de `EXT_STATUS`; Las escrituras, otros comandos y las lecturas fallidas no tienen datos adicionales.

| Instrucción | Nombre | Parámetros | Difusión |
| --- | --- | --- | --- |
| `0x90` | READ | `selector:u8, count:u8` | Ninguna respuesta útil |
| `0x91` | WRITE | `selector:u8, block...` | No aceptado |
| `0x99` | GRAVITY | 6 bytes, debajo | No aceptado |
| `0x9A` | TARGETS | `session:u16` + 1–6 entradas de 9 bytes | Aceptado |

Números de instrucción `0x92`, `0x93`, `0x94`, `0x95`, `0x96`, `0x97` y `0x98`, y selectores `0xA1`, `0xA3`, `0xB0`, `0xBA`, `0xE0` y `0xF0`, están reservados y no deben utilizarse.

| Estado de la extensión | Significado |
| --- | --- |
| `0` | OK |
| `1` | Longitud, selector o valor de campo no válidos |
| `2` | El comando no se puede aceptar en el estado actual |
| `3` | Reservado |
| `4` | Reservado |
| `5` | Instrucción no compatible |

Una discrepancia de sesión devuelve un estado fallido. Inspeccione tanto el byte de error heredado como el estado de la extensión.

<a id="sessions-and-sequence-numbers"></a>
### Sesiones y números de secuencia.

El anfitrión asigna a cada sesión un número del 1 al 65535 y lo incluye en los comandos de control. Esto permite al servo verificar que un comando pertenece a la sesión actual. Elija un nuevo número para cada inicio; Los números de configuración no se almacenan permanentemente.

Un **número de secuencia** cuenta los comandos aceptados en orden, lo que permite al host y al servo identificar comandos faltantes, repetidos o out-of-order.

TARGETS tiene un contador de secuencia de movimiento per-servo. GRAVITY tiene un mostrador independiente. Ambos comienzan en cero cuando la habilitación de par inicia el control; normalmente envía **1** primero. Los números aumentan hasta 65535 y luego terminan hasta **0**, sin finalizar la sesión. Se permiten espacios: después de 10, el servo puede aceptar 12 incluso si 11 se perdió o rechazó. Los números iguales o mayores se rechazan sin cambiar el comando actual.

Para una comparación exacta, calcule `distance = (incoming − accepted) & 0xFFFF`. Un comando es más nuevo solo cuando `1 ≤ distance ≤ 32767`. Un salto de exactamente 32768 es ambiguo y rechazado. Mantenga el espacio desde el último comando aceptado a continuación 32768; Si el historial de comandos es incierto, desactive el torque, prepare una nueva sesión ID y habilite el torque nuevamente. No reutilice paquetes en cola de una sesión o ciclo de contador anterior.

La aceptación aún requiere campos válidos, lecturas actuales del sensor y un movimiento factible. Un comando rechazado no avanza su contador. Estos comandos reemplazan a los objetivos absolutos; no son una cola de waypoints. Para visitar cada punto de ruta, espere cada llegada antes de enviar el siguiente destino.

Al enviar un objetivo de grupo, lea la retroalimentación de cada servo para verificar su secuencia aceptada. Cada servo decide independientemente si puede aceptar su objetivo; uno puede rechazarlo mientras los demás empiezan a moverse.

<a id="targets--0x9a"></a>
### TARGETS — `0x9A`

Los primeros dos bytes de parámetros contienen la sesión compartida. Cada entrada siguiente tiene este diseño; Las compensaciones son relativas al inicio de esa entrada:

| compensación | Tipo | campo |
| --- | --- | --- |
| 0 | `u8` | Servo ID, 1–253 |
| 1 | `u16` | Nueva secuencia de movimiento para este servo. |
| 3 | `i32` | Posición de destino, Q8 cuenta |
| 7 | `u16` | Velocidad máxima, counts/s, distinta de cero |

La longitud del parámetro es `2 + 9 × entry_count`, como máximo 56 bytes. Las identificaciones deben ser únicas. Cada servo verifica el formato y los campos obligatorios de **todas** las entradas antes de manejar las suyas. Un servo que no aparece en la lista no hace nada. Un servo listado verifica su sesión, secuencia, preparación y si el movimiento puede permanecer dentro de sus límites. Un objetivo aceptado comienza inmediatamente y permanece activo hasta que sea reemplazado o desarmado. Los valores están limitados a los límites configurados como se describe en movimiento S-curve.

<a id="gravity--0x99"></a>
### GRAVITY — `0x99`

| compensación | Tipo | Campo/restricción |
| --- | --- | --- |
| 0 | `u16` | Sesión actual |
| 2 | `u16` | Nueva secuencia de gravedad |
| 4 | `i16` | Esfuerzo de gravedad deseado; magnitud ≤ límite de salida configurado |

La longitud del parámetro es exactamente 6 bytes. Requiere una sesión armada con el motor encendido, hardware listo, sin fallas reportadas y lecturas recientes del sensor. No avanza la secuencia de movimiento. El valor solicitado permanece activo hasta que sea reemplazado o desarmado.

<a id="extension-registers"></a>
## Registros de extensión

Un **desplazamiento** es el byte inicial de un campo, contando desde cero dentro de su bloque. Las compensaciones siguientes son decimales; Los selectores utilizan notación hexadecimal (`0x...`). Todas las escrituras utilizan la instrucción `0x91`; lee el uso `0x90` con el recuento exacto de bytes.

| Selector | Bloquear | Acceso | bytes |
| --- | --- | --- | --- |
| `0x90` | Capacidades | leer | 8 |
| `0xA0` | Configuración | Read/write | 24 |
| `0xB8` | Selección de controlador y configuración de sesión. | escribir | 3 |
| `0xC1` | Comentarios operativos | leer | 32 |
| `0xC2` | Comentarios de ajuste | leer | 54 |

<a id="capabilities--0x90"></a>
### Capacidades — `0x90`

| compensación | Tipo | Valor / significado |
| --- | --- | --- |
| 0–3 | 4 bytes | ASCII `ARMC` |
| 4 | `u8` | Versión principal: 9 |
| 5 | `u8` | Versión menor: 0 |
| 6 | `u8` | Reservado: 0 |
| 7 | `u8` | Intervalo normal de actualización del controlador: 1 ms |

La versión del protocolo define los bloques disponibles y sus longitudes exactas. La selección y la configuración de la sesión comparten un bloque write-only, documentado a continuación.

<a id="configuration--0xa0"></a>
### Configuración — `0xA0`

| compensación | Tipo | campo | Unidades/rango válido |
| --- | --- | --- | --- |
| 0 | `u16` | `kp_q8` | Ganancia × 256; 0–65535 |
| 2 | `u16` | `kd_q8` | Ganancia × 256; 0–65535 |
| 4 | `u16` | `ki_q8` | Ganancia × 256; 0–65535 |
| 6 | `u16` | `integral_limit` | Esfuerzo; 0–`effort_limit` |
| 8 | `u16` | `effort_limit` | Esfuerzo; 1–1000 |
| 10 | `u16` | `velocity_limit` | Counts/s; 1–65535 |
| 12 | `u16` | `acceleration_limit` | Counts/s²; 1–30000 |
| 14 | `u8` | `velocity_filter_q8` | Speed-filter respuesta; 1–255, más alto responde más rápido |
| 15 | `u8` | `ramp_time_ms` | Rampa de aceleración; 1–255 ms |
| 16 | `u16` | `velocity_ff.positive_gain_q8` | Salida/(count/s) × 256; 0–65535 |
| 18 | `u16` | `velocity_ff.negative_gain_q8` | Salida/(count/s) × 256; 0–65535 |
| 20 | `u16` | `velocity_ff.effort_limit` | Esfuerzo; 0–principal `effort_limit` |
| 22 | `u16` | `gravity_slew` | Cambio de compensación, esfuerzo units/s; 1–10000 |

Las ganancias se envían como el valor deseado multiplicado por 256. Sus unidades son output/count para P, salida/(count/s) para D y salida/(count·s) para I. Por ejemplo, P = 4.5 produce 4.5 unidades de salida por recuento de error y se envía como 1152.

El servo tiene **una configuración activa**. Escribirlo requiere apagado del motor y sesión desarmada. Cada escritura reemplaza toda la configuración, incluida la configuración de avance. Las configuraciones no válidas rechazan la escritura completa sin cambiar nada. Lea `0xA0` para verificar las configuraciones que fueron aceptadas.

Velocity-feedforward las ganancias no son negativas. Un límite de salida anticipado cero requiere que ambas ganancias sean cero. El mismo límite de salida anticipada se aplica en ambas direcciones y no debe exceder el límite de salida principal.

Después de un reinicio, configure el servo antes de habilitar la alimentación del motor. Mantenga las configuraciones guardadas y los valores de ajuste alternativos en el host; Cambie las ganancias entre carreras con el brazo apoyado y el motor apagado.

<a id="selection-and-session-setup--0xb8"></a>
### Selección y configuración de sesión — `0xB8`

| compensación | Tipo | Significado |
| --- | --- | --- |
| 0 | `u8` | Modo: `0` heredado, `1` extensión |
| 1 | `u16` | Sesión: `0` para legado, `1–65535` para extensión |

La longitud exacta de la carga útil es **3 bytes**, con la sesión en orden little-endian. Por ejemplo, el modo de extensión con sesión `0x1234` es `01 34 12`; el modo heredado es `00 00 00`. Las combinaciones no válidas rechazan toda la escritura sin cambiar de estado. Ambos modos requieren que el motor se apague y reemplazan cualquier configuración de sesión anterior. La selección por sí sola no inicia el control ni captura una posición de espera.

El registro heredado torque-enable **40** inicia la sesión de extensión preparada cuando se escribe en `1`. Requiere salida de motor disponible, una configuración válida, sensores inicializados con lecturas de no más de 2 ms de antigüedad, ninguna falla que requiera apagado y límites de posición heredados guardados utilizables. La posición medida debe estar dentro de esos límites cuando estén habilitados. Estas comprobaciones se realizan en el momento de la habilitación, por lo que se tienen en cuenta los movimientos o las fallas entre la configuración y la habilitación.

Torque-off cancela tanto el control en ejecución como la configuración no utilizada. Las fallas del sensor, el apagado de la protección, los cambios position-limit o encoder-offset, la calibración y el guardado de configuraciones permanentes también invalidan la configuración de la sesión. Lea los comentarios para comprobar si el control realmente ha comenzado; no hay un comando ARM separado. Se rechazan el antiguo selector `0xBA` y la carga útil de selección anterior one-byte.

<a id="operational-feedback--0xc1"></a>
### Comentarios operativos — `0xC1`

| compensación | Tipo | Campo / unidades |
| --- | --- | --- |
| 0 | `u32` | Tiempo de medición, ms desde el inicio; vuelve a cero después de 4294967295 |
| 4 | `u16` | Número de medida; vuelve a cero después de 65535 |
| 6 | `u16` | Sesión |
| 8 | `u16` | Secuencia objetivo aceptada |
| 10 | `u16` | Secuencia de gravedad aceptada |
| 12 | `u16` | Banderas, abajo |
| 14 | `i32` | Posición medida, Q8 cuenta |
| 18 | `i32` | Velocidad medida filtrada, Q8 counts/s |
| 22 | `i16` | Salida aplicada; positivo sigue a recuentos crecientes de codificadores |
| 24 | `i16` | Current-sensor lectura relativa a su línea base; no amperios |
| 26 | `u8` | Tensión de alimentación, unidades de 0.1 V |
| 27 | `u8` | Temperatura validada, °C |
| 28 | `u8` | Servo heredado fault/status banderas |
| 29 | `u8` | Reservado: cero |
| 30 | `u16` | Edad de medición en el momento de la lectura, ms; valor máximo informado 65535 |

| Bit de bandera | Significado cuando se establece |
| --- | --- |
| 0 | La muestra es nueva y utilizable para el estado actual de control del brazo. |
| 1 | Controlador activo |
| 2 | Reservado: cero |
| 3 | Potencia del motor limitada |
| 4 | Unidad de brazo habilitada |
| 5 | Sesión iniciada por habilitación de torque |
| 6 | Reservado: cero |
| 7 | Salida lista |
| 8 | Se ha recibido un comando de gravedad. |
| 9 | Reservado: cero |
| 10 | Temperatura validada disponible |
| 11 | Reservado: cero |
| 12 | Objetivo de movimiento activo |
| 13 | Reservado: cero |
| 14 | Controlador de brazo seleccionado |
| 15 | Reservado: cero |

Cada indicador es un bit: el bit 0 tiene el valor 1, el bit 1 tiene el valor 2, el bit 2 tiene el valor 4, y así sucesivamente. Se pueden configurar varias banderas a la vez. Un controlador activo con el bit 12 limpio mantiene su destino. Un bit de movimiento claro por sí solo no significa que el motor esté encendido o listo.

La retroalimentación describe una medición registrada. Si el estado del servo cambia antes de que el host lo lea, algunos campos pueden describir el estado anterior. El bit 0 se borra cuando la medición tiene más de 2 ms, el controlador ya no está seleccionado, armado, conduciendo o listo, o sus números session/sequence ya no coinciden. Verifique el bit 0, la edad, la sesión y la secuencia aceptada juntas.

Las lecturas de posición y salud también están disponibles en modo heredado y con el motor apagado. Los campos de control no disponibles son cero. La secuencia de muestra avanza cuando se adquieren las mediciones, no cada vez que el host las lee. Distingue muestras que comparten la misma marca de tiempo de milisegundos. Los grandes cambios de temperatura inesperados se verifican en varias lecturas antes de aparecer aquí; consulte la limitación de protección a continuación.

<a id="tuning-feedback--0xc2"></a>
### Comentarios de ajuste - `0xC2`

Los bytes 0–31 tienen exactamente el diseño `0xC1`. Los bytes restantes son:

| compensación | Tipo | Campo / unidades |
| --- | --- | --- |
| 32 | `i32` | Posición de referencia, Q8 cuenta |
| 36 | `i32` | Velocidad de referencia, Q8 counts/s |
| 40 | `i16` | Salida solicitada después de su límite configurado, antes de la protección del motor |
| 42 | `i16` | P contribución, esfuerzo |
| 44 | `i16` | D contribución, esfuerzo |
| 46 | `i16` | Aporte integral, esfuerzo. |
| 48 | `i16` | Compensación de gravedad aplicada actualmente, esfuerzo |
| 50 | `i16` | Avance de velocidad local, esfuerzo |
| 52 | `u16` | Retardo adicional acumulado del controlador, ms; máximo 65535 |

El contador de retraso agrega el tiempo adicional cada vez que una actualización del controlador demora más de los 1 ms (`elapsed_ms − 1`) normales. No cuenta mensajes perdidos. Las contribuciones P y D informadas se limitan a ±32767, por lo que agregar los valores mostrados puede no reproducir el cálculo interno completo.

El servo envía retroalimentación solo cuando se le solicita. Utilice `0xC1` para monitoreo normal y `0xC2` cuando el ajuste necesite valores adicionales. La lectura de `0xC2` ya incluye todo `0xC1`, por lo que leer ambos agrega tráfico innecesariamente. Las lecturas separadas pueden referirse a momentos diferentes; compare sus marcas de tiempo y números de muestra.

<a id="build-and-verification"></a>
## Construcción y verificación

Las fuentes de firmware, las pruebas y las reglas de compilación se encuentran en [`firmware/`](firmware/README.md). Después de instalar la [cadena de herramientas](firmware/README.md#build-and-verify), ejecute:

```sh
make
make verify
```

La salida de la compilación se ignora `build/`. La verificación está fuera de línea y no actualiza el hardware. Consulte [verificaciones de proyecto](tools/README.md#offline-checks) para pruebas de host, flashing-tool y espectadores. Para instalar una versión de firmware publicada, utilice la [herramienta de flash y recuperación](tools/flash/README.md).

<a id="repository-layout"></a>
## Diseño del repositorio

| Directorio | Responsabilidad |
| --- | --- |
| [`firmware/`](firmware/README.md) | Fuentes C, encabezados, controladores de hardware, secuencias de comandos del vinculador, reglas de compilación y pruebas de firmware. |
| [`host/servo-driver/`](host/servo-driver/README.md) | Controlador Node.js instalable para comandos heredados y la extensión v9 |
| [`tools/teleoperation/`](tools/teleoperation/README.md) | Controlar a un seguidor desde un líder hand-operated |
| [`tools/poses/`](tools/poses/README.md) | Graba poses y reproduce con control heredado o de extensión. |
| [`tools/settings/`](tools/settings/README.md) | Descubrimiento de motores, calibración conjunta y configuración backup/restore |
| [`tools/tuning/`](tools/tuning/README.md) | Comparar la configuración del controlador en lotes |
| [`tools/simulation/`](tools/simulation/README.md) | Vea movimiento en vivo y reproduzca telemetría grabada |
| [`tools/hw-diff-tests/`](tools/hw-diff-tests/README.md) | Pruebas de comparación de hardware para firmware personalizado y de fábrica |
| [`tools/diagnostics/`](tools/diagnostics/README.md) | Puntos de referencia de latencia de bus y comprobaciones de telemetría estacionarias |
| [`tools/flash/`](tools/flash/README.md) | Actualización de firmware y recuperación de configuración. |

Para obtener detalles de implementación, consulte los [comandos de extensión](../../../firmware/app/arm_extension.c), [planificador de movimiento](../../../firmware/core/control/arm_motion.c), [controlador de brazo](../../../firmware/core/control/arm_control.c) y [tiempo de ejecución](../../../firmware/app/runtime.c). Los avisos de redistribución de proveedores se conservan en los encabezados y en [proveedor README](firmware/platform/gd32f130/vendor/README.md).

<a id="current-limits"></a>
## Límites actuales

[![Juego de la caja de cambios y flexión del marco](../../../assets/readme/posters/mechanical-limits.jpg)](https://youtu.be/53l7at5aE6k)

[Ver en YouTube](https://youtu.be/53l7at5aE6k) | [MP4](../../../assets/readme/videos/mechanical-limits.mp4)

La temperatura reportada a través de la retroalimentación de extensión se verifica para suprimir saltos aislados, pero la protección de temperatura del motor aún usa las lecturas sin procesar del sensor. Esto significa que una breve mala lectura puede afectar la protección incluso si se filtra de los comentarios de la extensión.

Las ganancias, los límites y las compensaciones deben ajustarse al mecanismo real. Las pruebas de software por sí solas no establecen cómo se comportará un brazo bajo carga. Verifique la posición medida, la velocidad y la salida aplicada para evaluar la precisión, el asentamiento y si el motor está alcanzando su límite de salida.
<!-- /translated-content -->
