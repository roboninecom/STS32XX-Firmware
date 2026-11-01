<!-- translation-navigation -->
[English](../en/DETAILED_DOCUMENTATION.md) · [Русский](../ru/DETAILED_DOCUMENTATION.md) · [Español](../es/DETAILED_DOCUMENTATION.md) · [Français](../fr/DETAILED_DOCUMENTATION.md) · [Deutsch](../de/DETAILED_DOCUMENTATION.md) · [Português (Brasil)](DETAILED_DOCUMENTATION.md) · [简体中文](../zh-CN/DETAILED_DOCUMENTATION.md) · [日本語](../ja/DETAILED_DOCUMENTATION.md) · [हिन्दी](../hi/DETAILED_DOCUMENTATION.md) · [العربية](../ar/DETAILED_DOCUMENTATION.md)

[Original em inglês](../../../DETAILED_DOCUMENTATION.md)

> Tradução automática completa, ainda não revisada por um falante nativo. Imagens e vídeos são compartilhados; o texto neles permanece no idioma original.
<!-- /translation-navigation -->

<!-- translated-content -->
<a id="detailed-documentation"></a>
# Documentação detalhada

Comece com o guia **[Início rápido](QUICKSTART.md)** para gravar o firmware, testar, reproduzir e compensar a gravidade. Veja [tools](tools/README.md) para guias de comandos individuais.

Firmware para servos GD32F130-based STS3215, com duas formas de controlar o motor:

- **Modo legado** usa os comandos STS padrão para posição, velocidade e potência do motor. Ele está habilitado por padrão.
- **Modo de extensão** adiciona movimento suave, controle de posição ajustável e compensação de movimento e gravidade. O computador conectado envia configurações e destinos; cada servo calcula seu movimento localmente.

Este documento explica como os recursos funcionam e, em seguida, fornece o comando e a referência de registro para o **protocolo de extensão v9.0**. As configurações de extensão são mantidas na memória temporária e devem ser enviadas novamente após uma reinicialização ou ciclo de energia. O software de controle deve suportar a versão 9; clientes de extensão mais antigos não são compatíveis.

- [Modo legado](#legacy-mode)
- [Como funciona o modo de extensão](#how-extension-mode-works)
- [S-curve movimento](#s-curve-motion)
- [Posições de referência de calibração](#calibration-reference-poses)
- [PID controlador](#pid-controller)
- [Velocidade feedforward](#velocity-feedforward)
- [Compensação de gravidade](#gravity-compensation)
- [Iniciando e parando o modo de extensão](#starting-and-stopping-extension-mode)
- [Protocolo de extensão](#extension-protocol)
- [Registros de extensão](#extension-registers)
- [Construir e verificar](#build-and-verification)
- [Layout do repositório](#repository-layout)
- [Limites atuais](#current-limits)

<a id="legacy-mode"></a>
## Modo legado

O modo legado suporta a interface de registro padrão STS, incluindo potência do motor, modo de operação, comandos de posição e velocidade e leituras de status. O software STS existente pode usar registros **0–86** sem habilitar a extensão.

Nos modos de posição legados, ativar a potência do motor sem um novo comando de posição mantém a posição medida, mesmo fora dos limites salvos. Ele não reproduz um alvo antigo nem move a haste para o limite mais próximo. Novos comandos de posição ainda estão limitados aos limites salvos.

A extensão usa suas próprias configurações de movimento e controle. Os valores de ganho não devem ser copiados diretamente entre os dois modos porque suas escalas são diferentes. O suporte para comandos padrão não garante comportamento físico idêntico em todos os modelos de servo.

<a id="how-extension-mode-works"></a>
## Como funciona o modo de extensão

[Assista à visão geral gravada no YouTube](https://youtu.be/AsxFs24vXQs) | [MP4](../../../assets/readme/videos/overview.mp4)

O **host** é o computador ou controlador conectado aos servos. Ele envia um **alvo**: um destino e limite de velocidade. As configurações de aceleração e compensação são configuradas antes de habilitar a alimentação do motor. Cada servo então:

1. Planeja um movimento suave em direção ao destino.
2. Mede sua posição e estima sua velocidade.
3. Ajusta a saída do motor para seguir o movimento planejado.
4. Mantém o destino quando o movimento termina.

A posição e velocidade planejadas em qualquer momento são chamadas de **referência**. O controlador compara-os com o movimento medido, portanto uma posição de referência e uma posição real podem diferir.

Alguns termos usados ao longo deste documento:

| Prazo | Significado |
| --- | --- |
| Contagem de codificadores | Uma unidade de medição de posição; nominalmente 4096 contagens por revolução |
| Esforço | O comando motor-output assinado: seu sinal define a direção e seu tamanho define a força de saída |
| Ganho | Uma configuração que determina a intensidade com que o controlador responde |
| Avançar | Saída extra do motor calculada a partir da demanda esperada, em vez de esperar por um erro de posição ou velocidade |
| Comentários | Medições e status retornados pelo servo |
| Cadastre-se | Uma configuração ou leitura identificada por um número |
| Sessão | Um período de controle de extensão, identificado por um número fornecido pelo host |

O esforço é expresso em unidades PWM, as unidades usadas para controlar a saída elétrica do motor. A extensão permite um limite de saída de até **1000** em qualquer direção. Esses valores não são medições diretas de torque ou corrente.

<a id="s-curve-motion"></a>
## S-curve movimento

[![Ilustração conceitual de s-curve movimento](../../../assets/readme/illustrations/s-curve.png)](https://youtu.be/92mDt4rbobY)

[Assistir no YouTube](https://youtu.be/92mDt4rbobY) | [MP4](../../../assets/readme/videos/s-curve.mp4)

Torna a aceleração e a travagem mais graduais. A curva ilustra a aceleração ao longo do tempo. Ilustração conceitual, não dados de hardware medidos.

Um S-curve faz a aceleração aumentar e diminuir gradualmente. Em vez de aplicar repentinamente aceleração ou frenagem total, o servo entra e sai de cada parte do movimento. Isso pode reduzir solavancos mecânicos e vibrações.

Um movimento completo de repouso a repouso tem estes estágios:

| Palco | O que acontece |
| --- | --- |
| 1 | A aceleração aumenta gradualmente |
| 2 | O servo acelera a uma taxa constante |
| 3 | A aceleração diminui gradualmente até zero |
| 4 | O servo se move a uma velocidade constante |
| 5 | A frenagem aumenta gradualmente |
| 6 | O servo freia a uma taxa constante |
| 7 | A frenagem diminui gradualmente à medida que o servo para |

Movimentos curtos pulam etapas quando não há distância suficiente para atingir a velocidade ou aceleração solicitada. O mesmo limite de aceleração se aplica ao acelerar e desacelerar.

A configuração `ramp_time_ms` controla quanto tempo a aceleração leva para subir de zero até seu limite. Uma rampa mais longa proporciona uma mudança mais suave, mas geralmente requer mais tempo e distância para acelerar ou parar.

**Jerk** significa a taxa na qual a aceleração muda. Este planejador limita os solavancos, para que a aceleração mude suavemente. O próprio Jerk ainda pode mudar abruptamente entre os estágios. Sua magnitude aproximada é:

```text
jerk = 1000 × acceleration / ramp_time_ms    [counts/s³]
```

<a id="changing-a-destination-during-movement"></a>
### Alterar um destino durante o movimento

Um novo alvo continua a partir do movimento planejado atual, preservando sua posição, velocidade e aceleração. Enviar novamente o mesmo destino não reinicia a movimentação. Mantenha o mesmo limite de velocidade solicitado enquanto se desloca; ele pode mudar para o próximo movimento assim que o movimento planejado for interrompido. A aceleração e o tempo de rampa pertencem à configuração e requerem o desligamento do motor e uma sessão desarmada para serem alterados.

Um destino fora dos limites de posição Legacy salvos é **ajustado ao limite mais próximo**. A velocidade solicitada também é limitada ao valor configurado. O servo usa a aceleração configurada em cada movimento. Velocidade zero ou aceleração configurada igual a zero são inválidas.

Todo o movimento planejado deverá ficar dentro dos limites de posição. Um novo alvo pode, portanto, ser rejeitado se o servo já estiver se aproximando de um limite rápido demais para parar dentro dele, mesmo quando o próprio destino for permitido.

Na chegada, o servo mantém automaticamente o destino com o motor ligado. A posição medida ainda pode apresentar algum erro devido ao atrito, carga, limites de saída ou ajuste. Segurar continua a corrigir o erro de posição; não congela a saída do motor em um valor fixo.

Cada servo planeja seu próprio movimento. Enviar vários alvos juntos não garante que todos os servos chegarão ao mesmo tempo.

<a id="shared-position-limits"></a>
### Limites de posição compartilhada

O controle legado e de extensão usam os mesmos registros position-limit: **9–10** contém o mínimo e **11–12** o máximo. Cada um é um valor não assinado de 16 bits nas contagens corrigidas do encoder, incluindo a direção configurada do servo e a correção de posição. Não há configurações de extensão position-limit separadas.

A calibração atribui contagens de codificador a posições físicas. A [ferramenta de calibração](tools/settings/README.md#choose-the-reference-pose) faz com que a pose de referência capturada seja lida como 2048 e, em seguida, mede os limites de deslocamento. Essa contagem não é automaticamente um ângulo de articulação zero-degree e o ponto médio do percurso medido não substitui a referência capturada. Modelos gravitacionais e visualizações precisam de um mapeamento count-to-angle correspondente.

O firmware lê esses registros ao iniciar o controle. Com os limites habilitados, o mínimo deve ser menor que o máximo, o máximo não pode ultrapassar 32767 e a posição medida deve estar dentro do intervalo. Caso contrário, a inicialização falha sem movimentar o motor. O planejador mantém todo o movimento, incluindo a frenagem, dentro do intervalo lido.

**Valores mínimos e máximos iguais desativam os limites de viagem**, correspondendo ao comportamento legado. Os comandos de extensão ainda permanecem dentro da faixa de posição suportada de −32767 a 32767 contagens.

Uma gravação aceita em qualquer um dos limites encerra uma sessão de extensão ativa e desliga a alimentação do motor, incluindo gravações que são aplicadas apenas em RAM. Arme uma nova sessão para usar os valores alterados. A persistência normal das configurações herdadas ainda se aplica.

<a id="calibration-reference-poses"></a>
## Poses de referência de calibração

Para uma nova calibração SO-101 ou SO-102, use as posições conjuntas ilustradas. Centralize a base e o rolo de pulso entre seus batentes e deixe a pinça até a metade aberta. A ferramenta de calibração salva esta pose colocada manualmente como 2048 para cada motor. Mantenha uma calibração verificada existente ao reutilizar suas gravações e modelo gravitacional.

**SO-101 pose de referência**

[![SO-101 pose de referência com seis juntas rotuladas](../../../tools/settings/images/so101-reference-pose.png)](../../../tools/settings/images/so101-reference-pose.png)

**SO-102 pose de referência**

[![SO-102 pose de referência com seis juntas rotuladas](../../../tools/settings/images/so102-reference-pose.png)](../../../tools/settings/images/so102-reference-pose.png)

Abra uma imagem para ampliá-la. Siga o [guia de calibração](tools/settings/README.md#reference-pose-images) para o procedimento two-step e requisitos model-mapping.

<a id="pid-controller"></a>
## PID controlador

[![Ilustração conceitual do controle pid](../../../assets/readme/illustrations/pid-tuning.png)](https://youtu.be/TEpvaAMlfrg)

[Assistir no YouTube](https://youtu.be/TEpvaAMlfrg) | [MP4](../../../assets/readme/videos/pid-tuning.mp4)

Ajusta como o servo corrige o erro de posição. A curva cinza ilustra a oscilação; a curva branca ilustra uma resposta mais amortecida. A linha tracejada é o alvo. Ilustração conceitual, não dados de hardware medidos.

O controlador PID ajusta a saída do motor para seguir o movimento planejado. Suas três configurações têm funções diferentes:

| Configuração | O que isso faz | Compensação principal |
| --- | --- | --- |
| **P — correção de posição** | Puxa o motor em direção à posição planejada; erros maiores produzem mais correção | P mais alto pode reduzir o erro, mas também pode causar oscilação |
| **I — correção acumulada** | Cria correção extra quando um erro persiste | Pode reduzir um erro duradouro, mas pode aumentar o overshoot ou o tempo de acomodação |
| **D — correção de velocidade** | Responde à diferença entre velocidade planejada e medida; resiste ao movimento enquanto segura | Pode melhorar o amortecimento, mas a resposta excessiva a leituras de velocidade ruidosas pode tornar a saída irregular |

O cálculo é:

```text
position error = planned position − measured position
speed error = planned speed − filtered measured speed

motor output = Kp × position error
             + Kd × speed error
             + accumulated I correction
             + gravity compensation
             + velocity feedforward
```

O resultado é limitado à saída máxima configurada. A proteção do motor pode reduzi-lo ainda mais. O feedback informa a saída solicitada e aplicada para que o host possa ver quando o motor está sendo limitado.

A velocidade medida é suavizada usando leituras de posição recentes e um filtro ajustável. Uma configuração `velocity_filter_q8` maior responde mais rapidamente às alterações, mas remove menos ruído de medição.

<a id="preventing-excessive-accumulated-correction"></a>
### Prevenindo correção acumulada excessiva

A contribuição I tem seu próprio limite. O controlador também impede que continue a construir numa direção onde a potência do motor já está limitada; isso é comumente chamado de **anti-windup**. Ainda pode diminuir para ajudar o motor a se recuperar desse limite. Definir `Ki` como zero desativa e limpa a correção I.

Quando o servo estiver quase estacionário por pelo menos 50 ms e o erro de posição estiver dentro de uma contagem do encoder, I para de acumular. P, D e ambas as formas de feedforward permanecem ativas. Desligar a saída do motor limpa a correção I.

<a id="velocity-feedforward"></a>
## Velocidade feedforward

[![Ilustração conceitual de feedforward de velocidade](../../../assets/readme/illustrations/velocity-feedforward.png)](https://youtu.be/osGGs-nhk9I)

[Assistir no YouTube](https://youtu.be/osGGs-nhk9I) | [MP4](../../../assets/readme/videos/velocity-feedforward.mp4)

Adiciona a saída do motor com base na velocidade planejada, calculada dentro do servo. Ambas as curvas progridem da esquerda para a direita ao longo do tempo. Ilustração conceitual, não dados de hardware medidos.

O feedforward de velocidade fornece parte da saída que se espera que seja necessária para o movimento antes que um erro de rastreamento se desenvolva. É calculado **dentro do servo** a partir da velocidade planejada:

```text
velocity feedforward = velocity gain × planned speed
```

Há um ganho para cada direção e um limite na saída resultante. Ambos os ganhos não são negativos; a direção do movimento determina o sinal de saída. Seu limite de saída não deve ser maior que o limite principal motor-output.

Como o servo conhece sua própria velocidade planejada, a compensação segue a aceleração e a frenagem automaticamente e torna-se zero quando o movimento planejado para. O host fornece apenas suas configurações; não é necessário enviar valores velocity-feedforward contínuos.

Configure este recurso junto com as outras configurações em `0xA0`, enquanto a alimentação do motor estiver desligada e a sessão desarmada. Defina os ganhos e seu limite de saída como zero para desativá-lo.

<a id="gravity-compensation"></a>
## Compensação de gravidade

[![Ilustração conceitual da compensação de gravidade](../../../assets/readme/illustrations/gravity-compensation.png)](https://youtu.be/25sc41PTDIA)

[Assistir no YouTube](https://youtu.be/25sc41PTDIA) | [MP4](../../../assets/readme/videos/gravity-compensation.mp4)

O host calcula a contribuição e o servo a aplica. A seta para baixo representa o peso; a seta para cima representa suporte. Ilustração conceitual, não dados de hardware medidos.

A compensação de gravidade fornece a saída necessária para suportar o peso de um braço e sua carga. É útil mesmo quando o motor está parado, onde o feedforward de velocidade é zero.

O **host calcula a compensação de gravidade** e envia um valor de saída assinado para cada servo. O cálculo pode usar ângulos de junta, dimensões de braço, pesos de link e carga útil. O host deve converter a carga estimada nas unidades de saída do servo. O firmware não contém um modelo do braço.

A direção é importante: a saída de extensão positiva segue contagens crescentes de codificadores. A convenção joint-angle de um braço pode ocorrer na direção oposta, então a conversão do host deve levar em conta isso.

Cada atualização de gravidade contém o valor de saída desejado. A **taxa de variação** – a rapidez com que a compensação pode mudar, em unidades de saída por segundo – faz parte da configuração principal e permanece fixa durante toda a sessão.

O servo muda gradualmente sua compensação em direção ao valor solicitado e adiciona-o à saída do controlador. Todas as contribuições juntas permanecem sujeitas ao limite de saída configurado e à proteção do motor.

**Se as atualizações de gravidade pararem de chegar, o servo continuará em direção à última compensação solicitada em sua taxa de variação configurada e, em seguida, manterá esse valor.** Não há temporizador de expiração. O anfitrião deve atualizar a compensação quando a postura do braço ou a carga mudarem. Definir o registro torque-enable **40** para zero limpa a compensação e desliga a saída do motor.

<a id="starting-and-stopping-extension-mode"></a>
## Iniciando e parando o modo de extensão

A sequência a seguir usa os números de registro e comandos documentados posteriormente. A seleção prepara uma sessão; habilitar a potência do motor inicia o controle.

1. Encontre os IDs dos servos conectados e leia as capacidades de cada servo. Verifique `ARMC` e versão `9.0`. Repita esta verificação após uma reinicialização ou alteração de firmware.
2. Desligue a alimentação do motor configurando o registro legado torque-enable **40** para `0`. Conclua qualquer sessão existente e aplique quaisquer configurações herdadas permanentes.
3. Escreva e leia a configuração completa (`0xA0`), incluindo configurações de feedforward de velocidade e taxa de variação da gravidade.
4. Escreva `mode=1` e um novo número de sessão diferente de zero em `0xB8` (3 bytes no total). Isto seleciona o modo de extensão e prepara a próxima partida; a energia permanece desligada.
5. Defina o registro **40** como `1`. O firmware verifica os sensores, o status da proteção, a configuração e os limites de posição salvos e, em seguida, captura a posição medida como o alvo de retenção inicial. Contadores de comando, correção I e compensação de gravidade começam em zero. Leia `0xC1` e aguarde a sessão correta, medições atuais utilizáveis, acionamento do motor habilitado e saída pronta.
6. Envie alvos e quaisquer atualizações de gravidade. Leia o feedback para verificar quais comandos foram aceitos e até que ponto o servo os segue.
7. O servo termina seu último movimento e mantém o destino até receber um novo alvo. Defina o registro **40** como `0` para desligar o motor e encerrar a sessão. Para retornar ao modo legado, mantenha a energia desligada e escreva `mode=0, session=0` em `0xB8`.

Se uma inicialização falhar, o registro **40** retorna para `0`. Seu reconhecimento de gravação normal por si só não confirma a inicialização bem-sucedida: verifique a leitura e o feedback do registro. Cada tentativa de início consome a sessão preparada. Após uma falha na partida, torque-off ou desligamento da proteção, corrija a causa e escreva `0xB8` com um novo número de sessão antes de habilitar o torque novamente. A repetição da habilitação de torque enquanto o controle está em execução preserva seus contadores de alvo, compensação e comando.

Os comandos que movem ou ajustam um motor energizado requerem hardware pronto, nenhuma falha relatada e leituras de sensor com no máximo **2 ms** de idade. O controlador normalmente atualiza a cada **1 ms** e aceita intervalos de até 2 ms. Intervalos mais longos fazem com que a saída do motor seja desativada.

Ao usar a extensão, evite gravações legadas no registro de modo de operação **33** ou registros de movimento **41–47**: eles desligam a alimentação do motor e saem do modo de extensão. Salvar configurações permanentes também encerra o controle de extensão. Definir o registro **40** para `0` deixa o modo de extensão selecionado, pronto para outra configuração de sessão.

<a id="if-host-commands-stop-arriving"></a>
### Se os comandos do host pararem de chegar

O servo termina o último movimento aceito e continua mantendo esse destino. A compensação gravitacional continua em direção ao último valor solicitado e permanece nesse valor. Nenhuma mensagem repetida é necessária para manter a sessão ativa, e a perda de comunicação com o host não altera o alvo nem desliga a energia do motor.

Para mudar para onde o servo vai, envie outro alvo. Para liberar o motor, ajuste a habilitação de torque para zero. As verificações de atualização do sensor, a proteção do motor e o watchdog do firmware permanecem ativos durante o movimento e a retenção.

<a id="extension-protocol"></a>
## Protocolo de extensão

Esta seção descreve as mensagens exatas trocadas entre o host e o servo. Destina-se a leitores que conectam seu próprio software.

<a id="message-format-and-number-encoding"></a>
### Formato de mensagem e codificação de número

Cada mensagem é um pacote: uma sequência de bytes contendo o destino, o comando, os dados e uma soma de verificação usada para detectar erros de transmissão. Os comandos de extensão usam o formato de pacote padrão STS:

```text
Request:  FF FF ID LENGTH INSTRUCTION PARAMETERS... CHECKSUM
Response: FF FF ID LENGTH LEGACY_ERROR EXT_STATUS DATA... CHECKSUM
```

- Solicitação `LENGTH = parameter_bytes + 2`.
- Resposta `LENGTH = data_bytes + 3`; o status da extensão ocupa o primeiro parâmetro de resposta, separadamente do byte de erro herdado normal.
- `CHECKSUM = ~(ID + LENGTH + instruction_or_error + all_parameter_bytes) & 0xFF`. A soma da resposta inclui `EXT_STATUS` e quaisquer dados.
- Um campo que ocupa vários bytes envia primeiro o byte menos significativo (**little-endian**). Por exemplo, o número 256 é enviado como `00 01` em dois bytes.
- `u8`, `u16` e `u32` são números inteiros não negativos que ocupam 1, 2 e 4 bytes. `i16` e `i32` ocupam 2 e 4 bytes e também podem representar números negativos. Os valores de extensão assinada usam **complemento de dois**: por exemplo, −1 é `FF FF` em um campo `i16`. Isso difere da codificação herdada de valores assinados.
- **Q8** significa que um valor é multiplicado por 256 antes da transmissão para que as frações possam ser representadas como números inteiros. Divida por 256 ao ler. Por exemplo, a contagem da posição 1000 é enviada como 256000 e o ganho 4.5 é enviado como 1152.
- A posição está nas contagens do codificador e a velocidade está em counts/s. O host lida com qualquer conversão em ângulos de junta, incluindo mudanças de direção ou posição zero.
- **Unicast** significa uma mensagem endereçada a um servo. **Broadcast** usa ID `0xFE` e atinge todos os servos. Os comandos de extensão de transmissão nunca geram respostas.

Exemplo: leia o bloco de capacidades de 8 bytes do servo ID 1:

```text
FF FF 01 04 90 90 08 D2
```

Um **seletor** identifica um bloco de registro completo, como configuração ou feedback. Acesse-o com a extensão READ/WRITE e o tamanho exato do bloco listado abaixo. Ler ou escrever apenas parte de um bloco não é suportado e os comandos READ/WRITE legados não podem acessar esses blocos.

<a id="instructions"></a>
### Instruções

Os tamanhos dos parâmetros abaixo excluem o cabeçalho do pacote e a soma de verificação. Em resposta, `EXT_STATUS` informa se o comando de extensão foi bem-sucedido, separadamente de `LEGACY_ERROR`, o byte de erro normal do servo. Uma leitura bem-sucedida adiciona os dados solicitados após `EXT_STATUS`; gravações, outros comandos e leituras com falha não possuem dados extras.

| Instrução | Nome | Parâmetros | Transmitir |
| --- | --- | --- | --- |
| `0x90` | READ | `selector:u8, count:u8` | Nenhuma resposta útil |
| `0x91` | WRITE | `selector:u8, block...` | Não aceito |
| `0x99` | GRAVITY | 6 bytes, abaixo | Não aceito |
| `0x9A` | TARGETS | `session:u16` + 1–6 entradas de 9 bytes | Aceito |

Números de instrução `0x92`, `0x93`, `0x94`, `0x95`, `0x96`, `0x97` e `0x98` e seletores `0xA1`, `0xA3`, `0xB0`, `0xBA`, `0xE0` e `0xF0`, são reservados e não devem ser usados.

| Status da extensão | Significado |
| --- | --- |
| `0` | OK |
| `1` | Comprimento, seletor ou valor de campo inválido |
| `2` | O comando não pode ser aceito no estado atual |
| `3` | Reservado |
| `4` | Reservado |
| `5` | Instrução não suportada |

Uma incompatibilidade de sessão retorna uma falha de estado. Inspecione o byte de erro herdado e o status da extensão.

<a id="sessions-and-sequence-numbers"></a>
### Sessões e números de sequência

O host atribui a cada sessão um número de 1 a 65535 e o inclui nos comandos de controle. Isto permite ao servo verificar se um comando pertence à sessão atual. Escolha um novo número para cada startup; os números de configuração não são armazenados permanentemente.

Um **número de sequência** conta os comandos aceitos em ordem, permitindo que o host e o servo identifiquem comandos ausentes, repetidos ou out-of-order.

TARGETS possui um contador de sequência de movimento per-servo. GRAVITY possui um contador separado. Ambos iniciam em zero quando a habilitação de torque inicia o controle; normalmente envie **1** primeiro. Os números aumentam até 65535 e depois passam para **0**, sem encerrar a sessão. Lacunas são permitidas: após 10, o servo pode aceitar 12 mesmo que 11 tenha sido perdido ou rejeitado. Números iguais ou mais antigos são rejeitados sem alterar o comando atual.

Para uma comparação exata, calcule `distance = (incoming − accepted) & 0xFFFF`. Um comando é mais recente somente quando `1 ≤ distance ≤ 32767`. Um salto de exatamente 32768 é ambíguo e rejeitado. Mantenha a lacuna do último comando aceito abaixo de 32768; se o histórico do comando for incerto, desligue o torque, prepare uma nova sessão ID e habilite o torque novamente. Não reutilize pacotes enfileirados de uma sessão anterior ou de um ciclo de contador.

A aceitação ainda requer campos válidos, leituras atuais do sensor e um movimento viável. Um comando rejeitado não avança seu contador. Esses comandos substituem alvos absolutos; eles não são uma fila de waypoints. Para visitar todos os pontos de passagem, aguarde cada chegada antes de enviar o próximo destino.

Ao enviar um alvo de grupo, leia o feedback de cada servo para verificar sua sequência aceita. Cada servo decide independentemente se pode aceitar seu alvo; um pode rejeitá-lo enquanto os outros começam a se mover.

<a id="targets--0x9a"></a>
### TARGETS — `0x9A`

Os primeiros dois bytes de parâmetro contêm a sessão compartilhada. Cada entrada seguinte possui este layout; os deslocamentos são relativos ao início dessa entrada:

| Deslocamento | Tipo | Campo |
| --- | --- | --- |
| 0 | `u8` | Servo ID, 1–253 |
| 1 | `u16` | Sequência de movimento mais recente para este servo |
| 3 | `i32` | Posição de destino, Q8 conta |
| 7 | `u16` | Velocidade máxima, counts/s, diferente de zero |

O comprimento do parâmetro é `2 + 9 × entry_count`, no máximo 56 bytes. Os IDs devem ser exclusivos. Cada servo verifica o formato e os campos obrigatórios de **todas** as entradas antes de manipular as suas próprias. Um servo que não está listado não faz nada. Um servo listado verifica sua sessão, sequência, prontidão e se o movimento pode permanecer dentro de seus limites. Um alvo aceito inicia imediatamente e permanece ativo até ser substituído ou desarmado. Os valores são limitados aos limites configurados conforme descrito em S-curve movimento.

<a id="gravity--0x99"></a>
### GRAVITY — `0x99`

| Deslocamento | Tipo | Campo/restrição |
| --- | --- | --- |
| 0 | `u16` | Sessão atual |
| 2 | `u16` | Sequência de gravidade mais recente |
| 4 | `i16` | Esforço de gravidade desejado; magnitude ≤ limite de saída configurado |

O comprimento do parâmetro é exatamente 6 bytes. Requer uma sessão armada com o motor ligado, hardware pronto, nenhuma falha relatada e leituras recentes do sensor. Não avança a sequência de movimento. O valor solicitado permanece ativo até ser substituído ou desarmado.

<a id="extension-registers"></a>
## Registros de extensão

Um **offset** é o byte inicial de um campo, contando a partir de zero dentro de seu bloco. Os deslocamentos abaixo são decimais; seletores usam notação hexadecimal (`0x...`). Todas as gravações usam a instrução `0x91`; lê use `0x90` com a contagem exata de bytes.

| Seletor | Bloquear | Acesso | Bytes |
| --- | --- | --- | --- |
| `0x90` | Capacidades | Leia | 8 |
| `0xA0` | Configuração | Read/write | 24 |
| `0xB8` | Seleção do controlador e configuração da sessão | Escreva | 3 |
| `0xC1` | Feedback operacional | Leia | 32 |
| `0xC2` | Feedback de ajuste | Leia | 54 |

<a id="capabilities--0x90"></a>
### Capacidades — `0x90`

| Deslocamento | Tipo | Valor/significado |
| --- | --- | --- |
| 0–3 | 4 bytes | ASCII `ARMC` |
| 4 | `u8` | Versão principal: 9 |
| 5 | `u8` | Versão secundária: 0 |
| 6 | `u8` | Reservado: 0 |
| 7 | `u8` | Intervalo normal de atualização do controlador: 1 ms |

A versão do protocolo define os blocos disponíveis e seus comprimentos exatos. A seleção e a configuração da sessão compartilham um bloco write-only, documentado abaixo.

<a id="configuration--0xa0"></a>
### Configuração — `0xA0`

| Deslocamento | Tipo | Campo | Unidades/intervalo válido |
| --- | --- | --- | --- |
| 0 | `u16` | `kp_q8` | Ganho × 256; 0–65535 |
| 2 | `u16` | `kd_q8` | Ganho × 256; 0–65535 |
| 4 | `u16` | `ki_q8` | Ganho × 256; 0–65535 |
| 6 | `u16` | `integral_limit` | Esforço; 0–`effort_limit` |
| 8 | `u16` | `effort_limit` | Esforço; 1–1000 |
| 10 | `u16` | `velocity_limit` | Counts/s; 1–65535 |
| 12 | `u16` | `acceleration_limit` | Counts/s²; 1–30000 |
| 14 | `u8` | `velocity_filter_q8` | Speed-filter resposta; 1–255, maior responde mais rápido |
| 15 | `u8` | `ramp_time_ms` | Rampa de aceleração; 1–255ss |
| 16 | `u16` | `velocity_ff.positive_gain_q8` | Saída/(count/s) × 256; 0–65535 |
| 18 | `u16` | `velocity_ff.negative_gain_q8` | Saída/(count/s) × 256; 0–65535 |
| 20 | `u16` | `velocity_ff.effort_limit` | Esforço; 0–principal `effort_limit` |
| 22 | `u16` | `gravity_slew` | Mudança de remuneração, esforço units/s; 1–10000 |

Os ganhos são enviados como o valor desejado multiplicado por 256. Suas unidades são output/count para P, saída/(count/s) para D e saída/(contagem·s) para I. Por exemplo, P = 4.5 produz 4.5 unidades de saída por contagem de erro e é enviado como 1152.

O servo possui **uma configuração ativa**. Escrevê-lo requer desligamento do motor e uma sessão desarmada. Cada gravação substitui toda a configuração, incluindo configurações de feedforward. Configurações inválidas rejeitam toda a gravação sem alterar nada. Leia `0xA0` para verificar as configurações que foram aceitas.

Velocity-feedforward os ganhos não são negativos. Um limite de saída feedforward zero exige que ambos os ganhos sejam zero. O mesmo limite de saída feedforward se aplica em ambas as direções e não deve exceder o limite de saída principal.

Após um reset, configure o servo antes de habilitar a alimentação do motor. Mantenha as configurações salvas e os valores de ajuste alternativos no host; alterar os ganhos entre corridas com o braço apoiado e o motor desligado.

<a id="selection-and-session-setup--0xb8"></a>
### Seleção e configuração da sessão — `0xB8`

| Deslocamento | Tipo | Significado |
| --- | --- | --- |
| 0 | `u8` | Modo: `0` legado, `1` extensão |
| 1 | `u16` | Sessão: `0` para legado, `1–65535` para extensão |

O comprimento exato da carga útil é **3 bytes**, com a sessão na ordem little-endian. Por exemplo, o modo de extensão com sessão `0x1234` é `01 34 12`; o modo legado é `00 00 00`. Combinações inválidas rejeitam toda a gravação sem alterar o estado. Ambos os modos exigem o desligamento do motor e substituem qualquer configuração de sessão anterior. A seleção por si só não inicia o controle nem captura uma posição de retenção.

Registro torque-enable legado **40** inicia a sessão de extensão preparada quando gravado em `1`. Ele requer saída de motor disponível, uma configuração válida, sensores inicializados com leituras de no máximo 2 ms, nenhuma falha que exija desligamento e limites de posição legados salvos utilizáveis. A posição medida deve estar dentro desses limites quando eles estiverem habilitados. Essas verificações acontecem no momento da habilitação, portanto movimentos ou falhas entre a configuração e a habilitação são levados em consideração.

Torque-off cancela o controle em execução e a configuração não utilizada. Falhas no sensor, desligamento da proteção, alterações de position-limit ou encoder-offset, calibração e salvamento de configurações permanentes também invalidam a configuração da sessão. Leia o feedback para verificar se o controle foi realmente iniciado; não há comando ARM separado. O antigo seletor `0xBA` e a antiga carga útil de seleção one-byte são rejeitados.

<a id="operational-feedback--0xc1"></a>
### Feedback operacional — `0xC1`

| Deslocamento | Tipo | Campo/unidades |
| --- | --- | --- |
| 0 | `u32` | Tempo de medição, ms desde a inicialização; retorna a zero após 4294967295 |
| 4 | `u16` | Número de medição; retorna a zero após 65535 |
| 6 | `u16` | Sessão |
| 8 | `u16` | Sequência alvo aceita |
| 10 | `u16` | Sequência gravitacional aceita |
| 12 | `u16` | Bandeiras, abaixo |
| 14 | `i32` | Posição medida, Q8 contagens |
| 18 | `i32` | Velocidade medida filtrada, Q8 counts/s |
| 22 | `i16` | Saída aplicada; positivo segue contagens crescentes de codificadores |
| 24 | `i16` | Current-sensor leitura relativa à sua linha de base; não amperes |
| 26 | `u8` | Tensão de alimentação, unidades 0.1 V |
| 27 | `u8` | Temperatura validada, °C |
| 28 | `u8` | Servo legado fault/status sinalizadores |
| 29 | `u8` | Reservado: zero |
| 30 | `u16` | Idade da medição no momento da leitura, ms; valor máximo relatado 65535 |

| Bit de bandeira | Significado quando definido |
| --- | --- |
| 0 | A amostra é fresca e utilizável para o estado atual de controle do braço |
| 1 | Controlador ativo |
| 2 | Reservado: zero |
| 3 | Saída do motor limitada |
| 4 | Acionamento do braço ativado |
| 5 | Sessão iniciada por ativação de torque |
| 6 | Reservado: zero |
| 7 | Saída pronta |
| 8 | Um comando de gravidade foi recebido |
| 9 | Reservado: zero |
| 10 | Temperatura validada disponível |
| 11 | Reservado: zero |
| 12 | Alvo de movimento ativo |
| 13 | Reservado: zero |
| 14 | Controlador de braço selecionado |
| 15 | Reservado: zero |

Cada sinalizador é um bit: o bit 0 tem valor 1, o bit 1 tem valor 2, o bit 2 tem valor 4 e assim por diante. Vários sinalizadores podem ser definidos de uma só vez. Um controlador ativo com bit 12 limpo está mantendo seu destino. Um bit de movimento claro por si só não significa que o motor esteja ligado ou pronto.

O feedback descreve uma medição registrada. Se o estado do servo mudar antes que o host o leia, alguns campos poderão descrever o estado anterior. O bit 0 é apagado quando a medição ultrapassa 2 ms, o controlador não está mais selecionado, armado, em condução ou pronto, ou seus números session/sequence não correspondem mais. Verifique o bit 0, idade, sessão e sequência aceita juntos.

As leituras de posição e integridade também estão disponíveis no modo legado e com o motor desligado. Os campos de controle indisponíveis são zero. A sequência de amostras avança quando as medições são adquiridas, e não sempre que o host as lê. Ele distingue amostras que compartilham o mesmo carimbo de data/hora em milissegundos. Grandes mudanças inesperadas de temperatura são verificadas em diversas leituras antes de aparecerem aqui; veja a limitação de proteção abaixo.

<a id="tuning-feedback--0xc2"></a>
### Feedback de ajuste — `0xC2`

Os bytes 0–31 têm exatamente o layout `0xC1`. Os bytes restantes são:

| Deslocamento | Tipo | Campo/unidades |
| --- | --- | --- |
| 32 | `i32` | Posição de referência, Q8 contagens |
| 36 | `i32` | Velocidade de referência, Q8 counts/s |
| 40 | `i16` | Saída solicitada após seu limite configurado, antes da proteção do motor |
| 42 | `i16` | Contribuição P, esforço |
| 44 | `i16` | D contribuição, esforço |
| 46 | `i16` | Contribuição integral, esforço |
| 48 | `i16` | Compensação de gravidade aplicada atualmente, esforço |
| 50 | `i16` | Feedforward de velocidade local, esforço |
| 52 | `u16` | Atraso extra acumulado do controlador, ms; máximo 65535 |

O contador de atraso adiciona o tempo extra sempre que uma atualização do controlador leva mais do que o normal 1 ms (`elapsed_ms − 1`). Não conta mensagens perdidas. As contribuições P e D relatadas são limitadas a ±32767, portanto, a adição dos valores exibidos pode não reproduzir o cálculo interno completo.

O servo envia feedback somente quando solicitado. Use `0xC1` para monitoramento normal e `0xC2` quando o ajuste precisar de valores adicionais. A leitura de `0xC2` já inclui todo o `0xC1`, portanto, a leitura de ambos adiciona tráfego desnecessariamente. Leituras separadas podem referir-se a momentos diferentes; compare seus carimbos de data e hora e números de amostra.

<a id="build-and-verification"></a>
## Construção e verificação

Fontes de firmware, testes e regras de construção estão em [`firmware/`](firmware/README.md). Depois de instalar o [toolchain](firmware/README.md#build-and-verify), execute:

```sh
make
make verify
```

A saída da compilação vai para ignorada `build/`. A verificação está offline e não atualiza o hardware. Consulte [verificações de projeto](tools/README.md#offline-checks) para testes de host, flashing-tool e visualizador. Para instalar uma versão de firmware publicada, use a [ferramenta de flash e recuperação](tools/flash/README.md).

<a id="repository-layout"></a>
## Layout do repositório

| Diretório | Responsabilidade |
| --- | --- |
| [`firmware/`](firmware/README.md) | Fontes C, cabeçalhos, drivers de hardware, script de linker, regras de construção e testes de firmware |
| [`host/servo-driver/`](host/servo-driver/README.md) | Driver Node.js instalável para comandos legados e a extensão v9 |
| [`tools/teleoperation/`](tools/teleoperation/README.md) | Controle um seguidor de um líder hand-operated |
| [`tools/poses/`](tools/poses/README.md) | Grave poses e reproduza com controle legado ou de extensão |
| [`tools/settings/`](tools/settings/README.md) | Descoberta do motor, calibração conjunta e configurações backup/restore |
| [`tools/tuning/`](tools/tuning/README.md) | Compare as configurações do controlador em lotes |
| [`tools/simulation/`](tools/simulation/README.md) | Veja movimento ao vivo e reproduza telemetria gravada |
| [`tools/hw-diff-tests/`](tools/hw-diff-tests/README.md) | Testes de comparação de hardware para firmware de fábrica e personalizado |
| [`tools/diagnostics/`](tools/diagnostics/README.md) | Benchmarks de latência de barramento e verificações de telemetria estacionária |
| [`tools/flash/`](tools/flash/README.md) | Atualização de firmware e recuperação de configurações |

Para obter detalhes de implementação, consulte os [comandos de extensão](../../../firmware/app/arm_extension.c), [planejador de movimento](../../../firmware/core/control/arm_motion.c), [controlador de braço](../../../firmware/core/control/arm_control.c) e [tempo de execução](../../../firmware/app/runtime.c). Os avisos de redistribuição do fornecedor são mantidos nos cabeçalhos e [fornecedor README](firmware/platform/gd32f130/vendor/README.md).

<a id="current-limits"></a>
## Limites atuais

[![Folga da caixa de câmbio e flexão da estrutura](../../../assets/readme/posters/mechanical-limits.jpg)](https://youtu.be/53l7at5aE6k)

[Assistir no YouTube](https://youtu.be/53l7at5aE6k) | [MP4](../../../assets/readme/videos/mechanical-limits.mp4)

A temperatura informada através do feedback da extensão é verificada para suprimir saltos isolados, mas a proteção de temperatura do motor ainda utiliza as leituras brutas do sensor. Isso significa que uma breve leitura incorreta pode afetar a proteção, mesmo que seja filtrada do feedback da extensão.

Ganhos, limites e compensações devem ser ajustados ao mecanismo real. Os testes de software por si só não estabelecem como um braço se comportará sob carga. Verifique a posição medida, a velocidade e a saída aplicada para avaliar a precisão, o assentamento e se o motor está atingindo seu limite de saída.
<!-- /translated-content -->
