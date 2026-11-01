<!-- translation-navigation -->
[English](../../../en/tools/poses/README.md) · [Русский](../../../ru/tools/poses/README.md) · [Español](../../../es/tools/poses/README.md) · [Français](../../../fr/tools/poses/README.md) · [Deutsch](../../../de/tools/poses/README.md) · [Português (Brasil)](README.md) · [简体中文](../../../zh-CN/tools/poses/README.md) · [日本語](../../../ja/tools/poses/README.md) · [हिन्दी](../../../hi/tools/poses/README.md) · [العربية](../../../ar/tools/poses/README.md)

[Original em inglês](../../../../../tools/poses/README.md)

> Tradução automática completa, ainda não revisada por um falante nativo. Imagens e vídeos são compartilhados; o texto neles permanece no idioma original.
<!-- /translation-navigation -->

<!-- translated-content -->
<a id="record-and-replay-poses"></a>
# Grave e reproduza poses

Grave posições nomeadas com torque desligado e reproduza-as com configurações legadas salvas ou configurações de extensão ajustadas. Os comandos são executados a partir da raiz do repositório.

| Comando | Entrada | Firmware |
| --- | --- | --- |
| `npm run record-poses` | Posicionamento manual | Fábrica ou personalizado |
| `npm run replay` | Poses nomeadas ou uma sessão de teleoperação | Extensão v9 |
| `npm run replay-legacy` | Poses nomeadas | Fábrica ou personalizado v9 |

<a id="record-poses"></a>
## Gravar poses

Instale o Node.js 20 ou mais recente e execute a partir da raiz do repositório:

```sh
npm install
npm run record-poses -- --port /dev/ttyUSB0 --ids 1,2,3
```

Substitua a porta e os IDs da sua configuração. Os sinalizadores opcionais são `--baud` (padrão 1000000), `--output DIR` e `--timeout-ms` (padrão 1000).

Conclua [calibração de deslocamento e limite](../settings/README.md#calibrate-joint-offsets-and-limits) primeiro. As poses gravadas são pontos de referência de movimento; capturar uma pose chamada `home` ou `reference` não altera a calibração do motor.

1. Apoie o mecanismo para que ele não caia quando o torque for liberado.
2. Pressione Enter no prompt de confirmação. O registrador desativa o torque nos motores selecionados e verifica se está desligado. Outros motores não são alterados.
3. Mova o mecanismo, mantenha-o imóvel e pressione Enter para capturar uma pose. Você pode digitar um nome exclusivo; poses sem nome tornam-se `position-1`, `position-2`, etc.
4. Repita conforme necessário. Digite `done` para finalizar ou pressione Ctrl+C para interromper.

O torque permanece desligado após a gravação. As leituras são sequenciais, portanto cada pose é um instantâneo de um mecanismo estacionário, não uma medição de movimento sincronizado. Uma leitura ausente, um alarme ou um motor habilitado interrompe a sessão. Ao sair, a ferramenta tenta desabilitar o torque novamente e relata qualquer falha na verificação.

<a id="saved-files"></a>
## Arquivos salvos

Um novo arquivo JSON é criado em `tools/poses/recordings/` para cada sessão. Cada captura bem-sucedida substitui esse arquivo atomicamente; as poses salvas anteriormente permanecem disponíveis se uma captura posterior falhar. As gravações são ignoradas pelo Git.

O formato `sts-poses` versão 1 identifica posições por motor ID, não por ordem de array:

```json
{
  "format": "sts-poses",
  "version": 1,
  "units": "encoder-counts",
  "ids": [1, 3],
  "readMode": "sequential",
  "poses": [
    {
      "name": "home",
      "capturedAt": "2026-10-24T12:00:00.000Z",
      "durationMs": 4.2,
      "positions": {"1": 2048, "3": 3100}
    }
  ]
}
```

Os arquivos também incluem tempo de sessão, porta serial e taxa de transmissão. Colocar marca de carimbos de data/hora quando a leitura começar; `durationMs` mede a aquisição completa. As contagens são posições informadas assinadas, já incluindo o ajuste de deslocamento e direção do motor, sem conversão para ângulos. O arquivo não possui configurações de velocidade, aceleração ou tempo de reprodução e nenhum instantâneo de calibração. Re-record poses após alteração da calibração do codificador; a reprodução não consegue detectar que um arquivo de pose antigo usa deslocamentos diferentes.

<a id="replay-poses"></a>
## Poses de repetição

Copie [replay.example.json](../../../../../tools/poses/replay.example.json) ao lado do original, por exemplo como `tools/poses/controller.local.json`. Defina `followerPort` e forneça uma entrada `profiles` por motor registrado. Os IDs vêm da gravação; nenhum líder ou mapeamento conjunto é necessário. O exemplo faz referência ao [perfil do motor](../../../../../host/arm-control/profile.example.json). Copie esse perfil para suas próprias configurações e atualize seu caminho ou coloque as configurações em linha. Todos os caminhos de perfil e gravidade são relativos ao arquivo do controlador. Os ganhos de exemplo ilustram o formato; use configurações testadas em seu mecanismo.

```sh
npm run replay -- CONFIG.json POSES.json
npm run replay -- CONFIG.json POSES.json --run
```

O primeiro comando visualiza o caminho completo sem alterar as configurações e relata os alvos limitados aos limites salvos. `--run` inicia o movimento, incluindo a aproximação da posição atual até a primeira pose. Somente a porta seguidora é aberta. Arquivos de até 64 MiB são aceitos e validados antes da abertura de uma porta.

O [controlador compartilhado](../../host/arm-control/README.md) aplica perfis, lida com sessões energizadas existentes e fornece compensação de gravidade quando `gravityModel` está configurado. **A conclusão normal e Ctrl+C mantêm a alimentação ligada.** As falhas usam a limpeza do controlador; Ctrl+C não é uma parada de emergência. Opcional top-level `durationMs` encerra a reprodução mais cedo; omita-o para reproduzir o arquivo inteiro.

Cada pose é enviada em um comando de grupo. As velocidades conjuntas são escalonadas com a distância percorrida, sujeitas à velocidade de repetição e ao limite de velocidade de cada motor. Cada motor gera seu próprio S-curve, portanto a chegada é aproximada e os waypoints não são combinados. A reprodução espera que os planejadores terminem e todas as posições medidas entrem em `toleranceCounts` e então inicia a espera. Um movimento que exceda `moveTimeoutMs` falha. Os carimbos de data/hora gravados manualmente não definem a velocidade de reprodução.

| Configuração `replay` | Padrão | Significado |
| --- | --- | --- |
| `speed` | 1000 | Velocidade máxima, codificador 1–65535 counts/s. |
| `holdMs` | 1000 | Pausa após a chegada, 0–600000 ms. |
| `repeat` | 1 | Número de passes, 1–1000; cada passagem retorna à primeira pose. |
| `moveTimeoutMs` | 30000 | Tempo limite de chegada, 1–600000 ms. |
| `toleranceCounts` | 10 | Erro de posição medida permitido, 0–32767 contagens. |

<a id="replay-a-recorded-session"></a>
## Reproduzir uma sessão gravada

Reproduza um registro de teleoperação sem conectar o líder:

```sh
npm run replay -- CONFIG.json SESSION.ndjson
npm run replay -- CONFIG.json SESSION.ndjson --run
```

A gravação deve conter um `preflight` com limites de líder e mapeamento conjunto, seguido de eventos `command` com timestamps monotônicos e todas as posições de líder. Use o mesmo mapeamento de junta na configuração atual. As posições de líder registradas são mapeadas através dos limites de líder registrados e dos limites atuais do seguidor. Perfis atuais e gravidade são aplicados; cenários e esforços históricos não são reutilizados. Um comando pretendido em um registro com falha pode nunca ter alcançado os motores.

A reprodução preserva os intervalos gravados; atrasos de processamento aumentam o tempo em vez de enviar rajadas catch-up. As atualizações de feedback e gravidade continuam durante as pausas. `replay.repeat`, `moveTimeoutMs` e `toleranceCounts` se aplicam; `speed` e `holdMs` aplicam-se apenas a poses nomeadas. O último quadro deve chegar antes da conclusão.

<a id="legacy-replay"></a>
## Replay legado

Use as configurações PID salvas dos motores sem avanço de velocidade de extensão ou compensação de gravidade. Nenhum arquivo de controlador é necessário e as configurações persistentes permanecem inalteradas. Os motores precisam do modo de posição absoluta e da resolução do encoder da unidade.

```sh
npm run replay-legacy -- POSES.json --port /dev/ttyUSB0
npm run replay-legacy -- POSES.json --port /dev/ttyUSB0 --run
```

O primeiro comando é visualizado; `--run` movimentos. Os IDs vêm do arquivo de pose; outros motores no adaptador são deixados sozinhos. O firmware personalizado muda para o modo legado. A configuração desativa e re-enables brevemente cada motor selecionado, semeando primeiro sua posição atual.

| Opção | Padrão | Significado |
| --- | --- | --- |
| `--speed` | 1000 | Velocidade máxima, codificador 1–32767 counts/s. |
| `--acceleration` | 5000 | Counts/s², 100–25400 em múltiplos de 100. Aplicam-se limites salvos. |
| `--hold-ms` | 1000 | Segure após cada movimento planejado, 0–600000 ms. |
| `--baud` | 1000000 | Taxa de transmissão do adaptador. |

Cada pose usa um comando de grupo e velocidades distance-scaled para chegada aproximadamente simultânea. Os alvos são limitados aos limites de posição salvos. A reprodução espera que os perfis de movimento internos terminem e depois é mantida; não requer erro de posição medido zero. Um movimento que dura mais de 30 segundos falha.

A conclusão retém o torque na pose final. Ao contrário da reprodução de extensão, **Ctrl+C tenta torque-off**, assim como as falhas. Falhas de limpeza são relatadas.

<a id="logs-and-visualization"></a>
## Registros e visualização

Ambos os comandos de reprodução salvam logs em `logs/motion/` ignorados, incluindo calibração, identidade de origem, comandos e feedback. Inicie o [visualizador de telemetria](../simulation/README.md) uma vez e execute replays em outro terminal:

```sh
mkdir -p logs/motion
tools/simulation/.venv/bin/python tools/simulation/viewer.py live logs/motion --model so102
```

Use `--model so101` para o outro modelo empacotado e um mapeamento de codificador correspondente. A reprodução de extensão lê feedback detalhado para a referência móvel mostrada pelo visualizador. Para reduzir o tráfego, anexe `--compact`; o movimento medido e a compensação permanecem ativos, mas a sombra mostra destinos em vez de posições intermediárias do planejador. PID os prazos e as contribuições compensatórias aplicadas também são omitidos. Consulte [feedback e tempo](../../host/arm-control/README.md#checks-and-timing).

Execute testes de gravação offline, reprodução de extensão e reprodução legada com `npm run test:poses`.
<!-- /translated-content -->
