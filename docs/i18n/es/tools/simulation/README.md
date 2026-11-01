<!-- translation-navigation -->
[English](../../../en/tools/simulation/README.md) · [Русский](../../../ru/tools/simulation/README.md) · [Español](README.md) · [Français](../../../fr/tools/simulation/README.md) · [Deutsch](../../../de/tools/simulation/README.md) · [Português (Brasil)](../../../pt-BR/tools/simulation/README.md) · [简体中文](../../../zh-CN/tools/simulation/README.md) · [日本語](../../../ja/tools/simulation/README.md) · [हिन्दी](../../../hi/tools/simulation/README.md) · [العربية](../../../ar/tools/simulation/README.md)

[Original en inglés](../../../../../tools/simulation/README.md)

> Traducción automática completa, aún no revisada por un hablante nativo. Las imágenes y los vídeos son compartidos; su texto permanece en el idioma original.
<!-- /translation-navigation -->

<!-- translated-content -->
<a id="telemetry-viewer"></a>
# Visor de telemetría

Vea telemetría en vivo o reproduzca una grabación del controlador en MuJoCo. El espectador lee archivos de registro; nunca se conecta a motores ni envía comandos. Ambos modelos utilizan el mismo visor, gráficos y superposición de referencia. Muestra movimiento grabado; no predice la dinámica del motor ni los resultados de ajuste.

<a id="install"></a>
## Instalar

Desde la raíz del repositorio, usando Python 3.12:

```sh
python3.12 -m venv tools/simulation/.venv
tools/simulation/.venv/bin/python -m pip install -r tools/simulation/requirements.txt
```

<a id="live-and-recorded-playback"></a>
## Reproducción en vivo y grabada

Inicie una vez para ver la sesión más reciente y cambie automáticamente cuando otra ejecución de repetición o teleoperación cree un registro:

```sh
mkdir -p logs/motion
tools/simulation/.venv/bin/python tools/simulation/viewer.py live logs/motion --model so101
```

El directorio debe existir. Un directorio vacío espera su primer registro. Las preferencias de ventana, cámara y pantalla permanecen sin cambios entre ejecuciones; Los gráficos se reinician para cada nueva sesión. Inicie la reproducción de hardware por separado en otro terminal.

Para seguir un registro en particular o reproducir un registro guardado desde el principio:

```sh
tools/simulation/.venv/bin/python tools/simulation/viewer.py live /path/to/events.ndjson --model so101

tools/simulation/.venv/bin/python tools/simulation/viewer.py play /path/to/events.ndjson --model so101
```

El comando selecciona automáticamente el iniciador de ventanas nativo en macOS, incluidas las rutas del repositorio que contienen espacios. Seleccione `--model so102` para SO-102; este también es el valor predeterminado cuando se omite. Los modelos y mallas están incluidos, por lo que su visualización no requiere ningún paso de descarga ni importación.

Para obtener una vista previa PNG, use Python normal en todas las plataformas:

```sh
tools/simulation/.venv/bin/python tools/simulation/viewer.py play /path/to/events.ndjson --model so101 --render preview.png
```

El visor acepta registros de eventos del controlador, no archivos pose JSON con nombre. Envíe archivos de pose a través de [reproducción de hardware](../poses/README.md#replay-poses) y luego vea el registro resultante. La reproducción conserva el tiempo de grabación y retiene el fotograma final. La pantalla en vivo se actualiza solo después de un pase completo de retroalimentación del motor. Las mediciones retrasadas se etiquetan como obsoletas; Los comandos por sí solos no pueden actualizarlos. Se debe volver a abrir un registro reemplazado o truncado. Al cerrar el visor, se ejecuta el control del hardware.

<a id="models-and-calibration"></a>
## Modelos y calibración

| modelo | Fuente | Mostrar mapeo |
| --- | --- | --- |
| `so101` | [Oficial SO-101 seguidor](urdf/so101/README.md), Apache 2.0 | Los seis motores, incluido el giro de muñeca y la mandíbula de agarre giratoria. |
| `so102` | [SO-ARM-102](urdf/README.md), CC BY 4.0 | Mapeo M1–M4 calibrado existente; El rodillo de muñeca y las mandíbulas permanecen fijos. |

SO-101 usa el `so101_new_calib.urdf` ascendente. Su mapa predeterminado asume un ensamblaje estándar y cada URDF junta cero en el conteo del codificador 2048. Los recuentos positivos aumentan cada ángulo de URDF articulación en 2π/4096 radianes por recuento. Esta convención debe coincidir con la postura de referencia de su brazo y las direcciones de sus articulaciones; la pantalla lo etiqueta como **pose de referencia asumida**, no como alineación hardware-verified. La pinza utiliza el ángulo del codificador directamente, no la apertura 0–100 normalizada de LeRobot. Su cero URDF debe coincidir con el ángulo de la mandíbula en su referencia de calibración; no se deduce de los límites de viaje guardados.

SO-102 mantiene sus controles encoder-calibration existentes y su acoplamiento de mandíbula fija. Cambiar el modelo no cambia el controlador de hardware ni su modelo de gravedad.

<a id="match-the-calibration-reference"></a>
### Coincidir con la referencia de calibración

La [herramienta de calibración](../settings/README.md#choose-the-reference-pose) establece 2048 en la pose que capturas. El espectador convierte por separado esos recuentos en ángulos:

```text
angle = referenceRadians + (counts − referenceCount) × radiansPerCount
```

| Mapa incluido | Ángulos de las articulaciones mostrados cuando los recuentos son 2048 |
| --- | --- |
| SO-101 | 0° para las seis URDF articulaciones; Esta es una suposición, no una pose física detectada. |
| SO-102 | M1 0°, M2 −3°, M3 1°, M4 1°; M5 y las mandíbulas usan posiciones de visualización fijas. |

Una postura de calibración mid-travel, incluida la que se muestra en la guía de LeRobot, no establece por sí sola que cada ángulo URDF sea cero. En su referencia capturada, establezca el `referenceRadians` de cada entrada del mapa en el ángulo de esa articulación en el URDF. Verifique un pequeño movimiento de la mano para confirmar el signo de `radiansPerCount`, incluido el giro de la muñeca y la pinza. Comprueba también una segunda pose; Hacer coincidir una pose no puede confirmar la dirección o la escala. La herramienta no deriva estos ángulos de los recuentos mínimo y máximo.

El mapa predeterminado de SO-101 no tiene un enlace de desplazamiento exacto. El mapa de SO-102 está vinculado a las compensaciones guardadas del brazo original. Después de la recalibración, actualice el mapeo de ángulos físicos así como sus campos de calibración; cambiar solo esos campos omite la verificación sin corregir la visualización. Los informes de calibración no se importan automáticamente. La superposición cian muestra la pose planificada del firmware o el destino con retroalimentación compacta; está separada de la postura de calibración.

Para ajustar o vincular un mapa a un brazo en particular, copie `so101-encoder-map.json` o `encoder-angle-map.json`, edítelo y pase `--mapping YOUR_MAP.json` con cualquiera de los comandos. Los mapas de la versión 2 contienen:

- `model`: debe coincidir con el modelo seleccionado.
- `joints`: ID de motor asignados a URDF nombres conjuntos, `referenceCount`, `referenceRadians` y firmados `radiansPerCount`.
- `fixedJoints`: posiciones de las juntas del modelo sin mapeo medido, en radianes para juntas de revolución o en metros para juntas deslizantes.
- `encoderCalibration`: configuraciones exactas opcionales per-motor `positionCorrection`, `resolution` y `reverse`, verificadas con la verificación previa de grabación.

Cada articulación del modelo debe mapearse o fijarse explícitamente. Los conteos en el registro ya incluyen la corrección de la posición del servo; no lo restes nuevamente. Se requiere resolución del codificador unitario. Un codificador invertido requiere una entrada de calibración explícita y un mapeo de ángulo con signo coincidente. Para mapas personalizados hechos con el formato anterior, copie la versión 2 del mapa y transfiera sus ángulos y direcciones de referencia.

<a id="display"></a>
## Pantalla

Ambos modelos tienen un fondo neutro y un plano de rejilla translúcido en la base. La cuadrícula es una referencia visual, sin respuesta a la colisión; Las poses debajo de él permanecen visibles. La reproducción mantiene su fotograma final y no se repite ni se reinicia. El modo en vivo con un archivo sigue ese archivo únicamente. Con un directorio, sigue los nuevos archivos `.ndjson` en ese directorio, sin buscar subdirectorios ni retroceder cuando se actualiza un registro anterior.

`1`–`6` seleccione un motor; `G` alterna la superposición de referencia; `C` gráficos; `J` marcadores articulares; `M`/`R` measured/reference pose; `F` calidad de renderizado; `H` ayuda. La junta seleccionada lleva la etiqueta de error. Se muestran lecturas faltantes `--`.

La retroalimentación compacta C1 tiene posiciones medidas pero no tiene referencia del planificador; su comparación utiliza el destino ordenado. Los comentarios detallados C2 proporcionan la referencia del planificador. El error de destino durante el movimiento no es un error de seguimiento. Los nuevos registros de reproducción utilizan comentarios detallados: la sombra cian sigue las posiciones intermedias planificadas del firmware. Los registros compact-feedback más antiguos todavía muestran saltos entre destinos; el espectador no puede recuperar las referencias intermedias faltantes. Los gráficos retienen hasta 20 segundos y no fabrican nuevas marcas de tiempo de medición.

El espectador reproduce la geometría con los contactos y la gravedad desactivados. No simula la dinámica del motor ni predice la sintonización PID. Las posiciones de las articulaciones se muestran sin sujeción a los límites nominales CAD.

<a id="tests"></a>
## Pruebas

```sh
PYTHONPATH=tools/simulation tools/simulation/.venv/bin/python -m unittest discover -s tools/simulation/test -v
```
<!-- /translated-content -->
