<!-- translation-navigation -->
[English](../../../en/tools/teleoperation/README.md) · [Русский](../../../ru/tools/teleoperation/README.md) · [Español](README.md) · [Français](../../../fr/tools/teleoperation/README.md) · [Deutsch](../../../de/tools/teleoperation/README.md) · [Português (Brasil)](../../../pt-BR/tools/teleoperation/README.md) · [简体中文](../../../zh-CN/tools/teleoperation/README.md) · [日本語](../../../ja/tools/teleoperation/README.md) · [हिन्दी](../../../hi/tools/teleoperation/README.md) · [العربية](../../../ar/tools/teleoperation/README.md)

[Original en inglés](../../../../../tools/teleoperation/README.md)

> Traducción automática completa, aún no revisada por un hablante nativo. Las imágenes y los vídeos son compartidos; su texto permanece en el idioma original.
<!-- /translation-navigation -->

<!-- translated-content -->
<a id="teleoperation"></a>
# Teleoperación

Mueva a un seguidor con poder moviendo a un líder sin poder con la mano. Admite pares de juntas 1–6 en dos buses en serie separados. El líder podrá utilizar firmware de fábrica; el seguidor requiere el firmware v9 de este repositorio.

<a id="run"></a>
## correr

Instale Node.js 20 o más reciente, luego ejecute `npm install` desde la raíz del repositorio. Copie [example.json](../../../../../tools/teleoperation/example.json) junto al original como `controller.local.json`. Establezca los puertos, la velocidad en baudios y los ID de las juntas. El ejemplo comparte el [perfil de motor](../../../../../host/arm-control/profile.example.json) con repetición y ajuste. Cópialo para tu propia configuración y actualiza su ruta, o integra tus perfiles. Las rutas son relativas al archivo del controlador. Las ganancias de ejemplo ilustran el formato; Utilice la configuración probada en su mecanismo.

Obtenga una vista previa del mapeo sin cambiar ninguna configuración del motor:

```sh
npm run teleoperate -- CONFIG.json
```

Verifique las posiciones y objetivos informados, apoye ambos mecanismos y deje espacio para que el seguidor avance hacia la postura del líder. Iniciar el control explícitamente:

```sh
npm run teleoperate -- CONFIG.json --run
```

Cada bus debe contener exactamente sus ID configurados. Ambos mecanismos necesitan límites de posición no vacíos guardados y modo de posición normal con resolución unitaria. La configuración del seguidor debe estar bloqueada sin ninguna escritura diferida pendiente. El torque líder ya debe estar desactivado; esta herramienta nunca le escribe al líder. El arranque del seguidor maneja automáticamente los motores con y sin alimentación.

Las ejecuciones continúan hasta Ctrl+C a menos que establezca explícitamente `durationMs`. **La salida normal mantiene una retención eléctrica.** El inicio, la gravedad y la limpieza de fallas siguen el [comportamiento del controlador compartido](../../host/arm-control/README.md#control-behaviour).

<a id="mapping-and-control"></a>
## Mapeo y control

Cada entrada `joints` contiene `leaderId`, `followerId` y `mapping`:

| Configuración | Significado |
| --- | --- |
| `mapping: "angle"` | Preserva el desplazamiento del codificador desde el centro de los límites almacenados. |
| `mapping: "range"` | Escale cada mitad del recorrido del líder a la mitad correspondiente del seguidor. Útil para pinzas. |
| `direction` | `1` (predeterminado) o `-1` para invertir el movimiento. |
| `leaderMiddle`, `followerMiddle` | Centros opcionales para mapeo de rangos, estrictamente dentro de los límites respectivos. |

Los objetivos están limitados a los límites guardados del seguidor. `angle` opera en conteos de codificador, por lo que asume escalas y engranajes de codificador compatibles.

El centro de mapeo es el punto medio de los límites guardados, que pueden diferir de la referencia de calibración en 2048. Por lo tanto, la coincidencia de las posturas de calibración por sí sola no garantiza la coincidencia de objetivos cuando los límites del líder y del seguidor son asimétricos. Obtenga una vista previa del mapeo antes de moverse. `leaderMiddle` y `followerMiddle` anulan los centros solo para el mapeo `range`.

Proporcione un perfil para cada seguidor y una configuración acceleration/ramp compartida como se describe en [configuración del motor](../../host/arm-control/README.md#motor-settings-files). Agregue `gravityModel` para habilitar [compensación de gravedad](../../host/arm-control/README.md#enable-gravity).

<a id="timing-and-checks"></a>
## Calendario y controles

| Configuración opcional | Predeterminado | Significado |
| --- | --- | --- |
| `hz` | 60 | Frecuencia de actualización solicitada, 1–60 Hz. Se omiten los períodos perdidos. |
| `maxAgeMs` | 100 | Edad máxima de un marco líder antes de enviarlo, 10–10000 ms. |
| `responseTimeoutMs` | 100 | Tiempo de espera de la cola de respuestas y transacciones, 25–10000 ms. |
| `durationMs` | Ilimitado | Duración de la ejecución, incluido el inicio del control, 1–86400000 ms. |

Cada cuadro debe incluir todas las posiciones de líder y permanecer dentro de `maxAgeMs` hasta que se envíe. Se omiten los períodos de actualización perdidos. La retroalimentación, la gravedad y el registro comparten el circuito de control; La velocidad alcanzada depende del rendimiento del bus y de la computadora. Consulte [controles compartidos y plazos](../../host/arm-control/README.md#checks-and-timing).

Los registros se guardan en `logs/motion/` ignorado como newline-delimited JSON. Contienen configuración, la sesión elegida ID, vista previa, comandos previstos, marcos enviados, comentarios y registros stop/error. Un registro de mando por sí solo no prueba que un objetivo haya sido enviado o aceptado. Se esperan escrituras sin acumular una cola de registro ilimitada; el registro lento puede activar la verificación frame-age.

Reproduzca registros sin un líder conectado usando el [recorded-session comando de reproducción](../poses/README.md#replay-a-recorded-session).

Ejecute pruebas sin conexión con `npm run test:teleoperation`.
<!-- /translated-content -->
