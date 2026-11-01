<!-- translation-navigation -->
[English](../../../en/firmware/tests/README.md) · [Русский](../../../ru/firmware/tests/README.md) · [Español](../../../es/firmware/tests/README.md) · [Français](../../../fr/firmware/tests/README.md) · [Deutsch](../../../de/firmware/tests/README.md) · [Português (Brasil)](README.md) · [简体中文](../../../zh-CN/firmware/tests/README.md) · [日本語](../../../ja/firmware/tests/README.md) · [हिन्दी](../../../hi/firmware/tests/README.md) · [العربية](../../../ar/firmware/tests/README.md)

[Original em inglês](../../../../../firmware/tests/README.md)

> Tradução automática completa, ainda não revisada por um falante nativo. Imagens e vídeos são compartilhados; o texto neles permanece no idioma original.
<!-- /translation-navigation -->

<!-- translated-content -->
<a id="firmware-tests"></a>
# Testes de firmware

Execute `make verify` a partir da raiz do repositório após instalar o [conjunto de ferramentas de firmware](../README.md#build-and-verify). Ele constrói o firmware e executa testes C higienizados, verificações de contrato register/storage, verificações de limite de módulo e verificação de layout de imagem. Ele não se conecta ao hardware.

`fixtures/` contém entradas de regressão necessárias. Mantenha isso com os testes. `support/` fornece interfaces de hardware simuladas e acessórios de armazenamento.

Consulte [verificações de projeto](../../tools/README.md#offline-checks) para testes de host, atualização e visualizador, e o [conjunto de comparação de hardware](../../tools/hw-diff-tests/README.md) para verificações de comportamento factory/custom em um banco dedicado.
<!-- /translated-content -->
