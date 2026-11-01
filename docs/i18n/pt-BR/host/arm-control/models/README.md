<!-- translation-navigation -->
[English](../../../../en/host/arm-control/models/README.md) · [Русский](../../../../ru/host/arm-control/models/README.md) · [Español](../../../../es/host/arm-control/models/README.md) · [Français](../../../../fr/host/arm-control/models/README.md) · [Deutsch](../../../../de/host/arm-control/models/README.md) · [Português (Brasil)](README.md) · [简体中文](../../../../zh-CN/host/arm-control/models/README.md) · [日本語](../../../../ja/host/arm-control/models/README.md) · [हिन्दी](../../../../hi/host/arm-control/models/README.md) · [العربية](../../../../ar/host/arm-control/models/README.md)

[Original em inglês](../../../../../../host/arm-control/models/README.md)

> Tradução automática completa, ainda não revisada por um falante nativo. Imagens e vídeos são compartilhados; o texto neles permanece no idioma original.
<!-- /translation-navigation -->

<!-- translated-content -->
<a id="gravity-models"></a>
# Modelos gravitacionais

Dois modelos verticais empty-gripper estão incluídos:

- `arm-upright-empty.json`: SO-102.
- `so101-upright-empty.json`: SO-101.

Ambos incluem calibração do encoder e termos acoplados para motores 2–4. Os motores 1, 5 e 6 possuem compensação zero explícita. Eles assumem a montagem original, os deslocamentos do encoder e a geometria do link. Verifique novamente o hardware antes de usar uma configuração diferente. Os [perfis de controlador](../profiles/README.md) correspondentes descrevem suas configurações operacionais e limitações restantes.

O arquivo contém coeficientes de esforço PWM assinados e as configurações do codificador com as quais eles foram ajustados. `encoderCalibration` lista as correções de posição sinalizadas, resolução da unidade e reversão do encoder para cada motor. O preflight exige que eles correspondam ao braço conectado. Limites e ganhos são configurações separadas.

A calibração faz com que a pose física capturada seja lida como 2048; não identifica os ângulos articulares utilizados por esses modelos. Esses ângulos já estão incorporados no termo pesos e compensações. Reproduzir a mesma pose em outro braço pode produzir diferentes deslocamentos motores. Ajustar ou adaptar o modelo a esse braço e verificar o seu resultado; não copie os deslocamentos do modelo fornecido nos motores. Alterar apenas `encoderCalibration` não atualiza o cálculo da gravidade. Veja [escolhendo uma pose de referência](../../../tools/settings/README.md#choose-the-reference-pose).

Cada motor possui um `maxEffort`, um explicativo `note` e uma lista de `terms`. Um termo contribui com `coefficient * sin(angle)` ou `coefficient * cos(angle)`, onde `angle = offsetRad + sum(measuredEncoderCounts[id] * weights[id])`. Os ângulos são radianos. Um termo `constant` contribui com seu coeficiente e não possui pesos. Uma lista vazia solicita explicitamente compensação zero.

Todos os IDs de motor ponderados devem estar entre os seguidores controlados. Cada seguidor requer um modelo explícito. A avaliação rejeita entradas faltantes, valores não finitos e esforço acima do limite do modelo ou do limite de esforço do motor configurado; nunca corta silenciosamente um resultado excessivo.
<!-- /translated-content -->
