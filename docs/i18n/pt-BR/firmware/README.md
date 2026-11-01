<!-- translation-navigation -->
[English](../../en/firmware/README.md) · [Русский](../../ru/firmware/README.md) · [Español](../../es/firmware/README.md) · [Français](../../fr/firmware/README.md) · [Deutsch](../../de/firmware/README.md) · [Português (Brasil)](README.md) · [简体中文](../../zh-CN/firmware/README.md) · [日本語](../../ja/firmware/README.md) · [हिन्दी](../../hi/firmware/README.md) · [العربية](../../ar/firmware/README.md)

[Original em inglês](../../../../firmware/README.md)

> Tradução automática completa, ainda não revisada por um falante nativo. Imagens e vídeos são compartilhados; o texto neles permanece no idioma original.
<!-- /translation-navigation -->

<!-- translated-content -->
<a id="firmware-sources"></a>
# Fontes de firmware

GD32F130 firmware, incluindo código de controle portátil, drivers de hardware e testes. O protocolo de extensão está documentado na [documentação detalhada](../DETAILED_DOCUMENTATION.md#extension-protocol).

| Diretório | Conteúdo |
| --- | --- |
| `app/` | Loop principal e coordenação entre componentes |
| `core/` | Controle, detecção, protocolo, registros e armazenamento |
| `include/` | Declarações C compartilhadas e tipos de dados |
| `platform/gd32f130/` | Drivers de hardware, código de inicialização, script de vinculador e cabeçalhos de fornecedores |
| [`tests/`](tests/README.md) | Testes de regressão C, verificações Python e acessórios necessários |

<a id="build-and-verify"></a>
## Construa e verifique

Da raiz do repositório:

```sh
make
make verify
```

Instale `arm-none-eabi-gcc`, um compilador host C com sanitizadores address/undefined-behavior, Python 3 e Make. Para um conjunto de ferramentas fora de PATH:

```sh
make verify ARM_PREFIX=/path/to/toolchain/bin/arm-none-eabi-
```

O Makefile raiz delega para este diretório. `make -C firmware` e `make -C firmware verify` também funcionam. Ambos gravam imagens de firmware em `build/motor-release/` e executáveis de teste nativos em `build/host/` na raiz do repositório. `make clean` remove o diretório `build/` gerado.

Esses comandos não atualizam o hardware. Use a [ferramenta flash](../tools/flash/README.md) com uma versão publisher-supplied. Bibliotecas hospedeiras e ferramentas command-line permanecem em [`host/`](../host/servo-driver/README.md) e [`tools/`](../tools/README.md).
<!-- /translated-content -->
