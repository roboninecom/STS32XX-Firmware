<!-- translation-navigation -->
[English](../en/QUICKSTART.md) · [Русский](../ru/QUICKSTART.md) · [Español](../es/QUICKSTART.md) · [Français](../fr/QUICKSTART.md) · [Deutsch](../de/QUICKSTART.md) · [Português (Brasil)](QUICKSTART.md) · [简体中文](../zh-CN/QUICKSTART.md) · [日本語](../ja/QUICKSTART.md) · [हिन्दी](../hi/QUICKSTART.md) · [العربية](../ar/QUICKSTART.md)

[Original em inglês](../../../QUICKSTART.md)

> Tradução automática completa, ainda não revisada por um falante nativo. Imagens e vídeos são compartilhados; o texto neles permanece no idioma original.
<!-- /translation-navigation -->

<!-- translated-content -->
<a id="quick-start"></a>
# Início rápido

Para servos GD32F130-based STS TTL. Os comandos abaixo usam a sintaxe do shell macOS/Linux e são executados a partir da raiz do repositório. As ferramentas de movimento de extensão requerem firmware v9; A reprodução herdada também suporta firmware de fábrica.

<a id="1-install"></a>
## 1. Instalar

Instale Node.js 20+ e Python 3.10+; o visualizador de simulação opcional precisa do Python 3.12.

```sh
npm ci
python3 -m venv tools/flash/.venv
tools/flash/.venv/bin/python -m pip install -r tools/flash/requirements.txt
export SERVO_PORT=/dev/cu.usbmodemYOUR_ADAPTER
```

Substitua a porta pela sua, como `/dev/ttyUSB0` no Linux. Os exemplos usam motor ID **1** e baud **1000000**; ajuste-os para combinar com seu servo.

<a id="2-back-up-and-flash"></a>
## 2. Faça backup e atualize

**A gravação do firmware pode danificar o servo ou apagar a calibração.** Prenda o mecanismo, use alimentação estável, desative o torque e feche outros programas que usem a porta serial. As configurações devem estar bloqueadas e os alarmes apagados antes da gravação. Na gravação normal do firmware personalizado, motores com IDs exclusivos podem permanecer conectados: grave um ID por vez e não execute power-cycle no barramento. Para recuperação, mantenha conectado apenas o servo que será recuperado.

```sh
npm run settings -- discover --port "$SERVO_PORT"
npm run settings -- backup --port "$SERVO_PORT" --id 1
```

Baixe o **firmware personalizado ZIP** da [versão de pré-visualização v0.1](https://github.com/roboninecom/STS32XX-Firmware/releases/tag/v0.1-preview) em **Ativos**. Extraia sua imagem de firmware e `release.json` juntos em `tools/flash/releases/custom/`. Não use os arquivos de **código-fonte** do GitHub para atualização.

```sh
tools/flash/.venv/bin/python tools/flash/flash.py inspect \
  --manifest tools/flash/releases/custom/release.json
tools/flash/.venv/bin/python tools/flash/flash.py flash \
  --manifest tools/flash/releases/custom/release.json --port "$SERVO_PORT" --id 1
```

Digite `FLASH` quando solicitado e mantenha a energia conectada até a verificação terminar. Repita o comando de flash para cada motor ID, aguardando a verificação a cada vez. Consulte [piscando e recuperação](tools/flash/README.md) se a verificação falhar.

O **firmware de fábrica ZIP** é para retornar ao firmware de fábrica, não para as ferramentas de movimento abaixo. Extraia-o em uma pasta separada e siga [restauração das configurações de fábrica](tools/flash/README.md#restore-factory-settings) após atualizar. Mantenha cada imagem de firmware com seu próprio `release.json`.

<a id="3-calibrate-joint-offsets-and-limits"></a>
## 3. Calibrar deslocamentos e limites conjuntos

Para um mecanismo com deslocamento de junta limitado, selecione os IDs do motor para calibrar:

```sh
npm run settings -- calibrate --port "$SERVO_PORT" --ids 1,2,3 \
  --file tools/settings/calibrations/arm.json
```

Substitua os IDs de exemplo pelos seus; omita `--ids` para usar todos os motores descobertos (até seis). Para SO-101 e SO-102, consulte as [imagens de pose de referência rotuladas](tools/settings/README.md#reference-pose-images). O comando tem duas etapas:

1. Coloque cada junta selecionada, incluindo o rolo de pulso e a pinça, na posição de referência do mecanismo. Para uma nova configuração sem uma, escolha uma pose repetível perto do meio do percurso de cada articulação. Fique parado e pressione **Enter** para salvar os deslocamentos para que leiam 2048 naquela pose.
2. Mova cada junta selecionada de ponta a ponta, parando brevemente nas extremidades. Revise a tabela ativa e pressione **Enter** para salvar os limites.

Apoie todo o mecanismo; não force paradas. O torque permanece desligado. O arquivo é atualizado automaticamente e os backups do motor são mantidos. Se a segunda etapa falhar, os deslocamentos da primeira etapa permanecerão salvos: conclua a calibração antes de ativar o movimento. O ponto médio medido não substitui a referência capturada. 2048 é apenas uma referência do codificador; não estabelece um ângulo físico para simulação ou gravidade. Veja [escolhendo a pose de referência](tools/settings/README.md#choose-the-reference-pose). Faça isso antes de gravar poses ou ajustar a compensação de gravidade. Os braços existentes com calibração verificada não precisam de recalibração após um flash settings-preserving.

<a id="4-check-communication"></a>
## 4. Verifique a comunicação

Mantenha o torque desligado. Defina `--ids` para os motores conectados.

```sh
npm test
npm run bus-benchmark -- --port "$SERVO_PORT" --ids 1 --repetitions 100
npm run telemetry -- --port "$SERVO_PORT" --ids 1 --samples 1000 --interval-ms 20 \
  --output tools/diagnostics/results/first-check
```

`npm test` está offline. Os outros comandos leem o hardware e imprimem caminhos de relatório. Utilize sempre um novo diretório de saída de telemetria; ajuste `--voltage-min` e `--voltage-max` se sua alimentação estiver fora da faixa padrão de 8–16 V. Inspecione falhas e leituras sinalizadas antes do movimento. Para comparações factory/custom, siga o [guia de teste de hardware](tools/hw-diff-tests/README.md): seu conjunto completo move motores e substitui configurações salvas e modelos de redefinição.

<a id="5-record-and-replay-poses"></a>
## 5. Grave e reproduza poses

Apoie o mecanismo antes de liberar o torque. Mova-o manualmente, digite um nome para salvar cada pose e digite `done`. Use todos os IDs de motor necessários para um braço.

```sh
npm run record-poses -- --port "$SERVO_PORT" --ids 1
cp tools/poses/replay.example.json tools/poses/controller.local.json
```

Edite `tools/poses/controller.local.json`: defina `followerPort`, forneça uma entrada `profiles` para cada motor e escolha ganhos, limites de esforço, velocidade e aceleração adequados. Os valores de exemplo são ilustrativos. O exemplo faz referência a um perfil compartilhado; copie esse perfil para seus próprios ganhos e atualize seu caminho ou coloque as configurações em linha. Os caminhos são relativos ao arquivo do controlador. Verifique primeiro a calibração salva e os limites de posição. O barramento seguidor deve conter exatamente os motores configurados. O Replay lida com motores energizados e não energizados e aplica as configurações alteradas automaticamente.

Substitua `POSES.json` pelo caminho salvo do gravador:

```sh
npm run replay -- tools/poses/controller.local.json POSES.json
npm run replay -- tools/poses/controller.local.json POSES.json --run
```

O primeiro comando é visualizado; `--run` permite movimento. **A conclusão normal deixa os motores ligados, mantendo o alvo final. Ctrl+C não é uma parada de emergência.** Consulte [configurações de repetição](tools/poses/README.md#replay-poses).

Para comparar usando as configurações legadas PID salvas dos motores, sem compensação:

```sh
npm run replay-legacy -- POSES.json --port "$SERVO_PORT" --run
```

Nenhum arquivo de controlador é necessário. Omita `--run` para uma visualização de read-only. Consulte [replay legado](tools/poses/README.md#legacy-replay) para configurações de velocidade e aceleração.

<a id="6-enable-gravity-compensation"></a>
## 6. Habilitar compensação de gravidade

Para `tools/poses/controller.local.json`, adicione este campo top-level:

```json
"gravityModel": "../../host/arm-control/models/arm-upright-empty.json"
```

O modelo incluído é para o vertical calibrado **SO-ARM-102 com uma pinça vazia**. Inclui motores 1–6 e todos os seis perfis. Motores 2–4 recebem compensação; os demais recebem zero. A calibração do codificador deve corresponder; montagem, geometria ou carga útil alteradas precisam de um modelo validado. Não altere a calibração apenas para contornar uma incompatibilidade. Para um mecanismo ou calibração diferente, ajuste e valide um modelo correspondente.

[Perfis de controlador SO-101 e SO-102](host/arm-control/profiles/README.md) incluem PID, feedforward de velocidade e modelos de gravidade correspondentes. Leia suas limitações antes de usar; eles estão vinculados à calibração dos braços ajustados.

Replay, teleoperação e sintonia utilizam este mesmo campo. A gravidade segue as posições medidas enquanto a ferramenta funciona; após a saída, apenas o esforço final é retido. Consulte o [guia de gravidade](host/arm-control/README.md) para obter os requisitos do modelo.

<a id="7-tune-and-view-motion"></a>
## 7. Sintonize e visualize o movimento

Copie e edite o [plano de ajuste](../../../tools/tuning/example.json) e [exemplo de controlador](../../../tools/tuning/controller.example.json); defina o caminho `config` do plano para o arquivo do controlador. Para a primeira corrida, use pequenos movimentos seguros, `"stage": "baseline"` e `"candidates": []`.

```sh
npm run tune -- inspect PLAN.json
npm run tune -- preflight PLAN.json
npm run tune -- run PLAN.json
```

Apenas `run` move hardware. Siga a [ordem de ajuste](tools/tuning/README.md#tuning-order): linha de base → gravidade → feedforward de velocidade → P/D e filtragem → integral se necessário → acceleration/ramp tempo → movimento combinado → validação.

Para visualização, instale o [visualizador de simulação](tools/simulation/README.md) e use o caminho event-log impresso por repetição ou ajuste:

```sh
tools/simulation/.venv/bin/python tools/simulation/viewer.py live EVENTS.ndjson --model so101
tools/simulation/.venv/bin/python tools/simulation/viewer.py play EVENTS.ndjson --model so101
```

Use `--model so102` para o outro modelo de braço incluído. Verifique a convenção reference-pose no guia do visualizador. O comando controla o iniciador de janela do macOS automaticamente. O visualizador exibe o movimento medido; ele não prevê resultados de ajuste. Para controle hand-operated usando adaptadores líder e seguidor separados, consulte [teleoperação](tools/teleoperation/README.md).
<!-- /translated-content -->
