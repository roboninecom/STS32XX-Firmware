<!-- translation-navigation -->
[English](../../../../en/host/arm-control/profiles/README.md) · [Русский](../../../../ru/host/arm-control/profiles/README.md) · [Español](../../../../es/host/arm-control/profiles/README.md) · [Français](../../../../fr/host/arm-control/profiles/README.md) · [Deutsch](../../../../de/host/arm-control/profiles/README.md) · [Português (Brasil)](README.md) · [简体中文](../../../../zh-CN/host/arm-control/profiles/README.md) · [日本語](../../../../ja/host/arm-control/profiles/README.md) · [हिन्दी](../../../../hi/host/arm-control/profiles/README.md) · [العربية](../../../../ar/host/arm-control/profiles/README.md)

[Original em inglês](../../../../../../host/arm-control/profiles/README.md)

> Tradução automática completa, ainda não revisada por um falante nativo. Imagens e vídeos são compartilhados; o texto neles permanece no idioma original.
<!-- /translation-navigation -->

<!-- translated-content -->
<a id="arm-profiles"></a>
# Perfis de braço

Configurações de referência dos braços verticais empty-gripper. Cada diretório contém um arquivo do controlador e um perfil por motor, incluindo PID e feedforward de velocidade direcional. Ambos os controladores utilizam os modelos de gravidade para motores 2–4; os motores 1, 5 e 6 recebem esforço de gravidade zero.

| Perfil | Velocidade de repetição | Aceleração | Escopo |
| --- | ---: | ---: | --- |
| [SO-101](../../../../../../host/arm-control/profiles/so101/controller.json) | 1,000 counts/s; teto de perfil 1,500 | 10,000 counts/s² | Configurações de sintonia mantidas. M1 oscilação de movimento e excursões M2 mais lentas permanecem sem solução. |
| [SO-102](../../../../../../host/arm-control/profiles/so102/controller.json) | 2,000 counts/s | 15,000 counts/s² | Configurações atuais de comparação fixed-profile. Esta configuração rápida ainda precisa de validação de hardware. |

Estes são pontos de partida, não padrões universais ou uma reivindicação de ajuste completo. O perfil SO-102 usa M1 D=0.0625 fixo, M6 P=4 e uma rampa de 100 ms. O replay mais antigo usava M1 D=0.75 durante o movimento, M6 P=16 e uma rampa de 180 ms, portanto, este arquivo não reproduz aquela execução mais antiga.

<a id="use"></a>
## Usar

Defina `followerPort` no arquivo do controlador escolhido. Mantenha o perfil relativo e os caminhos de gravidade intactos. Da raiz do repositório:

```sh
npm run replay -- host/arm-control/profiles/so102/controller.json POSES.json
npm run replay -- host/arm-control/profiles/so102/controller.json POSES.json --run
```

Use `so101` para o outro perfil. O primeiro comando é visualizado; o segundo movimenta o braço e o deixa na pose final. O Replay aplica os perfis a RAM. Para teleoperação, defina também `leaderPort` e adicione `leaderId`, `mapping` e quaisquer substituições direction/center a cada junta; veja o [guia de mapeamento](../../../tools/teleoperation/README.md#mapping-and-control).

Os modelos de gravidade incluem a calibração do codificador usada durante o ajuste. O preflight exige que ele corresponda ao braço conectado. **Não copie os deslocamentos do codificador de outro braço para satisfazer esta verificação.** Calibre seu braço, ajuste ou adapte seu modelo e valide o resultado em velocidade modesta antes de usar full-speed. Alterações na montagem, geometria do link ou carga útil também exigem validação. Consulte o [formato do modelo de gravidade](../models/README.md) e o [procedimento de ajuste](../../../tools/tuning/README.md).

Esses arquivos não definem uma posição de calibração física universal. Siga o [reference-pose guia](../../../tools/settings/README.md#choose-the-reference-pose) antes de criar uma nova calibração. Definir todos os motores para 2048 reproduz a pose capturada naquele braço, sujeita aos limites salvos e ao erro de rastreamento; ele não reproduz automaticamente a pose zero de nenhum dos modelos agrupados.
<!-- /translated-content -->
