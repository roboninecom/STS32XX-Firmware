<!-- translation-navigation -->
[English](../../en/tools/README.md) · [Русский](../../ru/tools/README.md) · [Español](README.md) · [Français](../../fr/tools/README.md) · [Deutsch](../../de/tools/README.md) · [Português (Brasil)](../../pt-BR/tools/README.md) · [简体中文](../../zh-CN/tools/README.md) · [日本語](../../ja/tools/README.md) · [हिन्दी](../../hi/tools/README.md) · [العربية](../../ar/tools/README.md)

[Original en inglés](../../../../tools/README.md)

> Traducción automática completa, aún no revisada por un hablante nativo. Las imágenes y los vídeos son compartidos; su texto permanece en el idioma original.
<!-- /translation-navigation -->

<!-- translated-content -->
<a id="tools"></a>
# Herramientas

Utilidades para trabajar con servos STS. Cada guía incluye instrucciones de configuración, comandos y requisitos de hardware. Para el desarrollo de aplicaciones, utilice el [servocontrolador Node.js](../host/servo-driver/README.md), disponible como un paquete npm independiente creado a partir de este repositorio. La repetición y la teleoperación comparten el [controlador de brazo y modelo de gravedad](../host/arm-control/README.md).

Para un nuevo mecanismo: [calibrar compensaciones y límites](settings/README.md#choose-the-reference-pose), registrar poses, luego ajustar y validar la compensación. Mantenga la calibración verificada al reutilizar posturas y modelos de gravedad existentes.

| Herramienta | Propósito |
| --- | --- |
| [Sintonización automática](tuning/README.md) | Compare lotes limitados de configuraciones con movimientos repetidos y retenciones de validación más prolongadas. |
| [Visor de telemetría](simulation/README.md) | Vea telemetría en vivo y reproduzca grabaciones con los modelos SO-101 y SO-102 incluidos; sin acceso a autobús. |
| [Teleoperación](teleoperation/README.md) | Controlar a un seguidor desde un líder hand-operated. |
| [Grabación y reproducción](poses/README.md) | Grabar poses nombradas; reproduzca con configuraciones heredadas o de extensión, o reproduzca una sesión de teleoperación grabada. |
| [Descubrimiento, calibración y configuración](settings/README.md) | Encuentre motores, calibre compensaciones y límites de juntas y realice copias de seguridad o restaure configuraciones persistentes. |
| [Pruebas de comparación de hardware](hw-diff-tests/README.md) | Compare el comportamiento del firmware personalizado y de fábrica en un banco de servo dedicado. |
| [Parámetro de bus y telemetría](diagnostics/README.md) | Mida la latencia de comunicación y verifique las lecturas estacionarias para detectar valores inusuales. |
| [Actualización y recuperación de firmware](flash/README.md) | Actualice firmware de fábrica personalizado o incluido, recupere cargas interrumpidas y repare la configuración de fábrica. |

Las herramientas de Node.js requieren Node.js 20 o posterior. El flasheo y la recuperación de la configuración requieren Python 3.10 o más reciente. La simulación utiliza Python 3.12. Ejecute comandos desde la raíz del repositorio y siga la guía correspondiente antes de conectar el hardware: las pruebas de comparación pueden mover motores y sobrescribir configuraciones, y el flasheo puede dañar un servo.

<a id="offline-checks"></a>
## Cheques sin conexión

Ejecutar desde la raíz del repositorio. Primero instale las dependencias de Node y los requisitos de cada herramienta de Python. Ninguno de estos comandos abre un puerto serie ni mueve hardware.

| Comando | Cobertura |
| --- | --- |
| `make verify` | Construcción de firmware, pruebas de regresión C, contratos register/storage y diseño de imágenes. Consulte [configuración de la cadena de herramientas](../firmware/README.md). |
| `npm test` | Controlador, controlador compartido y todas las herramientas de Node.js. |
| `npm run test:driver-package` | Empaquetado de controladores e instalación aislada utilizando dependencias npm almacenadas en caché. |
| `make flash-verify PYTHON=tools/flash/.venv/bin/python` | Flasheo y recuperación de valores de fábrica con dispositivos seriales simulados. |
| `PYTHONPATH=tools/simulation tools/simulation/.venv/bin/python -m unittest discover -s tools/simulation/test` | Modelos, registros de lectores y comportamiento de espectadores. |

La comparación de hardware utiliza el [conjunto de banco dedicado](hw-diff-tests/README.md); puede reemplazar configuraciones y restablecer plantillas. Utilice [diagnóstico](diagnostics/README.md) para comunicación y telemetría estacionaria en un mecanismo ensamblado.
<!-- /translated-content -->
