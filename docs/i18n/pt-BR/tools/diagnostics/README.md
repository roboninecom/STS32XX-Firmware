<!-- translation-navigation -->
[English](../../../en/tools/diagnostics/README.md) · [Русский](../../../ru/tools/diagnostics/README.md) · [Español](../../../es/tools/diagnostics/README.md) · [Français](../../../fr/tools/diagnostics/README.md) · [Deutsch](../../../de/tools/diagnostics/README.md) · [Português (Brasil)](README.md) · [简体中文](../../../zh-CN/tools/diagnostics/README.md) · [日本語](../../../ja/tools/diagnostics/README.md) · [हिन्दी](../../../hi/tools/diagnostics/README.md) · [العربية](../../../ar/tools/diagnostics/README.md)

[Original em inglês](../../../../../tools/diagnostics/README.md)

> Tradução automática completa, ainda não revisada por um falante nativo. Imagens e vídeos são compartilhados; o texto neles permanece no idioma original.
<!-- /translation-navigation -->

<!-- translated-content -->
<a id="bus-benchmark-and-telemetry-diagnostics"></a>
# Benchmark de barramento e diagnóstico de telemetria

Duas ferramentas command-line para servos STS: medem o desempenho da comunicação e verificam a telemetria estacionária em busca de leituras incomuns. Requer Node.js 20 ou mais recente. Na raiz do repositório, instale dependências com `npm install`.

Mantenha os motores parados com torque desligado e configurações bloqueadas. Pare outros programas que usam a porta serial. Ambas as ferramentas verificam os servos selecionados antes e depois de uma corrida. Nenhum deles ativa o torque, move um motor, atualiza o firmware ou salva configurações.

<a id="bus-benchmark"></a>
## Referência de ônibus

```sh
npm run bus-benchmark -- --port /dev/cu.usbmodemXXXX --ids 1,2 --repetitions 1000
```

Por padrão, mede solicitações PING e READ de tamanhos diferentes. Cada caso executa 20 tentativas de aquecimento e, em seguida, 1,000 tentativas medidas por motor. A ordem do motor gira entre as rodadas. Tentativas fracassadas permanecem falhas; novas tentativas nunca os substituem.

Opções úteis:

- `--list`: lista casos sem abrir uma porta.
- `--cases ping,read-table-87`: executa casos selecionados.
- `--warmup 20`, `--repetitions 1000`: tentativas por caso e motor.
- `--gap-ms 1`: pausa entre solicitações; o padrão é nenhuma pausa adicionada.
- `--results DIR`: pai de saída; o padrão é `tools/diagnostics/results`.
- `--include-writes`: também compara gravações reconhecidas nos registros RAM 51–54. Esses registros não estão documentados em outros firmwares; use esta opção apenas em um servo compatível verificado. Os valores originais são restaurados após conclusão, falha ou interrupção normal. As confirmações de gravação devem estar habilitadas.

Cada execução cria um novo diretório contendo `summary.csv`, `report.json` e `samples.jsonl`. O resumo inclui mediana, p95, p99 e latência máxima, além de tempo limite e contagens de erros. Os registros brutos incluem trocas de aquecimento e limpeza.

A latência vai da chamada de gravação serial até uma resposta decodificada correspondente. Inclui atrasos USB e operating-system; não é um tempo de resposta firmware-only ou uma medição da capacidade máxima do barramento. Os tempos limite são contados separadamente e não incluídos nos percentis de latência.

<a id="telemetry"></a>
## Telemetria

```sh
npm run telemetry -- --port /dev/cu.usbmodemXXXX --ids 1,2 \
  --samples 1000 --interval-ms 20 --output tools/diagnostics/results/telemetry-check
```

Lê 17 bytes começando no registro 56, uma vez por motor por rodada. O padrão é 100,000 amostras por motor sem pausa adicional. Use um novo diretório de saída para cada execução; os arquivos de amostra existentes nunca são substituídos.

- `--interval-ms 20`: intervalo mínimo entre o início da rodada. Os slots perdidos são ignorados e contados em `missedDeadlines`; rodadas atrasadas não causam rajadas.
- `--gap-ms 1`: em vez disso, faça uma pausa após cada solicitação do motor. Não pode ser combinado com `--interval-ms`.
- `--voltage-min 5.5 --voltage-max 8.4`: faixa de tensão esperada em volts; o padrão é 8–16 V. Defina isto para os motores conectados e a fonte de alimentação.

Saídas: `samples.csv` contém todas as tentativas, `anomalies.jsonl` contém leituras sinalizadas e trocas brutas e `report.json` contém contagens, intervalos, estatísticas de tempo e configurações before/after. CSV a tensão está em décimos de volt; posição, velocidade, corrente e esforço retêm suas unidades de registro brutas.

Verifica mudanças de tensão e temperatura de sinalização, leituras implausíveis, status diferente de zero e esforço enquanto o torque está desligado. A detecção de picos de temperatura requer três respostas válidas consecutivas; uma resposta ausente ou inválida interrompe a sequência. Esses sinalizadores identificam leituras a serem inspecionadas, e não provam uma falha de firmware ou sensor. Leituras estacionárias idênticas são normais e não comprovam dados obsoletos.

<a id="common-options-and-tests"></a>
## Opções e testes comuns

Ambas as ferramentas aceitam `--baud 1000000`, `--timeout-ms 100` e `--help`. Os IDs são padronizados como `1,2`; especifique os motores realmente conectados. O tempo limite de resposta começa após o esgotamento da gravação serial. Após um tempo limite, as ferramentas aguardam um barramento silencioso antes de continuar porque as respostas não contêm números de sequência.

Ctrl+C interrompe a execução e executa a limpeza. Erros, execuções incompletas e amostras sinalizadas produzem um código de saída diferente de zero. Os resultados em `results/` são ignorados pelo Git.

```sh
npm run test:diagnostics
```

Esses testes offline não se conectam ao hardware.
<!-- /translated-content -->
