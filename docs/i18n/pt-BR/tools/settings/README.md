<!-- translation-navigation -->
[English](../../../en/tools/settings/README.md) · [Русский](../../../ru/tools/settings/README.md) · [Español](../../../es/tools/settings/README.md) · [Français](../../../fr/tools/settings/README.md) · [Deutsch](../../../de/tools/settings/README.md) · [Português (Brasil)](README.md) · [简体中文](../../../zh-CN/tools/settings/README.md) · [日本語](../../../ja/tools/settings/README.md) · [हिन्दी](../../../hi/tools/settings/README.md) · [العربية](../../../ar/tools/settings/README.md)

[Original em inglês](../../../../../tools/settings/README.md)

> Tradução automática completa, ainda não revisada por um falante nativo. Imagens e vídeos são compartilhados; o texto neles permanece no idioma original.
<!-- /translation-navigation -->

<!-- translated-content -->
<a id="discovery-calibration-and-settings"></a>
# Descoberta, calibração e configurações

Encontre STS servos e faça backup ou restaure suas configurações legadas persistentes. Usa o driver compartilhado do repositório e a tabela de controle STS. Requer Node.js 20 ou mais recente. Execute estes comandos na raiz do repositório após `npm ci`.

<a id="discover"></a>
## Descubra

```sh
npm run settings -- discover --port /dev/cu.usbmodemYOUR_ADAPTER
```

Lista IDs de motores respondentes e alarmes relatados como JSON. A descoberta é read-only e verifica a taxa de transmissão selecionada, cujo padrão é 1,000,000. Adicione `--baud 500000` para uma taxa suportada diferente. No Linux ou Windows, use a porta do seu adaptador, como `/dev/ttyUSB0` ou `COM3`.

Os motores devem ter IDs exclusivos. O Discovery não consegue distinguir com segurança motores que compartilham um ID ou encontrar motores que usam outra taxa de transmissão.

<a id="back-up"></a>
## Backup

```sh
npm run settings -- backup --port /dev/cu.usbmodemYOUR_ADAPTER --id 2 \
  --file tools/settings/backups/servo-2.json
```

Salva a identidade do dispositivo e todas as configurações persistentes descritas pela tabela de controle compartilhada, incluindo calibração, limites, ganhos, ID e seletor de baud. O backup apenas lê o motor. Os arquivos existentes nunca são substituídos. Sem `--file`, um arquivo com carimbo de data/hora é criado em `tools/settings/backups/`, que é ignorado pelo Git.

<a id="restore"></a>
## Restaurar

Conecte apenas o motor que está sendo restaurado, desabilite o torque, bloqueie as configurações e limpe os alarmes ativos. Feche outros programas usando a porta. Use um backup do mesmo motor: restaurar a calibração de outro motor pode alterar sua posição informada.

```sh
npm run settings -- restore --port /dev/cu.usbmodemYOUR_ADAPTER --id 2 \
  --file tools/settings/backups/servo-2.json
```

`--id` e `--baud` descrevem a **conexão atual**. O backup pode restaurar uma ID ou taxa de transmissão diferente; a ferramenta acompanha essas alterações e relata a conexão final. Ele verifica a identidade do modelo, grava apenas as configurações alteradas, aguarda a conclusão de cada faixa de registro salva, lê as configurações e trava novamente o motor. Ele nunca ativa o torque ou envia um comando de movimento. Uma restauração com falha pode deixar algumas configurações alteradas; inspecione o erro antes de tentar novamente.

Esses backups abrangem configurações herdadas, não configurações de extensão ou modelo de redefinição de fábrica. Para reparo após atualizar o firmware de fábrica sobre firmware personalizado, use a [ferramenta de recuperação de configurações de fábrica](../flash/README.md#restore-factory-settings). Seus arquivos de backup usam um formato diferente e não são intercambiáveis com o JSON desta ferramenta.

<a id="calibrate-joint-offsets-and-limits"></a>
## Calibrar deslocamentos e limites conjuntos

Calibre motores 1–6 com IDs exclusivos de 1 a 253 e deslocamento de junta limitado mecanicamente. Suporta família de modelos GD32 STS 9, incluindo variantes mistas de motor, no modo de posição com um divisor de posição de 1. Feche outras ferramentas seriais.

```sh
npm run settings -- calibrate --port /dev/cu.usbmodemYOUR_ADAPTER --ids 1,2,3 \
  --file tools/settings/calibrations/arm.json
```

Substitua os IDs de exemplo pelos seus motores. Omita `--ids` para calibrar todos os motores descobertos, até seis. Uma seleção explícita deixa os outros motores conectados inalterados. Nenhum nome de junta, geometria do braço ou pose de referência padrão são assumidos.

<a id="choose-the-reference-pose"></a>
### Escolha a pose de referência

A **pose de referência de calibração** é a pose física que você captura na etapa 1. A ferramenta faz com que cada relatório motor selecionado **2048 naquela pose**. Ele não reconhece a pose, infere ângulos articulares ou calcula-os a partir da varredura posterior.

Para uma nova calibração, coloque cada junta próximo ao meio de seu percurso mecânico e escolha uma posição que você possa reproduzir. Inclui rolo de pulso e pinça; não presuma que a garra deva estar totalmente aberta ou fechada. Use a mesma postura física todas as vezes. Se o mecanismo tiver uma posição de referência documentada, siga-a. Para SO-101, o [guia de calibração LeRobot e vídeo](https://huggingface.co/docs/lerobot/so101#calibrate) mostram o posicionamento mid-travel seguido por uma varredura end-to-end.

<a id="reference-pose-images"></a>
### Imagens de pose de referência

Para uma **nova calibração**, use os guias abaixo. As etiquetas assumem os IDs usuais do motor 1–6. Coloque a base na vertical, o braço na vertical e o antebraço e a pinça apontando para a frente, conforme mostrado. Centralize a rotação da base e o giro do punho entre seus batentes mecânicos; coloque a pinça a meio caminho entre fechada e aberta. Use a viagem física para encontrar essas posições, não as contagens não calibradas.

<a id="so-101"></a>
#### SO-101

![SO-101 referência de calibração: vistas lateral e superior com todas as seis articulações rotuladas, braço vertical, antebraço para frente, rotação de pulso centralizada e half-open pinça](../../../../../tools/settings/images/so101-reference-pose.png)

<a id="so-102"></a>
#### SO-102

![SO-102 referência de calibração: vistas lateral e superior com todas as seis articulações rotuladas, braço vertical, antebraço para frente, rotação de pulso centralizada e half-open pinça paralela](../../../../../tools/settings/images/so102-reference-pose.png)

As imagens ilustram o posicionamento manual de novos deslocamentos. Eles não estabelecem compatibilidade com um modelo gravitacional ajustado existente. Os mapas do visualizador padrão também usam valores de referência wrist/gripper diferentes: atualize o mapeamento se você calibrar para essas poses. [Fontes de imagem e ângulos do modelo](images/README.md).

O deslocamento completo deve caber dentro de 0–4095 após a referência se tornar 2048: no máximo 2048 contagens abaixo da referência e 2047 acima dela. Uma junta com quase uma volta completa de deslocamento precisa de uma centralização particularmente cuidadosa. Uma pose repetível perto de uma parada final pode não deixar espaço suficiente, mesmo quando o percurso total for menor que uma curva.

Se você pretende usar um simulador ou modelo gravitacional, sua convenção de ângulo deve corresponder a esta pose física. **2048 não é automaticamente zero grau no modelo.** Consulte o [mapeamento do visualizador](../simulation/README.md#models-and-calibration) e [requisitos do modelo de gravidade](../../host/arm-control/models/README.md). Mantenha uma calibração já verificada ao reutilizar suas gravações e modelo; um flash de firmware que preserva as configurações não requer recalibração.

<a id="capture-offsets-then-limits"></a>
### Capture compensações e depois limite

Um comando orienta ambas as etapas:

1. **Pose de referência:** coloque as juntas selecionadas em uma pose repetível escolhida para o seu mecanismo. Apoie-o, fique parado e pressione **Enter**. A ferramenta grava os deslocamentos do motor para que cada junta selecionada leia **2048** na pose capturada e, em seguida, verifique os registros salvos.
2. **Limites de junta:** mova cada junta selecionada de ponta a ponta. Faça uma breve pausa em cada final; não force paradas. Revise as contagens mínimas, máximas, médias e de deslocamento em tempo real e pressione **Enter**. A ferramenta grava limites com contagens **10 de folga** dentro de cada ponto final medido.

O **Meio** da tabela é `(Min + Max) / 2`, arredondado para uma contagem inteira. É informativo: salvar limites não se move 2048 para esse ponto médio nem altera os deslocamentos. Limites assimétricos são válidos.

Se os motores forem alimentados na partida, a ferramenta solicitará que você apoie o mecanismo antes de liberar o torque. Caso contrário, existem apenas os dois prompts acima. Nenhum movimento é comandado; o torque permanece desligado e as configurações são bloqueadas após salvar.

A captura de referência utiliza a mediana de diversas leituras. Pequenos movimentos manuais não interrompem a calibração e mover-se levemente enquanto os deslocamentos são salvos não requer outra confirmação. O salvamento das configurações com falha permanece ao lado do motor afetado e tenta novamente automaticamente. A ferramenta lê novamente antes de tentar novamente uma gravação, portanto, uma confirmação ausente não faz com que as configurações already-saved sejam gravadas novamente. Os motores concluídos são mantidos; nenhuma confirmação extra é necessária.

Os deslocamentos são salvos antes da varredura e não são alterados quando os limites são salvos. Os limites podem ser assimétricos em torno de 2048. O wraparound do codificador é rastreado; um intervalo que cruza 0 ou 4095 não pode ser armazenado como limites normais e mostra `crosses zero` na coluna **Check**. Cada junta deve se mover pelo menos 64 contagens e menos de uma volta completa antes que seus limites possam ser salvos.

Erros de leitura temporários aparecem ao lado do motor afetado e são eliminados automaticamente quando as leituras válidas são retomadas. O movimento mais rápido da mão não aciona um erro speed-limit. Insira salva somente quando todos os intervalos forem válidos; caso contrário, a gravação continua com as medições retidas. Use `reset 2` para limpar apenas a faixa medida de M2 e varrer aquela junta novamente, sem repetir a etapa de referência ou outras juntas. Um zero genuíno que cruza a faixa ainda precisa corrigir seu posicionamento de referência; redefinir as medições não pode ajustar esse intervalo físico. Todos os erros do motor permanecem visíveis ao lado do motor afetado. Alarmes ou torque inesperado pausam a gravação de suas configurações até serem apagados; conexões perdidas são tentadas novamente. A sessão permanece aberta e retém o trabalho concluído. Durante novas tentativas automáticas, pressione Ctrl+C para cancelar.

O arquivo de saída é substituído em cada execução. Os backups do motor são mantidos em um diretório exclusivo em `backups/` ao lado desse arquivo e podem ser usados com `settings restore`. O relatório registra leituras de referência, deslocamentos, faixas medidas e gravações concluídas; não armazena fotografia ou ângulos físicos de articulação. Apenas `status: "verified"` significa que ambas as etapas foram concluídas.

Digite `cancel` ou pressione Ctrl+C para parar. **Os deslocamentos já salvos na etapa 1 permanecem salvos se a etapa 2 for cancelada ou falhar; os limites antigos permanecem até serem substituídos.** Conclua a calibração antes de ativar o movimento. Você pode executar novamente o mesmo comando a partir da pose de referência, sem restaurar uma calibração anterior JSON.

<a id="expected-travel-warnings"></a>
### Avisos de viagem esperados

Opcionalmente, passe `--expected-ranges FILE.json` contendo contagens e tolerâncias de deslocamento verificadas, codificadas pelo motor ID. Formato de exemplo:

```json
{"1": {"counts": 2000, "tolerance": 100}}
```

Esses números ilustram apenas o formato do arquivo. Os desvios são exibidos como avisos; pressionar Enter aceita a faixa medida. As juntas omitidas não têm verificação expected-range.

Conclua a calibração antes de gravar poses ou ajustar a compensação de gravidade. Depois de alterar os deslocamentos, registre as poses novamente e atualize ou reajuste o modelo gravitacional e o mapeamento do simulador. Nenhum dos dois é atualizado por este comando. Copiar os deslocamentos de outro braço ou alterar apenas os campos calibration-check de um modelo não estabelece a relação correta entre contagens e ângulos.

<a id="help-and-tests"></a>
## Ajuda e testes

```sh
npm run settings -- --help
npm run test:settings
```

Os testes são executados offline sem abrir uma porta serial. Os comandos saem com um status diferente de zero em caso de falha; uma lista de descoberta vazia significa que não há respostas na transmissão selecionada.
<!-- /translated-content -->
