<!-- translation-navigation -->
[English](../../../en/host/servo-driver/README.md) · [Русский](../../../ru/host/servo-driver/README.md) · [Español](../../../es/host/servo-driver/README.md) · [Français](../../../fr/host/servo-driver/README.md) · [Deutsch](../../../de/host/servo-driver/README.md) · [Português (Brasil)](README.md) · [简体中文](../../../zh-CN/host/servo-driver/README.md) · [日本語](../../../ja/host/servo-driver/README.md) · [हिन्दी](../../../hi/host/servo-driver/README.md) · [العربية](../../../ar/host/servo-driver/README.md)

[Original em inglês](../../../../../host/servo-driver/README.md)

> Tradução automática completa, ainda não revisada por um falante nativo. Imagens e vídeos são compartilhados; o texto neles permanece no idioma original.
<!-- /translation-navigation -->

<!-- translated-content -->
<a id="sts32xx-servo-driver"></a>
# STS32XX servomotor

Driver Node.js para servos seriais STS e o firmware STS32XX **extensão de movimento v9**. Ele fornece descoberta, acesso a registros, operações de configuração, comandos de movimento S-curve, compensação de gravidade e feedback através de uma conexão serial. Requer **Node.js 20 ou mais recente** e um adaptador serial compatível.

As operações legadas usam a tabela de controle STS incluída neste pacote. As operações de extensão requerem firmware v9 personalizado; o firmware de fábrica não os fornece. O pacote é para Node.js, não para navegador Web Serial.

<a id="install"></a>
## Instalar

Deste repositório:

```sh
npm ci
npm run test:driver
npm pack --workspace sts32xx-servo-driver --pack-destination /tmp
```

Em outro projeto Node.js, instale o arquivo produzido pelo último comando:

```sh
npm install /tmp/sts32xx-servo-driver-0.1.0.tgz
```

Isso funciona sem publicar em um registro npm. O arquivo contém a biblioteca, exemplos, README e licença. Dependências seriais são instaladas através do npm; firmware, logs e resultados de testes não estão incluídos.

JS comum:

```js
const { StsServo } = require('sts32xx-servo-driver');
```

ES módulos:

```js
import driver from 'sts32xx-servo-driver';
const { StsServo } = driver;
```

As ferramentas de repositório existentes podem continuar importando `host/servo-driver` diretamente. Use a exportação principal do pacote; caminhos de arquivos internos não fazem parte de seu público API.

<a id="connect-and-read"></a>
## Conecte-se e leia

```js
const { StsServo } = require('sts32xx-servo-driver');

const servo = new StsServo({
  serial: { path: '/dev/cu.usbmodemYOUR_ADAPTER', baudRate: 1000000 },
});

async function main() {
  try {
    const found = await servo.connect();
    for (const id of found.ids) {
      const values = await servo.bus.read(id,
        ['presentPosition', 'presentVoltage', 'servoStatus']);
      console.log(id, values, found.alarms.get(id) ?? []);
    }
  } finally {
    await servo.close();
  }
}
main().catch(console.error);
```

Use `/dev/ttyUSB0`, `COM3` ou a porta real do seu adaptador conforme apropriado. O Discovery encontra IDs de resposta na transmissão selecionada; ele não altera as configurações do motor nem verifica outras taxas de transmissão. Os IDs devem ser exclusivos. As esperas consideram o ID mais alto possível e a transmissão selecionada. `connect()` abre a porta e descobre motores; `open()` abre apenas a porta. Os métodos de barramento e extensão exigem IDs descobertos.

Os valores de registro usam unidades brutas. Por exemplo, `presentVoltage: 120` significa 12 V. `ControlTable` descreve endereços, codificações, intervalos e escalas de exibição. Os campos Multi-byte usam codificação little-endian; valores legados assinados usam bits de sinal.

<a id="main-api"></a>
## Principal API

Todas as operações que se comunicam com hardware retornam promessas.

| API | Objetivo |
| --- | --- |
| `servo.connect()` / `servo.close()` | Open/discover ou feche a conexão serial. |
| `servo.bus.discover()` | Atualize a lista de IDs conhecidos. |
| `servo.bus.scan()` | Descubra sem substituir a lista known-ID. |
| `servo.bus.verify(ids)` | Faça ping em motores conhecidos individualmente. |
| `servo.bus.read(id, keys, options)` | Leia registros nomeados; retorna um objeto codificado pelo nome do registro. |
| `servo.bus.write(id, values, options)` | Escreva um objeto de registros nomeados. |
| `servo.bus.readMany(ids, keys, options)` | Leia vários motores usando solicitações de grupo. |
| `servo.bus.syncWrite(entries, options)` | Escreva entradas no formato `{ id, values }` em um grupo. |
| `servo.bus.device(id)` | Obtenha um objeto de conveniência com os métodos `read`, `write` e reset/calibration. |
| `servo.settings.read(id)` | Leia as configurações herdadas persistentes. |
| `servo.settings.save(id, values)` | Desbloqueie, salve, verifique e bloqueie novamente as configurações comuns. |
| `servo.arm` | Acesse os métodos v9 abaixo. |

As configurações salvas usam um tempo limite de solicitação de 250 ms. Após uma confirmação de gravação perdida, o driver espera pela persistência e lê o registro antes de tentar novamente. Already-applied as gravações não são repetidas. As falhas temporárias de comunicação têm até três tentativas; falhas persistentes ainda relatam um erro e tentam travar novamente o motor. Passe `{ timeoutMs }` a `settings.save` para substituir o tempo limite.

Exemplo legado, para um motor protegido em modo de posição que se destina a se mover:

```js
await servo.bus.write(id, { targetPosition: 2048 },
  { timeoutMs: 100, rejectOnAlarm: true });
```

Uma gravação de meta herdada pode ativar automaticamente o torque, dependendo das configurações salvas. Gravações persistentes podem alterar calibração, limites ou ganhos. Desative o torque antes de alterar as configurações. As configurações API protegem ID, baud e response-level mudam; use as [configurações CLI](../../tools/settings/README.md) no repositório para backup/restore completo. Os comandos de redefinição de fábrica, reset-template e calibração são expostos através de `servo.protocol`; chame-os apenas quando essas alterações forem pretendidas.

<a id="v9-control-lifecycle"></a>
## ciclo de vida do controle v9

1. Comece com o torque desligado. Leia recursos e configuração.
2. Aplique uma configuração validada com `arm.configure()` enquanto o torque estiver desligado.
3. Selecione o modo de extensão com uma nova sessão diferente de zero ID.
4. Habilite o torque usando o registro legado 40 e, em seguida, leia o feedback até que a sessão esteja armada, atualizada, drive-enabled e output-ready.
5. Envie alvos e atualizações de gravidade. Verifique os números de sequência aceitos em novos comentários.
6. Escreva `torqueEnable: 0` quando a aplicação pretender liberar o motor.

```js
const options = { timeoutMs: 100, rejectOnAlarm: true };
const caps = await servo.arm.capabilities(id, options);
if (caps?.major !== 9) throw new Error('Extension v9 is required');

// config must contain values validated for this motor and mechanism.
await servo.arm.configure(id, config, options);
await servo.arm.select(id, true, session, options);
await servo.bus.write(id, { torqueEnable: 1 }, options);
// Check readiness using servo.arm.feedback() before sending motion.

await servo.arm.setTargets([
  { id, target: { sequence: 1, positionQ8: 2048 * 256, speedLimit: 100 } },
], session, options);

await servo.arm.updateGravity(id,
  { session, sequence: 1, gravityEffort: -20 }, options);
```

Este trecho mostra as chamadas; o [exemplo de movimento completo](../../../../../host/servo-driver/examples/v9-move.js) inclui validação, pesquisa de prontidão, verificações de aceitação e limpeza torque-off. Se as confirmações de gravação estiverem desabilitadas, as gravações legadas precisarão de `expectResponse: false` e verificação de readback. O exemplo completo trata disso automaticamente.

O firmware mantém o último alvo e retém o último esforço de gravidade até ser substituído ou o torque ser desativado. Não há batimento cardíaco, tempo limite de comando ou expiração da gravidade. **Fechar a conexão serial não para nem libera o motor.** Escolha a limpeza do aplicativo de acordo com o mecanismo; liberar um braço carregado pode fazê-lo cair. A proteção do sensor e do motor permanece ativa no firmware.

A habilitação de torque captura a posição medida. Não propague uma sessão de extensão com gravações de metas herdadas. Torque desligado ou falha encerra a sessão; prepare uma nova sessão antes de reiniciar. Para selecionar o modo legado com torque desligado, use `arm.select(id, false, 0)`.

<a id="extension-methods"></a>
### Métodos de extensão

| Método | Resultado ou efeito |
| --- | --- |
| `capabilities(id, options)` | `{ major, minor, tickMs }` para uma assinatura reconhecida; firmware não suportado pode rejeitar a solicitação ou expirar. |
| `configuration(id, options)` | Leia a configuração RAM atual. |
| `configure(id, config, options)` | Grave a configuração e verifique os bytes codificados por readback. |
| `select(id, enabled, session, options)` | Prepare o controle v9 ou selecione o modo legado com `false, 0`. |
| `setTargets(entries, session, options)` | Envie uma transmissão contendo de um a seis motores exclusivos. |
| `updateGravity(id, command, options)` | Envie esforço de gravidade assinado com seu próprio número de sequência. |
| `feedback(id, options)` | Leia um exemplo operacional coerente. |
| `tuning(id, options)` | Leia o feedback operacional, além dos termos de movimento de referência e de esforço individual. |
| `invalidate(id)` | Limpe os recursos armazenados em cache após um ciclo de energia externo ou alteração de firmware; omita ID para limpar tudo. |

O driver invalida automaticamente os recursos de descoberta, alterações ID, alterações de conexão e redefinições emitidas por meio de seu protocolo API.

<a id="configuration-and-units"></a>
### Configuração e unidades

Cada campo de configuração é explícito. Este objeto ilustra o formato, não um perfil de ajuste recomendado:

```js
const config = {
  kpQ8: 256, kdQ8: 0, kiQ8: 0,
  integralLimit: 0, effortLimit: 100,
  velocityLimit: 100, accelerationLimit: 500,
  velocityFilterQ8: 64, rampTimeMs: 30,
  velocityFeedforward: {
    positiveGainQ8: 0, negativeGainQ8: 0, effortLimit: 0,
  },
  gravitySlewEffortPerS: 1000,
};
```

| Campos | Unidades e limites |
| --- | --- |
| `kpQ8`, `kdQ8`, `kiQ8` | Ganhos multiplicados por 256; inteiros 0–65535. |
| `effortLimit`, `integralLimit` | PWM unidades de esforço; limite geral 1–1000, limite integral 0–limite geral. |
| `velocityLimit`, alvo `speedLimit` | Codificador counts/s; 1–65535. |
| `accelerationLimit` | Counts/s²; 1–30000, compartilhado por aceleração e frenagem. |
| `rampTimeMs` | S-curve tempo de rampa de aceleração; 1–255 Sra. |
| `velocityFilterQ8` | Coeficiente de filtro multiplicado por 256; 1–255. |
| Ganhos feedforward de velocidade | Direction-specific ganhos multiplicados por 256; 0–65535. O seu limite de esforço não pode exceder o limite global. Defina os ganhos e o limite como zero para desativá-lo. |
| `gravitySlewEffortPerS` | Mudança do esforço gravitacional por segundo; 1–10000. |
| Alvo `positionQ8` | Posição do codificador multiplicada por 256; −32767×256 a 32767×256. |
| `gravityEffort` | Esforço PWM assinado; −1000 a 1000. O firmware aplica seus limites de esforço. |

Os limites de viagem vêm dos limites de posição legados salvos. O firmware limita os alvos aos limites ativos. A configuração é o estado RAM, não um perfil de ajuste persistente. O feedforward de velocidade local segue a referência de movimento do firmware; o aplicativo fornece compensação de gravidade separadamente.

Os IDs de destino da extensão são 1–253. Uma sessão é 1–65535. Cada motor rastreia as sequências de alvo e gravidade separadamente. Aumente a sequência correspondente para cada novo comando, envolvendo 65535 em 0; gaps forward de até 32767 são aceitos. Comece uma nova sessão com a sequência 1. A conclusão da transmissão significa que o pacote foi enviado, e não que todos os motores o aceitaram. Verifique `acceptedSequence`, `gravitySequence` e `session` nos comentários subsequentes.

<a id="feedback-and-errors"></a>
### Feedback e erros

`feedback()` inclui position/velocity medido em Q8 unidades, esforço aplicado, corrente ADC delta, tensão bruta, temperatura validada, falhas, sessão e sequências aceitas. Use `fresh`, `ageMs`, `sampleSequence`, `armed`, `driveEnabled` e `outputReady` para julgar se uma amostra é utilizável. A temperatura só pode ser usada quando `temperatureValid` for verdadeiro. `running: false` significa que o planejador não está mais em movimento; não garante erro de posição zero.

`tuning()` adiciona referência position/velocity, esforço solicitado, termos P/D/I, esforço de gravidade, feedforward de velocidade e contagem de ultrapassagem.

As opções de leitura e gravação incluem `timeoutMs` e `rejectOnAlarm`. Os alarmes legados não rejeitam respostas válidas por padrão; passe `rejectOnAlarm: true` quando um alarme deve abortar uma operação. Os erros digitados incluem `RequestTimeoutError`, `MissingResponseError`, `ServoStatusError`, `SettingsVerificationError` e `InvalidPacketError`. O contexto adicional está em `error.details`; as rejeições de extensão incluem `extensionStatus` lá.

O agendador serializa solicitações e oferece suporte a prioridades e transações exclusivas. Aguarde comandos e use alvos de grupo para movimentos coordenados. O tempo limite de resposta começa após o esgotamento da gravação serial; as operações de transporte têm prazos próprios. Esses intervalos não alteram o comportamento motor. Os pacotes legados não têm número de sequência, portanto, uma resposta anormalmente atrasada nem sempre pode ser distinguida de uma solicitação posterior com o mesmo formato de resposta.

As exportações Low-level incluem `SerialTransport`, `StsProtocol`, `RequestScheduler`, `PacketEncoder`, `PacketDecoder`, `RegisterCodec`, `RegisterLayout`, `ArmCodec`, constantes e erros. Eles permanecem separados do ônibus high-level API.

<a id="runnable-examples"></a>
## Exemplos executáveis

Neste diretório ou usando os arquivos de exemplo incluídos no pacote instalado:

```sh
node examples/discover.js /dev/cu.usbmodemYOUR_ADAPTER
node examples/v9-feedback.js /dev/cu.usbmodemYOUR_ADAPTER 2
node examples/v9-move.js /dev/cu.usbmodemYOUR_ADAPTER 2 2048 100 /path/to/config.json
```

Os dois primeiros exemplos são apenas lidos. O exemplo de movimento requer uma configuração JSON com os campos acima e usa 1 Mbaud. Opere-o em um motor seguro e descarregado com deslocamento livre. Ele desativa o torque após o movimento, um erro ou Ctrl+C elegante. Ele espera até 3 segundos pela inicialização e 30 segundos pela movimentação. Argumento final opcional: esforço de gravidade assinado, padrão zero. Não o utilize para suportar uma carga no braço.

<a id="tests-and-license"></a>
## Testes e licença

Da raiz do repositório:

```sh
npm run test:driver
npm run test:driver-package
npm test
```

Os testes usam transportes falsos e não abrem portas seriais. A verificação de pacote instala o arquivo real em um projeto temporário, usando as dependências em cache do npm de `npm ci`, e verifica importações de CommonJS/ESM e exemplos de pontos de entrada. Ele não publica o pacote. A instalação de produção pode exigir ferramentas de construção nativas se uma ligação serial-port não estiver disponível para o sistema operacional e CPU.

[MIT](../../../../../host/servo-driver/LICENSE), direitos autorais 2026 STS32XX-Firmware colaboradores. Esta licença cobre este diretório de drivers, incluindo exemplos e testes. Ele não relicencia firmware ou código de fornecedor em outro lugar do repositório. As dependências mantêm suas próprias licenças.
<!-- /translated-content -->
