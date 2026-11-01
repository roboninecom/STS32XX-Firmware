<!-- translation-navigation -->
[English](../../../../en/host/arm-control/models/README.md) · [Русский](../../../../ru/host/arm-control/models/README.md) · [Español](../../../../es/host/arm-control/models/README.md) · [Français](README.md) · [Deutsch](../../../../de/host/arm-control/models/README.md) · [Português (Brasil)](../../../../pt-BR/host/arm-control/models/README.md) · [简体中文](../../../../zh-CN/host/arm-control/models/README.md) · [日本語](../../../../ja/host/arm-control/models/README.md) · [हिन्दी](../../../../hi/host/arm-control/models/README.md) · [العربية](../../../../ar/host/arm-control/models/README.md)

[Original anglais](../../../../../../host/arm-control/models/README.md)

> Traduction automatique intégrale, pas encore relue par un locuteur natif. Les images et vidéos sont communes ; leur texte reste dans la langue d’origine.
<!-- /translation-navigation -->

<!-- translated-content -->
<a id="gravity-models"></a>
# Modèles gravitationnels

Deux modèles verticaux empty-gripper sont inclus :

- `arm-upright-empty.json`: SO-102.
- `so101-upright-empty.json`: SO-101.

Les deux incluent l'étalonnage du codeur et des termes couplés pour les moteurs 2–4. Les moteurs 1, 5 et 6 ont une compensation explicite nulle. Ils reprennent le montage d'origine, les décalages du codeur et la géométrie du lien. Revérifiez le matériel avant d'utiliser une configuration différente. Les [profils de contrôleur](../profiles/README.md) correspondants décrivent leurs paramètres de fonctionnement et les limitations restantes.

Le fichier contient les coefficients d'effort signés PWM et les paramètres de l'encodeur contre lesquels ils ont été ajustés. `encoderCalibration` répertorie les corrections de position signées, la résolution de l'unité et l'inversion du codeur pour chaque moteur. Le contrôle en amont exige qu'ils correspondent au bras connecté. Les limites et les gains sont des paramètres distincts.

L'étalonnage fait lire la pose physique capturée 2048 ; il n'identifie pas les angles de joint utilisés par ces modèles. Ces angles sont déjà intégrés dans les termes poids et décalages. Reproduire la même pose sur un autre bras peut produire des décalages moteurs différents. Ajuster ou adapter le modèle à ce bras et vérifier sa sortie ; ne copiez pas les décalages du modèle fourni dans les moteurs. Changer uniquement `encoderCalibration` ne met pas à jour le calcul de la gravité. Voir [choisir une pose de référence](../../../tools/settings/README.md#choose-the-reference-pose).

Chaque moteur a un `maxEffort`, un `note` explicatif et une liste de `terms`. Un terme contribue `coefficient * sin(angle)` ou `coefficient * cos(angle)`, où `angle = offsetRad + sum(measuredEncoderCounts[id] * weights[id])`. Les angles sont des radians. Un terme `constant` apporte son coefficient et n'a pas de poids. Une liste vide demande explicitement une compensation nulle.

Tous les identifiants de moteur pondérés doivent figurer parmi les suiveurs contrôlés. Chaque adepte a besoin d'un modèle explicite. L'évaluation rejette les entrées manquantes, les valeurs non finies et les efforts supérieurs au plafond du modèle ou à la limite d'effort moteur configurée ; il ne supprime jamais silencieusement un résultat excessif.
<!-- /translated-content -->
