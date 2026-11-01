<!-- translation-navigation -->
[English](../../../en/tools/flash/README.md) · [Русский](../../../ru/tools/flash/README.md) · [Español](README.md) · [Français](../../../fr/tools/flash/README.md) · [Deutsch](../../../de/tools/flash/README.md) · [Português (Brasil)](../../../pt-BR/tools/flash/README.md) · [简体中文](../../../zh-CN/tools/flash/README.md) · [日本語](../../../ja/tools/flash/README.md) · [हिन्दी](../../../hi/tools/flash/README.md) · [العربية](../../../ar/tools/flash/README.md)

[Original en inglés](../../../../../tools/flash/README.md)

> Traducción automática completa, aún no revisada por un hablante nativo. Las imágenes y los vídeos son compartidos; su texto permanece en el idioma original.
<!-- /translation-navigation -->

<!-- translated-content -->
<a id="flash-firmware"></a>
# firmware flash

Actualice firmware personalizado o de fábrica en un servo compatible **GD32F130 STS TTL**. Un cargador se encarga de ambos; el manifiesto de lanzamiento selecciona las comprobaciones de la aplicación.

**Advertencia: la actualización del firmware puede dañar su servo, borrar la calibración o dejarlo inutilizable. Utilice esta herramienta bajo su propio riesgo. La recuperación no está garantizada.**

Utilice la imagen de firmware del editor y la coincidencia `release.json`, guardadas en la misma carpeta. No se admiten compilaciones de firmware sin formato. Verifique la compatibilidad del hardware de la versión antes de flashear.

<a id="install"></a>
## Instalar

Requiere **Python 3.10 o más reciente**. Ejecutar desde la raíz del repositorio:

```sh
python3 -m venv tools/flash/.venv
source tools/flash/.venv/bin/activate
python -m pip install -r tools/flash/requirements.txt
```

En Windows, actívelo con `tools\flash\.venv\Scripts\Activate.ps1` en su lugar.

<a id="choose-firmware"></a>
## Elija firmware

| firmware | Manifiesto |
| --- | --- |
| Extensión personalizada v9 | Descargue la imagen del editor y `release.json` juntos en `tools/flash/releases/`. |
| Fábrica **SCServo21-GD32-TTL 3.10**, modelo **9.3** | Incluido en [`factory/release.json`](../../../../../tools/flash/factory/release.json), junto con su imagen. |

La imagen de fábrica es solo para hardware coincidente. Utilice el manifiesto seleccionado con `inspect`, `flash` o `recover`; no se necesita ningún comando o modo de fábrica independiente.

<a id="prepare"></a>
## preparar

- El flasheo normal restablece solo el motor seleccionado ID. Los motores con ID únicas pueden permanecer conectados; flashéelos secuencialmente mientras los demás se ejecutan normalmente. No power-cycle el autobús ni ejecute otro cargador durante una transferencia.
- Para **recuperación**, conecte solo el servo deseado. La recuperación no selecciona un motor mediante ID y no se abordan las transferencias del gestor de arranque.
- Asegure el mecanismo, use potencia de motor estable y cierre otros programas usando el puerto serie.
- Para un flasheo normal, desactive el par, bloquee las escrituras de configuración y borre cualquier alarma activa utilizando su herramienta de control habitual. Conozca el ID actual y la velocidad en baudios del servo.
- Realice una copia de seguridad de la calibración y la configuración importantes. Comience con la configuración guardada en el servo; Los cambios temporales pueden desaparecer después del reinicio.

Reemplace el puerto y ID con sus valores. La velocidad en baudios predeterminada es **1,000,000**; agregue `--baud 500000`, por ejemplo, si es necesario. Los puertos típicos son `/dev/cu.usbmodem…` en macOS, `/dev/ttyUSB0` en Linux y `COM3` en Windows.

```sh
python tools/flash/settings.py backup \
  --port /dev/cu.usbmodemYOUR_ADAPTER --id 2 \
  --file backups/servo-2-settings.json
```

Guarde esta copia de seguridad para este servo exacto. Los archivos de copia de seguridad existentes no se sobrescriben.

<a id="flash"></a>
## destello

Verifique y actualice una versión personalizada descargada:

```sh
python tools/flash/flash.py inspect \
  --manifest tools/flash/releases/release.json

python tools/flash/flash.py flash \
  --manifest tools/flash/releases/release.json \
  --port /dev/cu.usbmodemYOUR_ADAPTER --id 2
```

Para instalar el firmware de fábrica incluido, seleccione su manifiesto. Aísle el servo para esta operación: el arranque de fábrica puede cambiar su ID a 1, entrando en conflicto con otro motor del bus.

```sh
python tools/flash/flash.py flash \
  --manifest tools/flash/factory/release.json \
  --port /dev/cu.usbmodemYOUR_ADAPTER --id 2
```

`inspect` verifica el tamaño del archivo, la suma de verificación y el manifiesto sin conectarse a un servo. Escriba `FLASH` cuando se le solicite. Mantenga la alimentación conectada hasta que finalice el comando. La herramienta verifica el servo, guarda la instantánea de su configuración, carga el firmware, luego verifica la aplicación y compara la configuración. La verificación exitosa deja el torque desactivado.

Después de una actualización de fábrica, la herramienta verifica el ID/baud anterior, luego ID **1** a **1,000,000** baudios si es necesario, e imprime la conexión que funciona. El código de salida **2** significa que el firmware de fábrica respondió pero la configuración cambió. Continúe con la reparación de la configuración a continuación en lugar de volver a flashear.

<a id="recover-an-unresponsive-servo"></a>
## Recuperar un servo que no responde

Primero verifique la alimentación, el cableado, ID y la velocidad en baudios. Si es necesaria la recuperación, conecte **solo el servo deseado** y use el manifiesto seleccionado. Por ejemplo, para recuperar con firmware de fábrica:

```sh
python tools/flash/flash.py recover \
  --manifest tools/flash/factory/release.json \
  --port /dev/cu.usbmodemYOUR_ADAPTER --id 1
```

Después de la confirmación, **power-cycle el servo cuando se le solicite**, dejando el adaptador USB conectado. La herramienta espera hasta 60 segundos por el gestor de arranque.

Utilice el ID y la velocidad en baudios esperada después de la recuperación. La recuperación no puede verificar el modelo actual ni hacer una copia de seguridad de la configuración antes de cargar, así que confirme usted mismo la compatibilidad del hardware. Verifique los límites de calibración y posición antes de habilitar el torque posterior.

<a id="restore-factory-settings"></a>
## Restaurar la configuración de fábrica

Después de regresar al firmware de fábrica, restaure la copia de seguridad de este servo incluso si la configuración inicialmente parece correcta. El firmware de fábrica puede utilizar los valores predeterminados built-in cuando la configuración guardada no es válida; Es posible que las escrituras de registros normales no solucionen este problema.

Utilice el **actual** ID/baud impreso después del flasheo. Por ejemplo, si ahora responde como ID 1:

```sh
python tools/flash/settings.py restore \
  --port /dev/cu.usbmodemYOUR_ADAPTER --id 1 \
  --file backups/servo-2-settings.json
```

Escriba `RESTORE` para confirmar. Esto es compatible con **3.10** de fábrica y rechaza el firmware personalizado detectado. Restaura la configuración, **reemplaza la plantilla de reinicio guardada**, repara la configuración guardada, bloquea las escrituras y reinicia el servo. Sigue cualquier cambio ID/baud y verifica la lectura sin enviar comandos de movimiento.

Luego **power-cycle el servo** y verifica usando el **restaurado** ID/baud:

```sh
python tools/flash/settings.py verify \
  --port /dev/cu.usbmodemYOUR_ADAPTER --id 2 \
  --file backups/servo-2-settings.json
```

Mantenga el torque apagado hasta que pase la verificación. También puede proporcionar un flash normal `report.json` que contenga una instantánea before-flash como `--file`. Las copias de seguridad realizadas después de perder la configuración no pueden recuperar la calibración original. Sin una copia de seguridad válida, obtenga la configuración para el modelo exacto y recalibre este servo.

En caso de falla, la reparación intenta volver a bloquear la configuración, pero no deshace las escrituras parciales ni vuelve a intentar la reparación automáticamente. Conserve el informe antes de investigar.

<a id="results-and-options"></a>
## Resultados y opciones

Los informes flash se guardan en `backups/flash/`; informes de configuración en `backups/settings/`. Ambos incluyen instantáneas de configuraciones disponibles. Una carga exitosa incluye verificaciones de aplicaciones; no vuelve a leer la imagen completa del firmware. La configuración no se restaura automáticamente.

- `--output DIRECTORY`: elige dónde se guardan los informes.
- `--yes`: omitir el mensaje de confirmación; todas las comprobaciones aún se ejecutan.
- `--help`: muestra opciones de comando.

Si la validación del archivo falla, obtenga un par de versiones coincidentes. Si se interrumpe el flasheo, es posible que el servo necesite recuperación. Si la transferencia finaliza pero la verificación falla, inspeccione el informe y verifique ID, la velocidad en baudios y la configuración antes de volver a intentarlo.

Para los autores de versiones, [release.example.json](../../../../../tools/flash/release.example.json) muestra un manifiesto personalizado y [factory/release.json](../../../../../tools/flash/factory/release.json) un manifiesto de fábrica. El ejemplo personalizado no es una versión de firmware utilizable.

<a id="acknowledgments"></a>
## Agradecimientos

Las herramientas de flasheo y recuperación se inspiraron en [0o8o0-blip/sts3215-firmware](https://github.com/0o8o0-blip/sts3215-firmware/).
<!-- /translated-content -->
