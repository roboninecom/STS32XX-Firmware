<!-- translation-navigation -->
[English](../../../en/tools/flash/README.md) · [Русский](../../../ru/tools/flash/README.md) · [Español](../../../es/tools/flash/README.md) · [Français](../../../fr/tools/flash/README.md) · [Deutsch](../../../de/tools/flash/README.md) · [Português (Brasil)](README.md) · [简体中文](../../../zh-CN/tools/flash/README.md) · [日本語](../../../ja/tools/flash/README.md) · [हिन्दी](../../../hi/tools/flash/README.md) · [العربية](../../../ar/tools/flash/README.md)

[Original em inglês](../../../../../tools/flash/README.md)

> Tradução automática completa, ainda não revisada por um falante nativo. Imagens e vídeos são compartilhados; o texto neles permanece no idioma original.
<!-- /translation-navigation -->

<!-- translated-content -->
<a id="flash-firmware"></a>
# Firmware instantâneo

Atualize firmware personalizado ou de fábrica em um servo **GD32F130 STS TTL compatível**. Um uploader cuida de ambos; o manifesto de lançamento seleciona as verificações do aplicativo.

**Aviso: atualizar o firmware pode danificar seu servo, apagar a calibração ou deixá-lo inutilizável. Use esta ferramenta por sua própria conta e risco. A recuperação não é garantida.**

Use a imagem de firmware do editor e `release.json` correspondente, mantida na mesma pasta. Compilações de firmware bruto não são suportadas. Verifique a compatibilidade de hardware da versão antes de atualizar.

<a id="install"></a>
## Instalar

Requer **Python 3.10 ou mais recente**. Execute a partir da raiz do repositório:

```sh
python3 -m venv tools/flash/.venv
source tools/flash/.venv/bin/activate
python -m pip install -r tools/flash/requirements.txt
```

No Windows, ative com `tools\flash\.venv\Scripts\Activate.ps1`.

<a id="choose-firmware"></a>
## Escolha o firmware

| Firmware | Manifesto |
| --- | --- |
| Extensão personalizada v9 | Baixe a imagem do editor e `release.json` juntos em `tools/flash/releases/`. |
| Fábrica **SCServo21-GD32-TTL 3.10**, modelo **9.3** | Agrupado em [`factory/release.json`](../../../../../tools/flash/factory/release.json), junto com sua imagem. |

A imagem de fábrica é apenas para hardware correspondente. Use o manifesto selecionado com `inspect`, `flash` ou `recover`; nenhum comando ou modo de fábrica separado é necessário.

<a id="prepare"></a>
## Prepare-se

- O gravar o firmware normal redefine apenas o motor selecionado ID. Motores com IDs únicos podem permanecer conectados; atualize-os sequencialmente enquanto os outros funcionam normalmente. Não power-cycle o barramento nem execute outro uploader durante uma transferência.
- Para **recuperação**, conecte apenas o servo pretendido. A recuperação não seleciona um motor por ID e as transferências do bootloader não são abordadas.
- Proteja o mecanismo, use a potência estável do motor e feche outros programas usando a porta serial.
- Para gravar o firmware normalmente, desative o torque, bloqueie as gravações das configurações e limpe qualquer alarme ativo usando sua ferramenta de controle usual. Conheça a corrente ID e a taxa de transmissão do servo.
- Faça backup de calibrações e configurações importantes. Comece com as configurações salvas no servo; alterações temporárias podem desaparecer após a reinicialização.

Substitua a porta e ID pelos seus valores. A taxa de transmissão padrão é **1,000,000**; adicione `--baud 500000`, por exemplo, se necessário. As portas típicas são `/dev/cu.usbmodem…` no macOS, `/dev/ttyUSB0` no Linux e `COM3` no Windows.

```sh
python tools/flash/settings.py backup \
  --port /dev/cu.usbmodemYOUR_ADAPTER --id 2 \
  --file backups/servo-2-settings.json
```

Mantenha este backup para este servo exato. Os arquivos de backup existentes não são substituídos.

<a id="flash"></a>
## Flash

Verifique e atualize uma versão personalizada baixada:

```sh
python tools/flash/flash.py inspect \
  --manifest tools/flash/releases/release.json

python tools/flash/flash.py flash \
  --manifest tools/flash/releases/release.json \
  --port /dev/cu.usbmodemYOUR_ADAPTER --id 2
```

Para instalar o firmware de fábrica incluído, selecione seu manifesto. Isole o servo para esta operação: a inicialização de fábrica pode alterar seu ID para 1, entrando em conflito com outro motor no barramento.

```sh
python tools/flash/flash.py flash \
  --manifest tools/flash/factory/release.json \
  --port /dev/cu.usbmodemYOUR_ADAPTER --id 2
```

`inspect` verifica o tamanho do arquivo, soma de verificação e manifesto sem conectar a um servo. Digite `FLASH` quando solicitado. Mantenha a energia conectada até que o comando termine. A ferramenta verifica o servo, salva o instantâneo das configurações, carrega o firmware, depois verifica o aplicativo e compara as configurações. A verificação bem-sucedida deixa o torque desativado.

Após um flash de fábrica, a ferramenta verifica o ID/baud anterior e, em seguida, ID **1** em **1,000,000** baud, se necessário, e imprime a conexão funcional. Código de saída **2** significa que o firmware de fábrica respondeu, mas as configurações foram alteradas. Continue com o reparo das configurações abaixo, em vez de gravar o firmware novamente.

<a id="recover-an-unresponsive-servo"></a>
## Recuperar um servo que não responde

Primeiro verifique a alimentação, a fiação, ID e a taxa de transmissão. Se a recuperação for necessária, conecte **apenas o servo pretendido** e use o manifesto selecionado. Por exemplo, para recuperar com firmware de fábrica:

```sh
python tools/flash/flash.py recover \
  --manifest tools/flash/factory/release.json \
  --port /dev/cu.usbmodemYOUR_ADAPTER --id 1
```

Após a confirmação, **power-cycle o servo quando solicitado**, deixando o adaptador USB conectado. A ferramenta aguarda até 60 segundos pelo bootloader.

Use o ID e a taxa de transmissão esperada após a recuperação. A recuperação não pode verificar o modelo atual ou fazer backup das configurações antes de fazer o upload, portanto, confirme você mesmo a compatibilidade do hardware. Verifique a calibração e os limites de posição antes de ativar o torque posteriormente.

<a id="restore-factory-settings"></a>
## Restaurar configurações de fábrica

Após retornar ao firmware de fábrica, restaure o backup deste servo mesmo que as configurações inicialmente pareçam corretas. O firmware de fábrica pode usar padrões built-in quando suas configurações salvas são inválidas; gravações comuns de registro podem não resolver isso.

Use o **atual** ID/baud impresso após gravar o firmware. Por exemplo, se agora responder como ID 1:

```sh
python tools/flash/settings.py restore \
  --port /dev/cu.usbmodemYOUR_ADAPTER --id 1 \
  --file backups/servo-2-settings.json
```

Digite `RESTORE` para confirmar. Isso suporta **3.10** de fábrica e recusa firmware personalizado detectado. Ele restaura as configurações, **substitui o modelo de reset salvo**, repara as configurações salvas, bloqueia gravações e reinicia o servo. Ele segue quaisquer alterações em ID/baud e verifica o readback sem enviar comandos de movimento.

Então **power-cycle o servo** e verifique usando o **restaurado** ID/baud:

```sh
python tools/flash/settings.py verify \
  --port /dev/cu.usbmodemYOUR_ADAPTER --id 2 \
  --file backups/servo-2-settings.json
```

Mantenha o torque desligado até que a verificação seja aprovada. Você também pode fornecer um flash normal `report.json` contendo um instantâneo before-flash como `--file`. Os backups feitos após a perda das configurações não podem recuperar a calibração original. Sem um backup válido, obtenha as configurações para o modelo exato e recalibre este servo.

Em caso de falha, o reparo tenta bloquear novamente as configurações, mas não desfaz gravações parciais nem tenta novamente o reparo automaticamente. Preserve o relatório antes de investigar.

<a id="results-and-options"></a>
## Resultados e opções

Os relatórios Flash são salvos em `backups/flash/`; relatórios de configurações em `backups/settings/`. Ambos incluem instantâneos de configurações disponíveis. Um upload bem-sucedido inclui verificações de aplicativos; ele não lê a imagem completa do firmware. As configurações não são restauradas automaticamente.

- `--output DIRECTORY`: escolha onde os relatórios serão salvos.
- `--yes`: ignora o prompt de confirmação; todas as verificações ainda são executadas.
- `--help`: mostra opções de comando.

Se a validação do arquivo falhar, obtenha um par de versões correspondente. Se o gravar o firmware for interrompido, o servo pode precisar de recuperação. Se a transferência terminar, mas a verificação falhar, inspecione o relatório e verifique ID, taxa de transmissão e configurações antes de tentar novamente.

Para autores de lançamento, [release.example.json](../../../../../tools/flash/release.example.json) mostra um manifesto personalizado e [factory/release.json](../../../../../tools/flash/factory/release.json) um manifesto de fábrica. O exemplo personalizado não é uma versão de firmware utilizável.

<a id="acknowledgments"></a>
## Agradecimentos

As ferramentas de atualização e recuperação foram inspiradas em [0o8o0-blip/sts3215-firmware](https://github.com/0o8o0-blip/sts3215-firmware/).
<!-- /translated-content -->
