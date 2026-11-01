<!-- translation-navigation -->
[English](../../../en/tools/teleoperation/README.md) · [Русский](../../../ru/tools/teleoperation/README.md) · [Español](../../../es/tools/teleoperation/README.md) · [Français](../../../fr/tools/teleoperation/README.md) · [Deutsch](../../../de/tools/teleoperation/README.md) · [Português (Brasil)](README.md) · [简体中文](../../../zh-CN/tools/teleoperation/README.md) · [日本語](../../../ja/tools/teleoperation/README.md) · [हिन्दी](../../../hi/tools/teleoperation/README.md) · [العربية](../../../ar/tools/teleoperation/README.md)

[Original em inglês](../../../../../tools/teleoperation/README.md)

> Tradução automática completa, ainda não revisada por um falante nativo. Imagens e vídeos são compartilhados; o texto neles permanece no idioma original.
<!-- /translation-navigation -->

<!-- translated-content -->
<a id="teleoperation"></a>
# Teleoperação

Mova um seguidor energizado movendo um líder não energizado com a mão. Suporta pares de juntas 1–6 em dois barramentos seriais separados. O líder pode usar firmware de fábrica; o seguidor requer o firmware v9 deste repositório.

<a id="run"></a>
## Corre

Instale o Node.js 20 ou mais recente e execute `npm install` na raiz do repositório. Copie [example.json](../../../../../tools/teleoperation/example.json) ao lado do original como `controller.local.json`. Defina as portas, a taxa de transmissão e os IDs das juntas. O exemplo compartilha o [perfil do motor](../../../../../host/arm-control/profile.example.json) com repetição e ajuste. Copie-o para suas próprias configurações e atualize seu caminho ou incorpore seus perfis. Os caminhos são relativos ao arquivo do controlador. Os ganhos de exemplo ilustram o formato; use configurações testadas em seu mecanismo.

Visualize o mapeamento sem alterar nenhuma configuração do motor:

```sh
npm run teleoperate -- CONFIG.json
```

Verifique as posições e alvos relatados, apoie ambos os mecanismos e deixe espaço para o seguidor se mover em direção à pose do líder. Inicie o controle explicitamente:

```sh
npm run teleoperate -- CONFIG.json --run
```

Cada barramento deve conter exatamente seus IDs configurados. Ambos os mecanismos precisam de limites de posição salvos e não vazios e modo de posição comum com resolução de unidade. As configurações do seguidor devem ser bloqueadas sem nenhuma gravação adiada pendente. O torque líder já deve estar desligado; esta ferramenta nunca escreve para o líder. A inicialização do seguidor controla motores energizados e não energizados automaticamente.

As execuções continuam até Ctrl+C, a menos que você defina explicitamente `durationMs`. **A saída normal mantém a alimentação ligada.** A inicialização, a gravidade e a limpeza de falhas seguem o [comportamento do controlador compartilhado](../../host/arm-control/README.md#control-behaviour).

<a id="mapping-and-control"></a>
## Mapeamento e controle

Cada entrada `joints` contém `leaderId`, `followerId` e `mapping`:

| Configuração | Significado |
| --- | --- |
| `mapping: "angle"` | Preservar o deslocamento do encoder em relação ao centro dos limites armazenados. |
| `mapping: "range"` | Dimensione cada metade da viagem do líder para a metade correspondente do seguidor. Útil para pinças. |
| `direction` | `1` (padrão) ou `-1` para reverter o movimento. |
| `leaderMiddle`, `followerMiddle` | Centros opcionais para mapeamento de alcance, estritamente dentro dos respectivos limites. |

As metas são limitadas aos limites salvos do seguidor. `angle` opera em contagens de codificadores, portanto assume escalas e engrenagens de codificadores compatíveis.

O centro de mapeamento é o ponto médio dos limites salvos, que pode diferir da referência de calibração em 2048. Portanto, a correspondência de poses de calibração por si só não garante a correspondência de alvos quando os limites do líder e do seguidor são assimétricos. Visualize o mapeamento antes de mover. `leaderMiddle` e `followerMiddle` substituem centros apenas para mapeamento `range`.

Forneça um perfil para cada seguidor e configurações acceleration/ramp compartilhadas conforme descrito em [configurações do motor](../../host/arm-control/README.md#motor-settings-files). Adicione `gravityModel` para ativar [compensação de gravidade](../../host/arm-control/README.md#enable-gravity).

<a id="timing-and-checks"></a>
## Tempo e verificações

| Configuração opcional | Padrão | Significado |
| --- | --- | --- |
| `hz` | 60 | Taxa de atualização solicitada, 1–60 Hz. Os períodos perdidos são ignorados. |
| `maxAgeMs` | 100 | Idade máxima de um quadro líder antes do envio, 10–10000 ms. |
| `responseTimeoutMs` | 100 | Tempo limite da fila de resposta e transação, 25–10000 ms. |
| `durationMs` | Ilimitado | Duração da execução incluindo inicialização do controle, 1–86400000 ms. |

Cada quadro deve incluir todas as posições líderes e permanecer dentro de `maxAgeMs` até ser enviado. Os períodos de atualização perdidos são ignorados. Feedback, gravidade e registro compartilham o circuito de controle; a velocidade alcançada depende do desempenho do barramento e do computador. Consulte [verificações compartilhadas e tempo](../../host/arm-control/README.md#checks-and-timing).

Os logs são salvos em `logs/motion/` ignorados como newline-delimited JSON. Eles contêm configuração, sessão escolhida ID, visualização, comandos pretendidos, frames enviados, feedback e registros stop/error. Um registro de comando por si só não prova que um alvo foi enviado ou aceito. As gravações são aguardadas sem acumular uma fila de log ilimitada; o registro lento pode acionar a verificação frame-age.

Reproduza os logs sem um líder conectado usando o [recorded-session comando de reprodução](../poses/README.md#replay-a-recorded-session).

Execute testes offline com `npm run test:teleoperation`.
<!-- /translated-content -->
