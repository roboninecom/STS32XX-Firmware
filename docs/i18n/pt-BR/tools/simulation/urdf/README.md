<!-- translation-navigation -->
[English](../../../../en/tools/simulation/urdf/README.md) · [Русский](../../../../ru/tools/simulation/urdf/README.md) · [Español](../../../../es/tools/simulation/urdf/README.md) · [Français](../../../../fr/tools/simulation/urdf/README.md) · [Deutsch](../../../../de/tools/simulation/urdf/README.md) · [Português (Brasil)](README.md) · [简体中文](../../../../zh-CN/tools/simulation/urdf/README.md) · [日本語](../../../../ja/tools/simulation/urdf/README.md) · [हिन्दी](../../../../hi/tools/simulation/urdf/README.md) · [العربية](../../../../ar/tools/simulation/urdf/README.md)

[Original em inglês](../../../../../../tools/simulation/urdf/README.md)

> Tradução automática completa, ainda não revisada por um falante nativo. Imagens e vídeos são compartilhados; o texto neles permanece no idioma original.
<!-- /translation-navigation -->

<!-- translated-content -->
<a id="so-arm-102-model"></a>
# Modelo SO-ARM 102

URDF e oito malhas STL de [SO-ARM-102](https://github.com/roboninecom/SO-ARM-102/tree/0f0dd95526638042a3213598ee0ae7f167c40efe/simulation/urdf) de Robinine, commit `0f0dd95526638042a3213598ee0ae7f167c40efe`. Os arquivos são copiados inalterados. `source.json` registra suas somas de verificação. Os andaimes do pacote Xacro e ROS não são necessários para carregar o URDF independente.

Direitos autorais (c) 2026 Robonine. Atribuição: Robonine, SO-ARM 102, https://github.com/roboninecom/SO-ARM-102, CC BY 4.0. Consulte [LICENSE.txt](../../../../../../tools/simulation/urdf/LICENSE.txt) e o upstream [mapa de licença](https://github.com/roboninecom/SO-ARM-102/blob/0f0dd95526638042a3213598ee0ae7f167c40efe/LICENSING.md).

<a id="model-assumptions"></a>
## Suposições do modelo

A estimativa de massa a montante é **0.889 kg**. Assume PLA impressão e 70 g por servo. Consulte o upstream [configurações de exportação](https://github.com/roboninecom/SO-ARM-102/blob/0f0dd95526638042a3213598ee0ae7f167c40efe/simulation/urdf/export_settings.json) e [propriedades de massa](https://github.com/roboninecom/SO-ARM-102/blob/0f0dd95526638042a3213598ee0ae7f167c40efe/simulation/urdf/mass_properties.json). Estas são estimativas; o modelo de gravidade de hardware medido permanece separado.

URDF zero é a pose CAD exportada. O [mapa do codificador](../../../../../../tools/simulation/encoder-angle-map.json) define ângulos M1–M4 na contagem 2048 a 0°, −3°, 1° e 1°, respectivamente. M5 e a calibração da garra permanecem sem verificação. O display de mandíbula fixa usa +0.016 m e −0.016 m, combinando com o acoplamento opposite-sign do URDF.

A fonte mantém suas caixas de colisão. A preparação do modelo os omite da visualização gerada porque essas ferramentas desativam a simulação de contato. Preserva visuais, inerciais e acoplamento de juntas. Os resultados da simulação não calibram a dinâmica real do motor nem estabelecem ganhos de ajuste de hardware.
<!-- /translated-content -->
