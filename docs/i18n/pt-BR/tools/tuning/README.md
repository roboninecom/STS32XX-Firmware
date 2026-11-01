<!-- translation-navigation -->
[English](../../../en/tools/tuning/README.md) · [Русский](../../../ru/tools/tuning/README.md) · [Español](../../../es/tools/tuning/README.md) · [Français](../../../fr/tools/tuning/README.md) · [Deutsch](../../../de/tools/tuning/README.md) · [Português (Brasil)](README.md) · [简体中文](../../../zh-CN/tools/tuning/README.md) · [日本語](../../../ja/tools/tuning/README.md) · [हिन्दी](../../../hi/tools/tuning/README.md) · [العربية](../../../ar/tools/tuning/README.md)

[Original em inglês](../../../../../tools/tuning/README.md)

> Tradução automática completa, ainda não revisada por um falante nativo. Imagens e vídeos são compartilhados; o texto neles permanece no idioma original.
<!-- /translation-navigation -->

<!-- translated-content -->
<a id="automated-tuning"></a>
# Ajuste automatizado

Execute um lote limitado de configurações candidatas, compare movimentos repetidos e retenções mais longas e obtenha uma recomendação machine-readable. Usa o mesmo driver v9, controlador e modelo de gravidade calibrado que replay e teleoperação. Nenhuma configuração é gravada em EEPROM e nenhum candidato vencedor é instalado automaticamente.

<a id="start"></a>
## Começar

Na raiz do repositório, instale as dependências 20+ do Node.js com `npm install`. Copie `controller.example.json` e `example.json` ao lado dos originais como `controller.local.json` e `plan.local.json`. Defina `config` para `controller.local.json` do plano e, em seguida, edite a porta, os IDs do motor, os perfis, os pares de viagens conjuntas seguras e os limites do seu mecanismo. Exemplos de ganhos e poses são ilustrativos. O controlador faz referência ao [perfil do motor](../../../../../host/arm-control/profile.example.json); copie-o para suas próprias configurações e atualize seu caminho ou incorpore o perfil. Inclua todos os motores de suporte como `{ "followerId": ID }` em `joints`; nenhum mapeamento de líderes é necessário. Conclua a [calibração](../settings/README.md#choose-the-reference-pose) antes de escolher as posições de teste. As posições usam contagens de codificador corrigidas; um novo deslocamento altera seu significado físico. Atualize os pares de teste, as gravações e o modelo gravitacional após a recalibração. Para gravidade, adicione `gravityModel` exatamente como descrito no [guia do controlador compartilhado](../../host/arm-control/README.md).

O caminho `config` do plano é relativo ao plano. O perfil do controlador e os caminhos `gravityModel` são relativos a esse arquivo do controlador. A mesma configuração do controlador pode ser usada para reprodução de pose. Omita `durationMs` para ajuste: o plano possui o orçamento em lote. Proteja o mecanismo para inicialização e alterações de perfil. Alterar um perfil libera brevemente esse motor; uma nova configuração pode liberar todos os seguidores configurados.

```sh
npm run tune -- inspect tools/tuning/plan.local.json
npm run tune -- preflight tools/tuning/plan.local.json
npm run tune -- run tools/tuning/plan.local.json
```

A ferramenta continua suportando juntas em seus alvos de retenção de firmware existentes. Apenas `probeId` percorre seus pares de teste declarados. Não há reposicionamento whole-arm automático. Os alvos atuais e as posições medidas são registrados para comparação entre execuções. Use caminhos de junta revisados para a configuração atual do braço.

Use o mesmo comando para o primeiro lote e todos os lotes subsequentes:

```sh
npm run tune -- run NEXT_PLAN.json
```

As alterações de inicialização e perfil usam o [ciclo de vida do controlador compartilhado](../../host/arm-control/README.md#control-behaviour). Não execute outro controlador no mesmo barramento.

`inspect` não conecta. `preflight` lê firmware, calibração, limites salvos, integridade e perfis sem alterar os motores. `run` os move. As metas são limitadas aos limites de posição salva; a simulação informa o caminho efetivo. Um par colapsado em uma posição não pode ser usado como exercício de ajuste.

<a id="tuning-order"></a>
## Ordem de ajuste

1. **Linha de base:** verifique a calibração, o movimento seguro, as temperaturas e a repetibilidade com as configurações existentes. Use `stage: "baseline"` e nenhum candidato.
2. **Gravidade:** mantenha ganhos de feedback modestos e compare câmera lenta em ambas as direções em diversas poses e pelo menos duas velocidades. Comece com um modelo calibrado. `stage: "gravity"` coleta dados de identificação sem alterar os ganhos.
3. **Feedforward de velocidade:** após a verificação da gravidade, compare os ganhos de velocidade direcional usando movimento constante em mais de uma velocidade.
4. **P/D e filtragem de velocidade:** seleciona um pequeno conjunto explícito de candidatos. Inclua posturas com carga de gravidade alta e baixa e, em seguida, use sustentações mais longas para expor as oscilações. Um pequeno lote fatorial pode comparar P, D e filtragem juntos; verifique a melhor combinação nos pares held-out.
5. **Integral:** somente se um erro persistente persistir; compare a precisão do movimento e também as esperas longas. Inclua pequenas reversões: varreduras longas por si só podem perder um limite integral que impede uma junta estacionária de superar o atrito. Mantenha o zero integral, a menos que o resultado suporte sua ativação.
6. **Tempo de aceleração e rampa:** com ganhos fixos, use `stage: "motion"` para comparar aceleração e suavização nas velocidades necessárias.
7. **Movimento combinado:** reproduza um caminho gravado que exercita todas as articulações e inclui configurações dobradas e estendidas. Um ganho que funciona com juntas de apoio estacionárias pode oscilar quando todo o mecanismo se move. Verifique novamente as juntas alteradas neste mesmo caminho antes de aceitar suas configurações.
8. **Validação:** congele a configuração selecionada, repita o caminho em cada velocidade e aceleração necessárias e mantenha poses representativas por mais tempo. Registre a precisão, overshoot, estabilização, temperatura e saturação de saída para cada motor. Verifique novamente após alterar a carga útil ou a calibração.

`stage` restringe campos candidatos: `velocity` permite `velocityFeedforward`; `pid` permite `kpQ8`, `kdQ8`, `velocityFilterQ8`; `integral` permite `kiQ8` e `integralLimit`; `motion` permite `accelerationLimit` e `rampTimeMs`. Os estágios de linha de base, gravidade e validação coletam dados sem alterações de candidatos. P/D/I e ganhos de velocidade usam as unidades Q8 do firmware: divida por 256 para obter o ganho correspondente. Os limites de saída permanecem os limites do controlador fornecidos explicitamente em todo o lote.

Mantenha a aceleração e o tempo de rampa fixos ao comparar os ganhos. Em seguida, compare as configurações de movimento nas velocidades necessárias. A aceleração máxima configurável é 30,000 counts/s²; o valor útil depende dos limites de carga e esforço. Verifique a referência real e as velocidades medidas: cursos curtos podem nunca atingir a velocidade solicitada.

O ganho integral e seu limite precisam ser testados juntos. Uma grande correção acumulada pode continuar impulsionando uma junta após a liberação do atrito, causando overshoot. O limite integral limita apenas essa correção; a saída total do motor é controlada separadamente por `effortLimit`. Prefira um erro residual estável à busca repetida e relate qualquer critério de precisão que as configurações selecionadas não atendam.

<a id="reuse-settings"></a>
## Reutilizar configurações

Um perfil de controlador pode ser um arquivo JSON separado, por exemplo `"profiles": {"1": "motor-1.json"}`. Os caminhos são relativos ao arquivo do controlador. Os arquivos do motor contêm os mesmos campos dos perfis embutidos; opcionais `accelerationLimit` e `rampTimeMs` substituem os padrões compartilhados. Replay, teleoperação e ajuste carregam esses arquivos através do mesmo carregador. As configurações são aplicadas a RAM durante a configuração da extensão, não salvas em EEPROM.

Exporte um controlador para um novo diretório contendo um arquivo por motor, `controller.json`, um `gravity.json` opcional e um manifesto:

```sh
npm run tune -- export CONFIG.json NEW_DIRECTORY
```

A exportação não se conecta aos motores nem certifica as configurações. Use o `controller.json` exportado com replay, teleoperação ou plano de ajuste.

Para aplicar as configurações aceitas e manter a posição atual:

```sh
npm run tune -- apply NEW_DIRECTORY/controller.json
```

A inicialização lida com motores ligados e não ligados automaticamente. Numa sessão existente, apenas os motores alterados são brevemente desativados e reconfigurados, um de cada vez. Os motores de suporte permanecem ligados e os alvos existentes são mantidos. A omissão do modelo gravitacional elimina o esforço gravitacional retido. A reprodução aplica sua configuração automaticamente, portanto, este comando só é necessário para aplicar as configurações sem reproduzir.

Mantenha as configurações aceitas, o modelo gravitacional, a calibração, a descrição payload/mounting e as evidências de validação juntas. Outro braço precisa de sua própria calibração e validação. Não restaure os deslocamentos do codificador de outro braço.

<a id="how-a-batch-works"></a>
## Como funciona um lote

Para triagem, a ferramenta executa linha de base → todos os candidatos → linha de base. Cada bloco exercita cada par e velocidade em ambas as direções, alternando a primeira abordagem entre repetições. Se as duas linhas de base ultrapassarem `driftRatio`, o lote termina como inconclusivo e mantém sua retenção energizada. O desvio de posição permite uma contagem de quantização do codificador. Os candidatos elegíveis são classificados e até `finalists` repetem a comparação entre linhas de base compartilhadas em diferentes pares de validação com retenções mais longas. Uma recomendação exige aprovação na validação e superação de sua linha de base.

As métricas incluem rastreamento móvel RMS, erro e amplitude de posição estável, overshoot, tempo de acomodação, tempo de resposta total e fração de saturação. A sedimentação requer um período final contínuo dentro da banda; uma travessia antecipada não conta. Se as retenções de triagem forem menores que o tempo de acomodação permitido mais a permanência, as métricas de retenção e liquidação serão relatadas como adiadas. A triagem então classifica o erro de movimento, o overshoot e a saturação. A validação mais longa deve passar por todas as métricas antes que uma recomendação seja feita. A validação de uso é mantida por tempo suficiente para cobrir o tempo de acomodação permitido e um intervalo de observação constante. Os limites de aceitação são fornecidos no plano. Uma resposta malsucedida, mas válida, pode ser pontuada; amostras obsoletas, alarmes, excessos de controle, erro de seguimento excessivo, movimento de suporte, limites temperature/voltage ou falhas de registro interrompem o lote e usam a [limpeza de falha compartilhada](../../host/arm-control/README.md#checks-and-timing). Um lote com falha não fornece nenhuma recomendação.

Feedback e gravidade usam o [leitor compartilhado](../../host/arm-control/README.md#checks-and-timing). O plano estima o uso de fios e rejeita solicitações iguais ou superiores a 50% da capacidade nominal; as lacunas reais são verificadas durante a execução. A visualização lê o log.

**Alterar um perfil remove brevemente o torque desse motor.** Os motores de suporte permanecem controlados. O controlador aguarda o descanso antes da mudança e depois confirma a gravidade; veja [mudanças de perfil](../../host/arm-control/README.md#api-and-tests).

Uma retenção de ponto final já concluída é reutilizada antes de reverter a direção; a ferramenta não envia um destino de configuração duplicado nem adiciona outro atraso de configuração.

A conclusão normal restaura a linha de base configurada e mantém a retenção energizada com compensação de gravidade final. Ctrl+C interrompe o lote de ajuste e tenta torque-off; apoie o mecanismo antes de interromper. Um processo desconectado ou eliminado pode deixar o firmware mantendo seu último alvo. A ferramenta não retorna automaticamente à posição de repouso.

<a id="results-and-agent-workflow"></a>
## Resultados e fluxo de trabalho do agente

As execuções são salvas em diretórios `tools/tuning/logs/<run>/` ignorados:

- `events.ndjson`: plan/configuration exato, hashes de implementação, modelo gravitacional, calibração, alterações de perfil, comandos, medições e resultados de testes.
- `summary.json`: status de conclusão, comparações, validação e recomendação.

Envie um plano contendo vários candidatos explícitos, deixe todo o lote terminar e depois inspecione o resumo. Use os eventos brutos para critérios com falha ou resultados ambíguos. Isso evita uma rodada de processo e análise por parâmetro. Um orçamento de duração sempre limita o trabalho. Um lote incompleto não tem recomendação.

Recalcular resultados ou extrair janelas de identificação steady-motion:

```sh
npm run tune -- analyse tools/tuning/logs/RUN/events.ndjson
node tools/tuning/cli.js extract tools/tuning/logs/RUN/events.ndjson > tools/tuning/logs/dataset.json
node tools/tuning/cli.js fit tools/tuning/logs/dataset.json
```

A extração requer execuções gravity/velocity concluídas, em ambas as direções e em múltiplas velocidades, tanto na triagem quanto na validação. Rejeita janelas aceleradas, saturadas, mal medidas e moving-support. Os ajustes mantêm trajetórias inteiras separadas entre o treinamento e a validação e usam a base da gravidade do tempo de execução. Eles retornam coeficientes effort-space não revisados, não medem o torque da junta ou um modelo implantável. Atualize o modelo e repita deliberadamente as verificações de hardware independentes.

Use o [visualizador de simulação](../simulation/README.md) no mesmo arquivo de evento para inspecionar o braço durante ou após uma corrida. Não adiciona tráfego de ônibus.

<a id="tests"></a>
## Testes

Execute `npm run test:tuning` ou `npm test` para todas as ferramentas Node.js. Os testes não se conectam aos motores.
<!-- /translated-content -->
