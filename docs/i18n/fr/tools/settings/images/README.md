<!-- translation-navigation -->
[English](../../../../en/tools/settings/images/README.md) · [Русский](../../../../ru/tools/settings/images/README.md) · [Español](../../../../es/tools/settings/images/README.md) · [Français](README.md) · [Deutsch](../../../../de/tools/settings/images/README.md) · [Português (Brasil)](../../../../pt-BR/tools/settings/images/README.md) · [简体中文](../../../../zh-CN/tools/settings/images/README.md) · [日本語](../../../../ja/tools/settings/images/README.md) · [हिन्दी](../../../../hi/tools/settings/images/README.md) · [العربية](../../../../ar/tools/settings/images/README.md)

[Original anglais](../../../../../../tools/settings/images/README.md)

> Traduction automatique intégrale, pas encore relue par un locuteur natif. Les images et vidéos sont communes ; leur texte reste dans la langue d’origine.
<!-- /translation-navigation -->

<!-- translated-content -->
<a id="calibration-illustrations"></a>
# Illustrations d'étalonnage

Vues latérales et supérieures rendues à partir des modèles de robots fournis, avec étiquettes de joint et instructions de placement ajoutées. Ce sont des guides pour un **nouvel étalonnage manuel**, et non des photographies ou des mesures des bras réglés.

- `so101-reference-pose.png` : La géométrie SO-101 du Robot Studio, distribuée sous Apache-2.0. [Source et licence épinglées](../../simulation/urdf/so101/README.md).
- `so102-reference-pose.png` : géométrie SO-ARM-102 de Robonine, CC BY 4.0. [Source et licence épinglées](../../simulation/urdf/README.md). Cette illustration est une adaptation avec la pose, l'appareil photo, l'arrière-plan et les étiquettes définis pour ce guide ; il est également disponible sous CC BY 4.0.

<a id="poses-used-in-the-images"></a>
## Poses utilisées dans les images

M1–M4 utilisez les mappages de visionneuse fournis au nombre 2048. Les positions du rouleau de poignet et de la pince sont réglées séparément au milieu des limites de déplacement du modèle. Les butées physiques sur le mécanisme lui-même déterminent ces points médians lors du placement manuel.

| Modèle | M1–M4 angles d'articulation | Roulement du poignet | Pince |
| --- | --- | --- | --- |
| SO-101 | 0°, 0°, 0°, 0° | 2.789° | Mâchoire mobile 45° |
| SO-102 | 0°, −3°, 1°, 1° | −1° | Positions des mâchoires coulissantes +0.02075 m et −0.02075 m |

Les angles sont relatifs à chaque cadre de joint URDF, et non les angles mesurés par rapport à la table. Ces wrist/gripper positions diffèrent des cartes de visionneuse par défaut ; ni les cartes ni les modèles gravitationnels publiés n'ont été modifiés pour ces images. Pour faire correspondre un nouvel étalonnage, mettez à jour les angles de référence de la visionneuse et la liaison d'étalonnage comme décrit dans le [guide de la visionneuse](../../simulation/README.md#match-the-calibration-reference).
<!-- /translated-content -->
