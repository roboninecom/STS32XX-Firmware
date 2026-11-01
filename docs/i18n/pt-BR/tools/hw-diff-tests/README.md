<!-- translation-navigation -->
[English](../../../en/tools/hw-diff-tests/README.md) · [Русский](../../../ru/tools/hw-diff-tests/README.md) · [Español](../../../es/tools/hw-diff-tests/README.md) · [Français](../../../fr/tools/hw-diff-tests/README.md) · [Deutsch](../../../de/tools/hw-diff-tests/README.md) · [Português (Brasil)](README.md) · [简体中文](../../../zh-CN/tools/hw-diff-tests/README.md) · [日本語](../../../ja/tools/hw-diff-tests/README.md) · [हिन्दी](../../../hi/tools/hw-diff-tests/README.md) · [العربية](../../../ar/tools/hw-diff-tests/README.md)

[Original em inglês](../../../../../tools/hw-diff-tests/README.md)

> Tradução automática completa, ainda não revisada por um falante nativo. Imagens e vídeos são compartilhados; o texto neles permanece no idioma original.
<!-- /translation-navigation -->

<!-- translated-content -->
<a id="hardware-comparison-tests"></a>
# Testes de comparação de hardware

Compare firmware de fábrica e personalizado em servos STS. O conjunto cobre o protocolo legado, configurações, movimento, calibração e proteção. Ele não testa o controle do protocolo de extensão v9. Os testes usam o [driver compartilhado](../../host/servo-driver/README.md) do repositório.

**Use uma bancada dedicada com servos seguros e eixos livres.** Alguns testes fazem movimentos longos ou contínuos e substituem configurações ou calibrações salvas. Faça backup de cada servo primeiro. Mantenha uma forma de desconectar a alimentação do motor imediatamente.

<a id="setup"></a>
## Configuração

Instale o Node.js **20 ou mais recente** e execute a partir da raiz do repositório:

```sh
npm ci
npm run test:diff
npm run diff -- --list
```

Esses comandos são executados offline. `--list` mostra o estágio de cada cenário, classificação de movimento e nome exato. Use `--help` para todas as opções de comando.

Conecte apenas os servos de teste: alguns casos utilizam transmissões. Feche outros programas usando o adaptador e forneça uma alimentação de motor adequada. As conexões padrão são:

| Configuração | Padrão |
|---|---|
| Servo de fábrica ID | `1` |
| Servo de firmware personalizado ID | `2` |
| Taxa de transmissão | `1000000` |

Defina valores diferentes com `--factory-id`, `--candidate-id` e `--baud`. Os IDs devem ser distintos; deixe os IDs **250 e 251** sem uso porque os testes os utilizam temporariamente. Comece com torque desligado, configurações bloqueadas e sem alarmes ativos. Use motores, fontes de alimentação e cargas comparáveis ao comparar movimentos.

```sh
export SERVO_PORT=/dev/cu.usbmodemYOUR_ADAPTER
```

Substitua a porta pela sua. O Linux normalmente usa `/dev/ttyUSB0`; no Windows, passe uma porta diretamente, como `--port COM3`.

<a id="run-tests"></a>
## Execute testes

Comece com uma verificação de comunicação:

```sh
npm run diff -- --port "$SERVO_PORT" --case test_ping
```

Execute o grupo padrão:

```sh
npm run diff -- --port "$SERVO_PORT" --stage safe
```

O grupo `safe` verifica PING, leituras de registro e rejeição de gravação em um registro read-only. Ele não aciona os motores, mas envia um pacote WRITE.

Selecione um grupo com `--stage` ou um cenário exato com `--case`:

```sh
npm run diff -- --port "$SERVO_PORT" \
  --case test_motion_write_order_gap_matrix --allow-motion
```

`--case` substitui `--stage`. As corridas focadas usam as configurações de servo existentes; eles não instalam a configuração de teste do conjunto completo. Verifique os pré-requisitos relatados de um caso se ele não puder ser iniciado.

| Permissão | Permite |
|---|---|
| `--allow-motion` | Habilitando o acionamento ou emitindo comandos de movimento |
| `--allow-persistence-write` | Gravações de configurações salvas, calibração e restore-defaults |
| `--allow-template-write` | Substituindo o modelo de redefinição salvo |
| `--allow-current-protection` | Testes conduzidos current-protection; também precisa de permissão de movimento |

O conjunto completo requer todas as quatro permissões e uma taxa de transmissão inicial de 1000000:

```sh
npm run diff -- --port "$SERVO_PORT" --stage all \
  --allow-motion --allow-persistence-write \
  --allow-template-write --allow-current-protection
```

Adicione `--fail-fast` para parar após o primeiro caso non-passing. Caso contrário, os casos independentes continuam após falhas normais. Pré-requisitos com falha, falhas de limpeza e perda de comunicação interrompem testes adicionais.

<a id="settings-and-cleanup"></a>
## Configurações e limpeza

**O conjunto completo não restaura suas configurações originais.** Ele instala uma configuração de teste salva e finaliza carregando o modelo de reinicialização do servo. O teste de modelo substitui esse modelo pelas configurações do conjunto.

Esses testes focados também têm efeitos duradouros:

- `prerequisites` inclui restore-defaults e calibração. Seu teste de deslocamento salva um novo deslocamento que coloca a posição exibida em 2048.
- `restore-defaults` carrega o modelo de redefinição salvo (`0x06`), que pode ser diferente das configurações originais do fabricante.
- `template` substitui o modelo de redefinição (`0x09`) pelas configurações ativas pre-test. O modelo antigo não pode ser lido ou restaurado por este conjunto.

Outros casos de persistência tentam restaurar as configurações alteradas. Sempre inspecione os erros de limpeza antes de outra execução. Consulte o [guia de backup e recuperação de configurações](../flash/README.md#restore-factory-settings) para comandos de backup e recuperação de fábrica.

**Ctrl+C não garante a limpeza ou um relatório salvo.** O executor não possui um manipulador de interrupção elegante. Se o movimento precisar parar imediatamente, desconecte a alimentação do motor; em seguida, verifique a comunicação, as configurações e o estado do torque antes de continuar.

<a id="compare-against-a-saved-factory-run"></a>
## Compare com uma execução de fábrica salva

Use os mesmos casos, revisão de suíte, taxa de transmissão e condições de bancada comparáveis:

```sh
npm run diff -- --port "$SERVO_PORT" --mode factory --case test_ping

npm run diff -- --port "$SERVO_PORT" --mode candidate --case test_ping \
  --reference tools/hw-diff-tests/results/FACTORY_TIMESTAMP/report.json
```

Substitua o caminho de referência pelo relatório da primeira execução. Mantenha o original de fábrica ID em `--factory-id`; o candidato deve ter um ID diferente, mesmo ao testar o mesmo servo físico após gravar o firmware. A suíte não muda isso ID para você. Pair-only casos são ignorados no modo single-device. Sem `--reference`, uma passagem single-device verifica apenas as asserções desse cenário, não a equivalência de fábrica.

<a id="results"></a>
## Resultados

Os relatórios são salvos em `tools/hw-diff-tests/results/` ou no diretório fornecido com `--results`. Resultados e logs são ignorados pelo Git.

Abra `report.json` para observações, comparações, pacotes transmitidos, respostas recebidas e tempo de cada dispositivo. Inspecione `fatal`, `cleanupError` e `closeError`, bem como os resultados do caso.

| Resultado | Significado |
|---|---|
| `passed` | Asserções e qualquer comparação disponível foram aprovadas |
| `mismatch` | As observações da fábrica e do candidato diferiram |
| `failed` | Uma verificação de declaração, comunicação ou recuperação falhou |
| `inconclusive` | A fábrica não produziu o efeito necessário para comparação |
| `skipped` | O caso não foi executado |

Código de saída **0** significa que não há falhas relatadas; casos ignorados podem permanecer. **1** significa um erro argument/setup ou uma exceção não tratada. **2** significa que o relatório contém uma falha, incompatibilidade, resultado inconclusivo ou erro cleanup/connection-close.

O tempo inclui agendamento do host, USB e atrasos seriais; não é uma medição direta do tempo de execução do firmware. Preserve o relatório e reproduza um caso específico antes de atribuir uma diferença de movimento ao firmware.
<!-- /translated-content -->
