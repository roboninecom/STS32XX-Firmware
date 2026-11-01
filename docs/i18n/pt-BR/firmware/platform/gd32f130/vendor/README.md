<!-- translation-navigation -->
[English](../../../../../en/firmware/platform/gd32f130/vendor/README.md) · [Русский](../../../../../ru/firmware/platform/gd32f130/vendor/README.md) · [Español](../../../../../es/firmware/platform/gd32f130/vendor/README.md) · [Français](../../../../../fr/firmware/platform/gd32f130/vendor/README.md) · [Deutsch](../../../../../de/firmware/platform/gd32f130/vendor/README.md) · [Português (Brasil)](README.md) · [简体中文](../../../../../zh-CN/firmware/platform/gd32f130/vendor/README.md) · [日本語](../../../../../ja/firmware/platform/gd32f130/vendor/README.md) · [हिन्दी](../../../../../hi/firmware/platform/gd32f130/vendor/README.md) · [العربية](../../../../../ar/firmware/platform/gd32f130/vendor/README.md)

[Original em inglês](../../../../../../../firmware/platform/gd32f130/vendor/README.md)

> Tradução automática completa, ainda não revisada por um falante nativo. Imagens e vídeos são compartilhados; o texto neles permanece no idioma original.
<!-- /translation-navigation -->

<!-- translated-content -->
<a id="pinned-gd32f1x0-declarations"></a>
# Declarações GD32F1x0 fixadas

Fonte: comunidade `sts3215-firmware/firmware/lib` na revisão do repositório `24ba15ba80bfe8213684c6bb4523a7d7ee079998`. Os cabeçalhos GD32 device/SPL identificam GigaDevice V3.3.0 (2020-09-21). O cabeçalho principal CMSIS identifica ARM V3.30. `SHA256SUMS` registra os bytes exatos de cada cabeçalho copiado. Nenhuma implementação C do fornecedor ou fonte de inicialização do sistema está incluída.

O fechamento da dependência contém cabeçalhos 18: 5 CMSIS e 13 SPL. O cabeçalho do dispositivo inclui `gd32f1x0_libopt.h`; esse agregador local faz referência a todos os cabeçalhos periféricos. Todos os cabeçalhos vendor/CMSIS selecionados, exceto o agregador, contêm seus próprios direitos autorais upstream, condições de redistribuição e isenção de responsabilidade. O agregador não possui nenhum aviso incorporado; a licença MIT do repositório de origem está incluída como `COMMUNITY_LICENSE`. Os avisos upstream permanecem inalterados em cada arquivo e devem acompanhar as distribuições fonte e binária. Inclua este diretório ou reproduza esses avisos em materiais de distribuição ao enviar um binário.

Somente compilações de destino adicionam esses caminhos de inclusão. `mcu.h` seleciona `GD32F130_150`. Nenhum aplicativo, núcleo ou interface pública deve incluir este cabeçalho de dispositivo. Não substitua a inicialização do relógio, o layout vetorial ou o contrato do vinculador do projeto pelo código de implementação do fornecedor como parte de uma migração declaration-only.
<!-- /translated-content -->
