<!-- translation-navigation -->
[English](../../../../en/host/arm-control/profiles/README.md) · [Русский](../../../../ru/host/arm-control/profiles/README.md) · [Español](README.md) · [Français](../../../../fr/host/arm-control/profiles/README.md) · [Deutsch](../../../../de/host/arm-control/profiles/README.md) · [Português (Brasil)](../../../../pt-BR/host/arm-control/profiles/README.md) · [简体中文](../../../../zh-CN/host/arm-control/profiles/README.md) · [日本語](../../../../ja/host/arm-control/profiles/README.md) · [हिन्दी](../../../../hi/host/arm-control/profiles/README.md) · [العربية](../../../../ar/host/arm-control/profiles/README.md)

[Original en inglés](../../../../../../host/arm-control/profiles/README.md)

> Traducción automática completa, aún no revisada por un hablante nativo. Las imágenes y los vídeos son compartidos; su texto permanece en el idioma original.
<!-- /translation-navigation -->

<!-- translated-content -->
<a id="arm-profiles"></a>
# Perfiles de brazo

Configuraciones de referencia desde la posición vertical, empty-gripper brazos. Cada directorio contiene un archivo de controlador y un perfil por motor, incluido PID y avance de velocidad direccional. Ambos controladores utilizan los modelos de gravedad para motores 2–4; Los motores 1, 5 y 6 reciben un esfuerzo de gravedad cero.

| Perfil | Velocidad de reproducción | aceleración | Alcance |
| --- | ---: | ---: | --- |
| [SO-101](../../../../../../host/arm-control/profiles/so101/controller.json) | 1,000 counts/s; techo de perfil 1,500 | 10,000 counts/s² | Configuración de sintonización retenida. La oscilación del movimiento M1 y las excursiones más lentas M2 siguen sin resolverse. |
| [SO-102](../../../../../../host/arm-control/profiles/so102/controller.json) | 2,000 counts/s | 15,000 counts/s² | Configuración de comparación actual fixed-profile. Esta configuración rápida aún necesita validación de hardware. |

Estos son puntos de partida, no valores predeterminados universales o una afirmación de un ajuste completo. El perfil SO-102 utiliza M1 D=0.0625 fijo, M6 P=4 y una rampa de 100 ms. La repetición anterior usaba M1 D=0.75 mientras se movía, M6 P=16 y una rampa de 180 ms, por lo que este archivo no reproduce esa ejecución anterior.

<a id="use"></a>
## uso

Establezca `followerPort` en el archivo del controlador elegido. Mantenga intactos el perfil relativo y las rutas de gravedad. Desde la raíz del repositorio:

```sh
npm run replay -- host/arm-control/profiles/so102/controller.json POSES.json
npm run replay -- host/arm-control/profiles/so102/controller.json POSES.json --run
```

Utilice `so101` para el otro perfil. El primer comando muestra una vista previa; el segundo mueve el brazo y lo deja manteniendo la pose final. La reproducción aplica los perfiles a RAM. Para la teleoperación, configure también `leaderPort` y agregue `leaderId`, `mapping` y cualquier direction/center anulaciones a cada articulación; consulte la [guía de mapeo](../../../tools/teleoperation/README.md#mapping-and-control).

Los modelos de gravedad incluyen la calibración del codificador utilizada durante el montaje. La verificación previa requiere que coincida con el brazo conectado. **No copie las compensaciones del codificador de otro brazo para cumplir con esta verificación.** Calibre su brazo, ajuste o adapte su modelo y valide el resultado a una velocidad modesta antes de usarlo full-speed. Los cambios en el montaje, la geometría del enlace o la carga útil también requieren validación. Consulte el [formato del modelo de gravedad](../models/README.md) y el [procedimiento de ajuste](../../../tools/tuning/README.md).

Estos archivos no definen una postura de calibración física universal. Siga la [reference-pose guía](../../../tools/settings/README.md#choose-the-reference-pose) antes de crear una nueva calibración. Configurar todos los motores en 2048 reproduce la pose capturada en ese brazo, sujeta a sus límites guardados y al error de seguimiento; no reproduce automáticamente la pose cero de ninguno de los modelos incluidos.
<!-- /translated-content -->
