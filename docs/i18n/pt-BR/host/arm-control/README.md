<!-- translation-navigation -->
[English](../../../en/host/arm-control/README.md) · [Русский](../../../ru/host/arm-control/README.md) · [Español](../../../es/host/arm-control/README.md) · [Français](../../../fr/host/arm-control/README.md) · [Deutsch](../../../de/host/arm-control/README.md) · [Português (Brasil)](README.md) · [简体中文](../../../zh-CN/host/arm-control/README.md) · [日本語](../../../ja/host/arm-control/README.md) · [हिन्दी](../../../hi/host/arm-control/README.md) · [العربية](../../../ar/host/arm-control/README.md)

[Original em inglês](../../../../../host/arm-control/README.md)

> Tradução automática completa, ainda não revisada por um falante nativo. Imagens e vídeos são compartilhados; o texto neles permanece no idioma original.
<!-- /translation-navigation -->

<!-- translated-content -->
<a id="shared-arm-controller-and-gravity-compensation"></a>
# Controlador de braço compartilhado e compensação de gravidade

Teleoperação ao vivo, ajuste, replay named-pose e replay timed-session usam um controlador seguidor. Ele lida com configuração, alvos, feedback medido, gravidade e limpeza. O [servo driver](../servo-driver/README.md) possui codificação e transporte de pacotes.

<a id="motor-settings-files"></a>
## Arquivos de configurações do motor

Consulte os [perfis SO-101 e SO-102](profiles/README.md) para configurações de referência e seus limites operacionais.

`profiles` pode conter configurações inline ou caminhos relativos ao arquivo do controlador:

```json
"profiles": {"1": "motor-1.json", "2": "motor-2.json"}
```

O [example profile](../../../../../host/arm-control/profile.example.json) é compartilhado pelos exemplos de ferramentas. Copie-o para suas próprias configurações e atualize a referência ou incorpore o perfil. Se você mover um arquivo de controlador, ajuste seu perfil e caminhos de gravidade. Arquivos nomeados `*.local.json` são ignorados pelo Git.

Defina `acceleration` em counts/s² (1–30000) e `rampTimeMs` em milissegundos (1–255) no controlador. Cada motor pode substituí-los com `accelerationLimit` e `rampTimeMs` em seu perfil. Perfis são configurações de extensão RAM; os deslocamentos salvos do encoder e os limites de deslocamento permanecem separados.

| Campo de perfil | Significado |
| --- | --- |
| `kpQ8`, `kdQ8`, `kiQ8` | Ganhos do controlador multiplicados por 256. |
| `integralLimit`, `effortLimit` | Limites de produção integral e total em unidades de esforço PWM. |
| `velocityLimit` | Velocidade máxima em counts/s; o padrão é 65535. |
| `velocityFilterQ8` | Configuração do filtro de velocidade medida, 1–255. |
| `gravitySlewEffortPerS` | Limite de taxa para alterações no esforço gravitacional. |
| `velocityFeedforward` | `positiveGainQ8`, `negativeGainQ8`, `effortLimit`; zere todos os três para desativar. |

Consulte o [guia de registro de firmware](../../DETAILED_DOCUMENTATION.md#configuration--0xa0) para unidades e intervalos completos. Estas são configurações per-motor, não perfis de firmware alternáveis.

Uso do aplicativo de ajuste e configurações `joints: [{ "followerId": 1 }]`; adicione uma entrada por motor controlado. Named-pose replay obtém IDs da gravação e não precisa de array `joints`. Apenas teleoperação ao vivo e recorded-leader replay precisam de `leaderId`, `mapping` e opcional direction/centers; veja [mapeamento de teleoperação](../../tools/teleoperation/README.md#mapping-and-control).

<a id="enable-gravity"></a>
## Ativar gravidade

Adicione `gravityModel` à sua configuração existente. Os caminhos são relativos ao **arquivo de configuração**, não ao diretório de trabalho. Para uma configuração salva na raiz do repositório:

```json
"gravityModel": "host/arm-control/models/arm-upright-empty.json"
```

Esta linha é um acréscimo a uma configuração completa, não a um arquivo independente. Fornece `profiles` testado para cada seguidor; `effortLimit` limita a produção total do motor e `gravitySlewEffortPerS` limita a rapidez com que o esforço da gravidade muda. Definir a rotação por si só não permite a gravidade. Sem `gravityModel`, o replay elimina qualquer esforço de gravidade retido e então é executado sem compensação de gravidade.

Os [modelos de braço](models/README.md) fornecidos preservam a calibração de cada braço vertical, empty-gripper. Seus coeficientes para motores 2–4 usam contagens medidas de encoder, incluindo juntas acopladas; os motores 1, 5 e 6 usam zero explicitamente. Todo seguidor controlado precisa de um modelo, e todas as juntas utilizadas por seus termos devem ser controladas e medidas. Os modelos Angle-dependent também declaram `encoderCalibration` para cada entrada: `positionCorrection`, `resolution: 1` e `reverse` assinados (o sinalizador de reversão do codificador). O Preflight os compara com os registros do motor e rejeita uma incompatibilidade antes da configuração ou da habilitação de torque. Restaure um backup correspondente desse mesmo braço ou atualize e valide o modelo após a recalibração. Uma captura de referência em 2048 não estabelece por si só os ângulos físicos do modelo; consulte o [guia de calibração](../../tools/settings/README.md#choose-the-reference-pose). Para qualquer modelo six-motor fornecido, inclua IDs 1–6 e todos os seis perfis. Não reutilize o modelo após alterar os deslocamentos, montagem, geometria ou carga do encoder sem verificar a calibração.

Use o mesmo campo de configuração para cada comando:

```sh
npm run teleoperate -- CONFIG.json
npm run replay -- CONFIG.json POSES.json
npm run replay -- CONFIG.json SESSION.ndjson
```

Esses comandos apenas visualizam. Adicione `--run` para iniciar o controle. A configuração atual e as posições medidas do seguidor determinam a gravidade; os valores de gravidade registrados e os ganhos históricos nunca são reproduzidos. O modelo é validado antes do uso e seu caminho e hash SHA-256 são incluídos no log da sessão.

<a id="control-behaviour"></a>
## Comportamento de controle

1. O Preflight verifica firmware, limites salvos, integridade, perfis e entradas de modelo.
2. Todas as ferramentas do controlador continuam uma sessão alimentada compatível ou preparam uma nova automaticamente. Perfis correspondentes mantêm o torque; os perfis alterados são aplicados a um motor de cada vez. A nova configuração lida com a liberação, configuração e seleção de torque e, em seguida, habilita todos os motores preparados juntos.
3. A gravidade é medida, enviada e confirmada antes do primeiro alvo em movimento.
4. Durante o movimento e as pausas, uma passagem de feedback fornece verificações de integridade e cálculos de gravidade. A gravidade é atualizada aproximadamente a cada 50 ms. Não há segundo leitor de telemetria ou loop de feedforward de velocidade do host.
5. Em uma saída normal, a gravidade continua durante o movimento final e a gravidade restante do firmware muda. O controlador aguarda 200 ms de descanso, com um tempo limite de conclusão de 30 s, e então confirma a atualização final da gravidade. O torque permanece ativado; firmware mantém o último alvo e esforço de gravidade.

Para repetição e teleoperação, Ctrl+C interrompe novos alvos e segue a mesma sequência de conclusão. Em vez disso, o ajuste interrompe o lote e tenta torque-off. Ctrl+C não é uma parada de emergência. Resto significa que os planejadores pararam e cada posição medida permanece dentro de um intervalo de one-count durante todo o intervalo de 200 ms. Não prova erro de rastreamento zero; pose/session o replay também aplica sua tolerância de chegada configurada.

O processo para de atualizar a gravidade após a saída. Se o braço for posteriormente movido ou a sua carga mudar, o esforço retido não se adapta. Um processo eliminado ou barramento desconectado também pode deixar o último alvo e esforço ativos.

<a id="checks-and-timing"></a>
## Verificações e tempo

A gravidade usa posições medidas de seguidores, nunca alvos solicitados. Uma amostra de feedback deve ser íntegra, atualizada e pertencer à sessão atual. Cada atualização de gravidade tem sua própria sequência; a aceitação é verificada na próxima passagem de feedback. Todos os resultados são verificados em relação aos limites de esforço do modelo e do motor antes de qualquer gravação. Um resultado excessivo é um erro, não um valor cortado.

As medições acopladas são sequenciais. A aquisição, o enfileiramento e as gravações subsequentes devem permanecer dentro de 100 ms do início da passagem de feedback. A próxima atualização também deverá ocorrer dentro desse limite; um leitor, registrador ou barramento atrasado causa uma falha em vez de continuar silenciosamente com a antiga gravidade. Estas são verificações de host, não tempos limite de firmware. Assíncrono I/O pode atrasar a detecção; eles não tornam o host um controlador real-time.

Verificações de integridade ao vivo são executadas aproximadamente a cada 250 ms sem gravidade ou a cada 50 ms com ela. A reprodução usa feedback C2 detalhado a cada 50 ms durante esperas e reprodução cronometrada; as verificações de chegada podem ser pesquisadas mais rapidamente. `--compact` substitui pacotes C1 menores, que omitem posições intermediárias do planejador e contribuições PID. O ajuste lê feedback detalhado para todos os motores na inicialização, depois C2 para a ponta de prova e C1 para motores de suporte. O feedback sempre é compartilhado pelo leitor gravitacional.

Erros de modelo, atualizações rejeitadas, missing/stale feedback, perda de propriedade, alarmes e temperaturas iguais ou superiores a 60 °C tentativa verificada torque-off em cada seguidor preparado. Falhas de limpeza são relatadas.

Uma exceção é um prazo gravity-update perdido durante uma retenção estabelecida: o controlador retém o torque somente se duas novas passagens de feedback confirmarem motores estacionários e saudáveis na mesma sessão. A execução ainda falha e reporta `holdRetained: true`; ele não é retomado automaticamente.

Os registros de log de telemetria incluem feedback medido e a última gravidade solicitada effort/sequence. O feedback do firmware confirma essa solicitação em uma amostra subsequente; uma solicitação registrada por si só não é prova de aceitação. `settledAt` é uma estimativa conservadora do host de quando a rotação gravitacional solicitada pode terminar.

<a id="api-and-tests"></a>
## API e testes

`session.run` gerencia conexões seriais, logs de sessão e limpeza de uma fonte de entrada. `ArmController` aceita um driver seguidor, configuração, fonte de entrada e instância `GravityModel` opcional. Carregue modelos com `await GravityModel.load(filename)`; o CLI resolve o caminho configuration-relative. As fontes de entrada fornecem `joints`, `preflight`, `describe`, `sample` e `play`; a entrada ao vivo verifica adicionalmente se seu líder está sem energia. O ajuste automatizado pode solicitar feedback detalhado para seu motor de sonda através do mesmo leitor. `changeProfile` verifica o controle estacionário, libera apenas aquele motor, configura e re-enables ele, então confirma a gravidade novamente. Os motores de suporte permanecem ligados. O motor alterado perde brevemente o torque e captura sua posição medida na reinicialização; use uma pose apoiada ou mecanicamente segura para alterações de perfil. Erros de perfil usam a limpeza normal de falha all-motor.

As fontes enviam posições por meio do controlador e usam suas esperas atendidas, de modo que pausas longas continuam as atualizações de feedback.

Execute `npm run test:arm` para o controlador compartilhado, `npm run test:poses` para recording/replay e `npm run test:teleoperation` para controle ao vivo. Os testes usam respostas seriais simuladas.
<!-- /translated-content -->
