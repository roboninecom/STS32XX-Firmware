<!-- translation-navigation -->
[English](../../../../en/tools/settings/images/README.md) · [Русский](../../../../ru/tools/settings/images/README.md) · [Español](../../../../es/tools/settings/images/README.md) · [Français](../../../../fr/tools/settings/images/README.md) · [Deutsch](../../../../de/tools/settings/images/README.md) · [Português (Brasil)](README.md) · [简体中文](../../../../zh-CN/tools/settings/images/README.md) · [日本語](../../../../ja/tools/settings/images/README.md) · [हिन्दी](../../../../hi/tools/settings/images/README.md) · [العربية](../../../../ar/tools/settings/images/README.md)

[Original em inglês](../../../../../../tools/settings/images/README.md)

> Tradução automática completa, ainda não revisada por um falante nativo. Imagens e vídeos são compartilhados; o texto neles permanece no idioma original.
<!-- /translation-navigation -->

<!-- translated-content -->
<a id="calibration-illustrations"></a>
# Ilustrações de calibração

Vistas laterais e superiores renderizadas a partir dos modelos de robôs incluídos, com etiquetas de juntas e instruções de posicionamento adicionadas. Estes são guias para uma **nova calibração manual**, não fotografias ou medidas dos braços afinados.

- `so101-reference-pose.png`: Geometria SO-101 do Robot Studio, distribuída em Apache-2.0. [Fonte fixada e licença](../../simulation/urdf/so101/README.md).
- `so102-reference-pose.png`: Geometria SO-ARM-102 de Robonine, CC BY 4.0. [Fonte fixada e licença](../../simulation/urdf/README.md). Esta ilustração é uma adaptação da pose, câmera, fundo e rótulos definidos para este guia; também está disponível em CC BY 4.0.

<a id="poses-used-in-the-images"></a>
## Poses usadas nas imagens

M1–M4 use os mapeamentos do visualizador agrupado na contagem 2048. As posições do rolo do pulso e da pinça são definidas separadamente nos pontos médios dos limites de deslocamento do modelo. As paradas físicas no mecanismo real determinam esses pontos médios durante a colocação manual.

| Modelo | M1–M4 ângulos articulares | Rolo de pulso | Garra |
| --- | --- | --- | --- |
| SO-101 | 0°, 0°, 0°, 0° | 2.789° | Mandíbula móvel 45° |
| SO-102 | 0°, −3°, 1°, 1° | −1° | Posições da mandíbula deslizante +0.02075 m e −0.02075 m |

Os ângulos são relativos a cada estrutura de junta URDF, e não aos ângulos medidos em relação à mesa. Essas posições wrist/gripper diferem dos mapas do visualizador padrão; nem os mapas nem os modelos de gravidade publicados foram alterados para essas imagens. Para corresponder a uma nova calibração, atualize os ângulos de referência do visualizador e a ligação de calibração conforme descrito no [guia do visualizador](../../simulation/README.md#match-the-calibration-reference).
<!-- /translated-content -->
