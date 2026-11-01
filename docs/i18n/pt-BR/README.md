<!-- translation-navigation -->
[English](../en/README.md) · [Русский](../ru/README.md) · [Español](../es/README.md) · [Français](../fr/README.md) · [Deutsch](../de/README.md) · [Português (Brasil)](README.md) · [简体中文](../zh-CN/README.md) · [日本語](../ja/README.md) · [हिन्दी](../hi/README.md) · [العربية](../ar/README.md)

[Original em inglês](../../../README.md)

> Tradução automática completa, ainda não revisada por um falante nativo. Imagens e vídeos são compartilhados; o texto neles permanece no idioma original.
<!-- /translation-navigation -->

<!-- translated-content -->
<a id="sts32xx-firmware"></a>
# STS32XXFirmware

Firmware para servos GD32F130-based STS3215. Os comandos padrão STS estão disponíveis no modo legado; o modo de extensão adiciona movimento suave planejado localmente, controle de posição configurável, avanço de velocidade e compensação de gravidade host-calculated.

Comece com o guia **[Início rápido](QUICKSTART.md)** ou leia a [documentação detalhada](DETAILED_DOCUMENTATION.md) para detalhes de configuração e protocolo.

[![Visão geral: testes SO-101 e SO-102 before-and-after gravados](../../../assets/readme/posters/overview.jpg)](https://youtu.be/AsxFs24vXQs)

[Assistir no YouTube](https://youtu.be/AsxFs24vXQs) | [MP4](../../../assets/readme/videos/overview.mp4)

Os valores aproximados descrevem as demonstrações gravadas, sem precisão garantida em todo o espaço de trabalho.

Selecione uma imagem de vídeo ou o link do YouTube abaixo dela para assistir ao clipe silencioso. Todos os vídeos de documentação estão disponíveis por link (Não listado); MP4 cópias também são fornecidas.

- [Por que construímos isso](#why-we-built-it)
- [O que muda no controle](#what-changes-in-control)
- [Resultados em SO-101 / SO-102](#results-on-so-101--so-102)
- [Robôs e links](#robots-and-links)
- [Início rápido](#quick-start)
- [Documentação detalhada](#detailed-documentation)

<a id="why-we-built-it"></a>
## Por que construímos

Um braço robótico pode retornar consistentemente ao mesmo ponto e ainda assim errar o alvo comandado. **Repetibilidade** descreve essa consistência; **precisão de posicionamento absoluta** descreve o quão perto o braço chega do alvo.

**Retornos repetidos medidos com um indicador**

[![Retornos repetidos medidos com um indicador](../../../assets/readme/posters/repeatability.jpg)](https://youtu.be/_VN10zWybBU)

[Assistir no YouTube](https://youtu.be/_VN10zWybBU) | [MP4](../../../assets/readme/videos/repeatability.mp4)

**Repetibilidade versus precisão de posicionamento absoluta**

[![Explicação conceitual de repetibilidade e precisão de posicionamento absoluta](../../../assets/readme/posters/repeatability-vs-accuracy.jpg)](https://youtu.be/L5FINW5FATI)

[Assistir no YouTube](https://youtu.be/L5FINW5FATI) | [MP4](../../../assets/readme/videos/repeatability-vs-accuracy.mp4)

Tentamos reduzir o erro de posicionamento ajustando PID no firmware padrão. Em alguns cenários de teste, as configurações que reduziram o erro também causaram oscilação. Desenvolvemos firmware personalizado para nos dar mais controle sobre o planejamento de movimento e controle de posição.

[![Firmware de estoque: oscilação durante PID ajuste](../../../assets/readme/posters/stock-pid-oscillation.jpg)](https://youtu.be/wIBd3jnOwRk)

[Assistir no YouTube](https://youtu.be/wIBd3jnOwRk) | [MP4](../../../assets/readme/videos/stock-pid-oscillation.mp4)

<a id="what-changes-in-control"></a>
## O que muda no controle

O host envia alvos e configurações; cada servo planeja e controla seu próprio movimento.

1. O host envia alvos e configurações e calcula a compensação de gravidade quando configurado.
2. Cada servo planeja seu próprio movimento S-curve.
3. O controle local PID e feedforward ajustam a saída do motor usando a posição medida e a velocidade estimada.

[Assista à visão geral gravada no YouTube](https://youtu.be/AsxFs24vXQs) | [MP4](../../../assets/readme/videos/overview.mp4)

<a id="s-curve-motion"></a>
### S-curve movimento

Torna a aceleração e a travagem mais graduais. A curva ilustra a aceleração ao longo do tempo.

[![Ilustração conceitual de s-curve movimento](../../../assets/readme/illustrations/s-curve.png)](https://youtu.be/92mDt4rbobY)

[Assistir no YouTube](https://youtu.be/92mDt4rbobY) | [MP4](../../../assets/readme/videos/s-curve.mp4)

[Configuração e limitações](DETAILED_DOCUMENTATION.md#s-curve-motion).

<a id="pid-control"></a>
### PID controle

Ajusta como o servo corrige o erro de posição. A curva cinza ilustra a oscilação; a curva branca ilustra uma resposta mais amortecida. A linha tracejada é o alvo.

[![Ilustração conceitual do controle pid](../../../assets/readme/illustrations/pid-tuning.png)](https://youtu.be/TEpvaAMlfrg)

[Assistir no YouTube](https://youtu.be/TEpvaAMlfrg) | [MP4](../../../assets/readme/videos/pid-tuning.mp4)

[Configuração e limitações](DETAILED_DOCUMENTATION.md#pid-controller).

<a id="velocity-feedforward"></a>
### Velocidade feedforward

Adiciona a saída do motor com base na velocidade planejada, calculada dentro do servo. Ambas as curvas progridem da esquerda para a direita ao longo do tempo.

[![Ilustração conceitual de feedforward de velocidade](../../../assets/readme/illustrations/velocity-feedforward.png)](https://youtu.be/osGGs-nhk9I)

[Assistir no YouTube](https://youtu.be/osGGs-nhk9I) | [MP4](../../../assets/readme/videos/velocity-feedforward.mp4)

[Configuração e limitações](DETAILED_DOCUMENTATION.md#velocity-feedforward).

<a id="gravity-compensation"></a>
### Compensação de gravidade

O host calcula a contribuição e o servo a aplica. A seta para baixo representa o peso; a seta para cima representa suporte.

[![Ilustração conceitual da compensação de gravidade](../../../assets/readme/illustrations/gravity-compensation.png)](https://youtu.be/25sc41PTDIA)

[Assistir no YouTube](https://youtu.be/25sc41PTDIA) | [MP4](../../../assets/readme/videos/gravity-compensation.mp4)

[Configuração e limitações](DETAILED_DOCUMENTATION.md#gravity-compensation).

Esses gráficos e animações explicativos são gráficos conceituais e não medidos de hardware. Consulte a [documentação detalhada](DETAILED_DOCUMENTATION.md) para configurações, detalhes do protocolo e limitações. Os clientes de extensão devem suportar o **protocolo v9.0**; as configurações de extensão são temporárias e devem ser enviadas novamente após uma redefinição ou ciclo de energia.

<a id="results-on-so-101--so-102"></a>
## Resultados em SO-101 / SO-102

Os clipes abaixo mostram testes before-and-after gravados em SO-101 e SO-102. Cada comparação mostra primeiro o comportamento original, seguido pela configuração custom-firmware.

**SO-101: antes, depois**

[![SO-101 registrado before-and-after comparação](../../../assets/readme/posters/so101-before-after.jpg)](https://youtu.be/ZdLlv8q73gE)

[Assistir no YouTube](https://youtu.be/ZdLlv8q73gE) | [MP4](../../../assets/readme/videos/so101-before-after.mp4)

**SO-102: antes, depois**

[![SO-102 registrado before-and-after comparação](../../../assets/readme/posters/so102-before-after.jpg)](https://youtu.be/0rmO15pFqJ4)

[Assistir no YouTube](https://youtu.be/0rmO15pFqJ4) | [MP4](../../../assets/readme/videos/so102-before-after.mp4)

Os valores aproximados mostrados descrevem essas demonstrações, sem garantia de precisão em toda a área de trabalho do braço. Repetibilidade, precisão absoluta de posicionamento e deflexão mecânica são medidas diferentes.

<a id="complete-coordinated-movement"></a>
### Movimento coordenado completo

[![Registro completo SO-101 movimento](../../../assets/readme/posters/coordinated-motion.jpg)](https://youtu.be/dCtcS5aAko0)

[Assistir no YouTube](https://youtu.be/dCtcS5aAko0) | [MP4](../../../assets/readme/videos/coordinated-motion.mp4)

Este clipe preserva todo o movimento gravado. Cada servo planeja localmente; enviar alvos juntos não garante por si só a chegada simultânea.

<a id="mechanical-limitations"></a>
### Limitações mecânicas

[![Folga da caixa de câmbio e flexão da estrutura](../../../assets/readme/posters/mechanical-limits.jpg)](https://youtu.be/53l7at5aE6k)

[Assistir no YouTube](https://youtu.be/53l7at5aE6k) | [MP4](../../../assets/readme/videos/mechanical-limits.mp4)

A folga da caixa de câmbio e a flexão do quadro ainda afetam a posição final do braço. O ajuste do controlador não remove essas limitações mecânicas. Valide as configurações do mecanismo e carga reais; veja [limites atuais](DETAILED_DOCUMENTATION.md#current-limits).

<a id="robots-and-links"></a>
## Robôs e links

Interessado em construir uma configuração semelhante? Explore os kits SO-ARM101 e SO-ARM102 da Robonine. O conteúdo do kit está documentado nas páginas do produto.

| SO-ARM101 | SO-ARM102 |
| --- | --- |
| ![SO-ARM101 kit robô](../../../assets/readme/illustrations/hardware-so101.jpg) | ![SO-ARM102 kit robô](../../../assets/readme/illustrations/hardware-so102.jpg) |
| [Compre o kit SO-ARM101 da Robonine](https://robonine.com/ru/shop/so-arm101-black-white-robotic-arm-kit/) | [Compre o kit SO-ARM102 da Robonine](https://robonine.com/ru/shop/so-arm102-robotic-arm-kit/) |

[Explore o hardware SO-ARM102, CAD e BOM](https://github.com/roboninecom/SO-ARM102).

<a id="quick-start"></a>
## Início rápido

Siga o **[Guia de início rápido existente](QUICKSTART.md)** para os pré-requisitos, comandos, verificações e precauções de flash. Sua sequência de configuração é:

1. Instale as ferramentas necessárias e selecione a porta servo.
2. Faça backup das configurações do motor e atualize o firmware personalizado publicado.
3. Calibre os deslocamentos das juntas e os limites de deslocamento conforme necessário para a configuração.
4. Verifique a comunicação com torque desligado.
5. Grave poses, visualize o replay e realize o primeiro teste de movimento.
6. Habilite a compensação de gravidade com um modelo correspondente ao braço e sua calibração.
7. Sintonize e visualize o movimento.

**Gravar o firmware pode danificar o servo ou apagar a calibração.** Siga as precauções de potência, torque e recuperação do guia antes de prosseguir.

Para uma nova calibração SO-101 ou SO-102, use as imagens reference-pose existentes e siga o [guia de calibração](tools/settings/README.md#reference-pose-images). Mantenha uma calibração verificada existente ao reutilizar suas gravações e modelo gravitacional.

**SO-101 pose de referência**

[![SO-101 pose de referência com seis juntas rotuladas](../../../tools/settings/images/so101-reference-pose.png)](../../../tools/settings/images/so101-reference-pose.png)

**SO-102 pose de referência**

[![SO-102 pose de referência com seis juntas rotuladas](../../../tools/settings/images/so102-reference-pose.png)](../../../tools/settings/images/so102-reference-pose.png)

<a id="detailed-documentation"></a>
## Documentação detalhada

A **[documentação detalhada](DETAILED_DOCUMENTATION.md)** cobre configuração, protocolos, registros, construção e verificação. Diagramas técnicos e demonstrações de vídeo relevantes aparecem ao lado das seções correspondentes.

- [Modo legado](DETAILED_DOCUMENTATION.md#legacy-mode)
- [Como funciona o modo de extensão](DETAILED_DOCUMENTATION.md#how-extension-mode-works)
- [S-curve movimento](DETAILED_DOCUMENTATION.md#s-curve-motion)
- [Posições de referência de calibração](DETAILED_DOCUMENTATION.md#calibration-reference-poses)
- [PID controlador](DETAILED_DOCUMENTATION.md#pid-controller)
- [Velocidade feedforward](DETAILED_DOCUMENTATION.md#velocity-feedforward)
- [Compensação de gravidade](DETAILED_DOCUMENTATION.md#gravity-compensation)
- [Iniciando e parando o modo de extensão](DETAILED_DOCUMENTATION.md#starting-and-stopping-extension-mode)
- [Protocolo de extensão](DETAILED_DOCUMENTATION.md#extension-protocol)
- [Registros de extensão](DETAILED_DOCUMENTATION.md#extension-registers)
- [Construir e verificar](DETAILED_DOCUMENTATION.md#build-and-verification)
- [Layout do repositório](DETAILED_DOCUMENTATION.md#repository-layout)
- [Limites atuais](DETAILED_DOCUMENTATION.md#current-limits)


Consulte [tools](tools/README.md) para guias de comando individuais e [firmware](firmware/README.md) para o conjunto de ferramentas de construção.
<!-- /translated-content -->
