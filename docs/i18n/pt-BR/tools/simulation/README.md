<!-- translation-navigation -->
[English](../../../en/tools/simulation/README.md) · [Русский](../../../ru/tools/simulation/README.md) · [Español](../../../es/tools/simulation/README.md) · [Français](../../../fr/tools/simulation/README.md) · [Deutsch](../../../de/tools/simulation/README.md) · [Português (Brasil)](README.md) · [简体中文](../../../zh-CN/tools/simulation/README.md) · [日本語](../../../ja/tools/simulation/README.md) · [हिन्दी](../../../hi/tools/simulation/README.md) · [العربية](../../../ar/tools/simulation/README.md)

[Original em inglês](../../../../../tools/simulation/README.md)

> Tradução automática completa, ainda não revisada por um falante nativo. Imagens e vídeos são compartilhados; o texto neles permanece no idioma original.
<!-- /translation-navigation -->

<!-- translated-content -->
<a id="telemetry-viewer"></a>
# Visualizador de telemetria

Veja a telemetria ao vivo ou reproduza uma gravação do controlador no MuJoCo. O visualizador lê arquivos de log; ele nunca se conecta a motores ou envia comandos. Ambos os modelos usam o mesmo visualizador, gráficos e sobreposição de referência. Ele exibe o movimento gravado; não prevê dinâmica motora ou resultados de ajuste.

<a id="install"></a>
## Instalar

Na raiz do repositório, usando Python 3.12:

```sh
python3.12 -m venv tools/simulation/.venv
tools/simulation/.venv/bin/python -m pip install -r tools/simulation/requirements.txt
```

<a id="live-and-recorded-playback"></a>
## Reprodução ao vivo e gravada

Inicie uma vez para assistir à sessão mais recente e alterne automaticamente quando outra repetição ou execução de teleoperação criar um log:

```sh
mkdir -p logs/motion
tools/simulation/.venv/bin/python tools/simulation/viewer.py live logs/motion --model so101
```

O diretório deve existir. Um diretório vazio aguarda seu primeiro log. As preferências de janela, câmera e exibição permanecem inalteradas entre as execuções; gráficos redefinidos para cada nova sessão. Inicie a reprodução de hardware separadamente em outro terminal.

Para seguir um registro específico ou reproduzir um registro salvo desde o início:

```sh
tools/simulation/.venv/bin/python tools/simulation/viewer.py live /path/to/events.ndjson --model so101

tools/simulation/.venv/bin/python tools/simulation/viewer.py play /path/to/events.ndjson --model so101
```

O comando seleciona o iniciador de janela nativo automaticamente no macOS, incluindo caminhos de repositório contendo espaços. Selecione `--model so102` para SO-102; este também é o padrão quando omitido. Modelos e malhas são agrupados, portanto a visualização não requer download ou importação.

Para uma prévia do PNG, use Python comum em todas as plataformas:

```sh
tools/simulation/.venv/bin/python tools/simulation/viewer.py play /path/to/events.ndjson --model so101 --render preview.png
```

O visualizador aceita logs de eventos do controlador, não arquivos nomeados pose JSON. Envie arquivos de pose através de [hardware replay](../poses/README.md#replay-poses) e visualize o log resultante. A reprodução preserva o tempo de gravação e mantém o quadro final. A exibição ao vivo é atualizada somente após uma passagem completa do feedback do motor. Medições atrasadas são rotuladas como obsoletas; os comandos por si só não podem atualizá-los. Um log substituído ou truncado deve ser reaberto. Fechar o visualizador deixa o controle de hardware em execução.

<a id="models-and-calibration"></a>
## Modelos e calibração

| Modelo | Fonte | Exibir mapeamento |
| --- | --- | --- |
| `so101` | [Seguidor SO-101 oficial](urdf/so101/README.md), Apache 2.0 | Todos os seis motores, incluindo rotação do pulso e mandíbula da pinça giratória. |
| `so102` | [SO-ARM-102](urdf/README.md), CC BY 4.0 | Mapeamento M1–M4 calibrado existente; o rolo do pulso e as mandíbulas permanecem fixos. |

SO-101 usa o upstream `so101_new_calib.urdf`. Seu mapa padrão assume montagem padrão e cada junta URDF zero na contagem do codificador 2048. As contagens positivas aumentam cada ângulo de articulação de URDF em 2π/4096 radianos por contagem. Esta convenção deve corresponder à postura de referência do seu braço e às direções articulares; o display rotula **pose de referência assumida**, não alinhamento hardware-verified. A pinça usa o ângulo do codificador diretamente, não a abertura 0–100 normalizada do LeRobot. Seu zero URDF deve corresponder ao ângulo da mandíbula em sua referência de calibração; não é inferido dos limites de viagem salvos.

SO-102 mantém suas verificações encoder-calibration existentes e acoplamento de mandíbula fixa. Alterar o modelo não altera o controlador de hardware ou seu modelo gravitacional.

<a id="match-the-calibration-reference"></a>
### Combine a referência de calibração

A [ferramenta de calibração](../settings/README.md#choose-the-reference-pose) define 2048 na pose que você captura. O visualizador converte separadamente essas contagens em ângulos:

```text
angle = referenceRadians + (counts − referenceCount) × radiansPerCount
```

| Mapa agrupado | Ângulos de articulação exibidos quando as contagens são 2048 |
| --- | --- |
| SO-101 | 0° para todas as seis juntas URDF; isso é uma suposição, não uma pose física detectada. |
| SO-102 | M1 0°, M2 −3°, M3 1°, M4 1°; M5 e as mandíbulas usam posições de exibição fixas. |

Uma pose de calibração mid-travel, incluindo aquela mostrada no guia do LeRobot, não estabelece por si só que todo ângulo URDF é zero. Na referência capturada, defina `referenceRadians` de cada entrada do mapa para o ângulo dessa junta em URDF. Verifique um pequeno movimento da mão para confirmar o sinal de `radiansPerCount`, incluindo o giro do pulso e a pinça. Verifique também uma segunda pose; combinar uma pose não pode confirmar a direção ou escala. A ferramenta não deriva esses ângulos das contagens mínima e máxima.

O mapa padrão de SO-101 não possui ligação de deslocamento exata. O mapa de SO-102 está vinculado aos deslocamentos salvos do braço original. Após a recalibração, atualize o mapeamento físico dos ângulos, bem como seus campos de calibração; alterar apenas esses campos ignora a verificação sem corrigir a exibição. Os relatórios de calibração não são importados automaticamente. A sobreposição em ciano mostra a posição planejada do firmware ou o destino com feedback compacto; é separado da pose de calibração.

Para ajustar ou vincular um mapa a um braço específico, copie `so101-encoder-map.json` ou `encoder-angle-map.json`, edite-o e passe `--mapping YOUR_MAP.json` com qualquer um dos comandos. Os mapas da versão 2 contêm:

- `model`: deve corresponder ao modelo selecionado.
- `joints`: IDs de motor mapeados para URDF nomes de juntas, `referenceCount`, `referenceRadians` e assinados `radiansPerCount`.
- `fixedJoints`: posições das juntas do modelo sem mapeamento medido, em radianos para juntas de revolução ou metros para juntas deslizantes.
- `encoderCalibration`: configurações exatas opcionais per-motor `positionCorrection`, `resolution` e `reverse`, verificadas em relação ao comprovante de gravação.

Cada junta do modelo deve ser mapeada ou fixada explicitamente. As contagens no log já incluem a correção da posição do servo; não subtraia novamente. A resolução do codificador da unidade é necessária. Um codificador invertido requer uma entrada de calibração explícita e um mapeamento de ângulo assinado correspondente. Para mapas personalizados feitos com o formato anterior, copie o mapa da versão 2 e transfira seus ângulos e direções de referência.

<a id="display"></a>
## Exibição

Ambos os modelos possuem fundo neutro e plano de grade translúcido na base. A grade é uma referência visual, sem resposta a colisões; poses abaixo dele permanecem visíveis. A reprodução mantém seu quadro final e não faz loop nem reinicia. O modo ao vivo com um arquivo segue apenas esse arquivo. Com um diretório, ele segue os novos arquivos `.ndjson` nesse diretório, sem pesquisar subdiretórios ou voltar quando um log mais antigo é atualizado.

`1`–`6` selecione um motor; `G` alterna a sobreposição de referência; `C` gráficos; `J` marcadores de juntas; `M`/`R` measured/reference pose; `F` qualidade de renderização; `H` ajuda. A junta selecionada carrega o rótulo de erro. Exibição de leituras ausentes `--`.

O feedback compacto C1 mediu as posições, mas nenhuma referência do planejador; sua comparação usa o destino comandado. O feedback C2 detalhado fornece a referência do planejador. O erro de destino durante o movimento não é um erro de rastreamento. Novos logs de reprodução usam feedback detalhado: a sombra ciano segue as posições intermediárias planejadas do firmware. Os registros compact-feedback mais antigos ainda mostram saltos entre destinos; o visualizador não pode recuperar referências intermediárias ausentes. Os gráficos retêm até 20 segundos e não fabricam novos carimbos de data/hora de medição.

O visualizador reproduz a geometria com contatos e gravidade desativados. Ele não simula a dinâmica do motor nem prevê o ajuste PID. As posições conjuntas são exibidas sem fixação nos limites nominais CAD.

<a id="tests"></a>
## Testes

```sh
PYTHONPATH=tools/simulation tools/simulation/.venv/bin/python -m unittest discover -s tools/simulation/test -v
```
<!-- /translated-content -->
