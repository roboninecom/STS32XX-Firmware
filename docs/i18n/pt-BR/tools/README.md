<!-- translation-navigation -->
[English](../../en/tools/README.md) · [Русский](../../ru/tools/README.md) · [Español](../../es/tools/README.md) · [Français](../../fr/tools/README.md) · [Deutsch](../../de/tools/README.md) · [Português (Brasil)](README.md) · [简体中文](../../zh-CN/tools/README.md) · [日本語](../../ja/tools/README.md) · [हिन्दी](../../hi/tools/README.md) · [العربية](../../ar/tools/README.md)

[Original em inglês](../../../../tools/README.md)

> Tradução automática completa, ainda não revisada por um falante nativo. Imagens e vídeos são compartilhados; o texto neles permanece no idioma original.
<!-- /translation-navigation -->

<!-- translated-content -->
<a id="tools"></a>
# Ferramentas

Utilitários para trabalhar com servos STS. Cada guia inclui instruções de configuração, comandos e requisitos de hardware. Para desenvolvimento de aplicativos, use o [servo driver Node.js](../host/servo-driver/README.md), disponível como um pacote npm independente criado a partir deste repositório. A repetição e a teleoperação compartilham o [controlador de braço e modelo de gravidade](../host/arm-control/README.md).

Para um novo mecanismo: [calibrar compensações e limites](settings/README.md#choose-the-reference-pose), registrar poses, depois ajustar e validar a compensação. Mantenha a calibração verificada ao reutilizar poses e modelos de gravidade existentes.

| Ferramenta | Objetivo |
| --- | --- |
| [Ajuste automatizado](tuning/README.md) | Compare lotes limitados de configurações com movimentos repetidos e retenções de validação mais longas. |
| [Visualizador de telemetria](simulation/README.md) | Visualize telemetria ao vivo e reproduza gravações com modelos SO-101 e SO-102 incluídos; sem acesso de ônibus. |
| [Teleoperação](teleoperation/README.md) | Controle um seguidor de um líder hand-operated. |
| [Gravação e reprodução](poses/README.md) | Grave poses nomeadas; reproduza com configurações herdadas ou de extensão ou reproduza uma sessão de teleoperação gravada. |
| [Descoberta, calibração e configurações](settings/README.md) | Encontre motores, calibre deslocamentos e limites de juntas e faça backup ou restaure configurações persistentes. |
| [Testes de comparação de hardware](hw-diff-tests/README.md) | Compare o comportamento do firmware de fábrica e personalizado em uma bancada de servo dedicada. |
| [Benchmark de ônibus e telemetria](diagnostics/README.md) | Meça a latência de comunicação e verifique as leituras estacionárias em busca de valores incomuns. |
| [Flash de firmware e recuperação](flash/README.md) | Atualize o firmware de fábrica personalizado ou incluído, recupere uploads interrompidos e repare as configurações de fábrica. |

As ferramentas Node.js requerem Node.js 20 ou mais recente. A atualização e a recuperação de configurações requerem Python 3.10 ou mais recente. A simulação usa Python 3.12. Execute comandos da raiz do repositório e siga o guia relevante antes de conectar o hardware: testes de comparação podem mover motores e sobrescrever configurações, e gravar o firmware pode danificar um servo.

<a id="offline-checks"></a>
## Verificações off-line

Execute a partir da raiz do repositório. Instale primeiro as dependências do Node e os requisitos de cada ferramenta Python. Nenhum desses comandos abre uma porta serial ou move hardware.

| Comando | Cobertura |
| --- | --- |
| `make verify` | Construção de firmware, testes de regressão C, contratos register/storage e layout de imagens. Consulte [configuração do conjunto de ferramentas](../firmware/README.md). |
| `npm test` | Driver, controlador compartilhado e todas as ferramentas Node.js. |
| `npm run test:driver-package` | Pacote de driver e instalação isolada usando dependências npm em cache. |
| `make flash-verify PYTHON=tools/flash/.venv/bin/python` | Flashing e recuperação de configurações de fábrica com dispositivos seriais simulados. |
| `PYTHONPATH=tools/simulation tools/simulation/.venv/bin/python -m unittest discover -s tools/simulation/test` | Modelos, gravação de leitores e comportamento do espectador. |

A comparação de hardware usa o [conjunto de bancada dedicado](hw-diff-tests/README.md); ele pode substituir configurações e redefinir modelos. Use [diagnostics](diagnostics/README.md) para comunicação e telemetria estacionária em um mecanismo montado.
<!-- /translated-content -->
