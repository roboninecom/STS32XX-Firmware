<!-- translation-navigation -->
[English](../../../../en/tools/simulation/urdf/README.md) · [Русский](../../../../ru/tools/simulation/urdf/README.md) · [Español](../../../../es/tools/simulation/urdf/README.md) · [Français](README.md) · [Deutsch](../../../../de/tools/simulation/urdf/README.md) · [Português (Brasil)](../../../../pt-BR/tools/simulation/urdf/README.md) · [简体中文](../../../../zh-CN/tools/simulation/urdf/README.md) · [日本語](../../../../ja/tools/simulation/urdf/README.md) · [हिन्दी](../../../../hi/tools/simulation/urdf/README.md) · [العربية](../../../../ar/tools/simulation/urdf/README.md)

[Original anglais](../../../../../../tools/simulation/urdf/README.md)

> Traduction automatique intégrale, pas encore relue par un locuteur natif. Les images et vidéos sont communes ; leur texte reste dans la langue d’origine.
<!-- /translation-navigation -->

<!-- translated-content -->
<a id="so-arm-102-model"></a>
# Modèle SO-ARM 102

URDF et huit mailles STL de [Robonine SO-ARM-102](https://github.com/roboninecom/SO-ARM-102/tree/0f0dd95526638042a3213598ee0ae7f167c40efe/simulation/urdf), commit `0f0dd95526638042a3213598ee0ae7f167c40efe`. Les fichiers sont copiés sans modification. `source.json` enregistre leurs sommes de contrôle. Les échafaudages de packages Xacro et ROS ne sont pas nécessaires pour charger le URDF autonome.

Copyright (c) 2026 Robonine. Attribution : Robonine, SO-ARM 102, https://github.com/roboninecom/SO-ARM-102, CC BY 4.0. Voir [LICENSE.txt](../../../../../../tools/simulation/urdf/LICENSE.txt) et la [license map](https://github.com/roboninecom/SO-ARM-102/blob/0f0dd95526638042a3213598ee0ae7f167c40efe/LICENSING.md) en amont.

<a id="model-assumptions"></a>
## Hypothèses du modèle

L'estimation de masse en amont est de **0.889 kg**. Cela suppose PLA impression et 70 g par servo. Voir les [paramètres d'exportation](https://github.com/roboninecom/SO-ARM-102/blob/0f0dd95526638042a3213598ee0ae7f167c40efe/simulation/urdf/export_settings.json) et les [propriétés de masse](https://github.com/roboninecom/SO-ARM-102/blob/0f0dd95526638042a3213598ee0ae7f167c40efe/simulation/urdf/mass_properties.json)] en amont. Ce sont des estimations ; le modèle de gravité matérielle mesuré reste distinct.

URDF zéro est la pose CAD exportée. La [table de conversion de l’encodeur](../../../../../../tools/simulation/encoder-angle-map.json) définit les angles M1 – M4 au nombre 2048 sur 0°, −3°, 1° et 1°, respectivement. Le M5 et l’étalonnage des pinces restent non vérifiés. L'affichage à mâchoire fixe utilise +0.016 m et −0.016 m, correspondant au couplage opposite-sign du URDF.

La source conserve ses cases de collision. La préparation du modèle les omet de l'aperçu généré car ces outils désactivent la simulation de contact. Il préserve les visuels, les inertiels et le couplage des articulations. Les résultats de simulation ne calibrent pas la dynamique réelle du moteur ni n’établissent de gains de réglage matériel.
<!-- /translated-content -->
