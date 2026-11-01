<!-- translation-navigation -->
[English](../../../en/tools/simulation/README.md) · [Русский](../../../ru/tools/simulation/README.md) · [Español](../../../es/tools/simulation/README.md) · [Français](README.md) · [Deutsch](../../../de/tools/simulation/README.md) · [Português (Brasil)](../../../pt-BR/tools/simulation/README.md) · [简体中文](../../../zh-CN/tools/simulation/README.md) · [日本語](../../../ja/tools/simulation/README.md) · [हिन्दी](../../../hi/tools/simulation/README.md) · [العربية](../../../ar/tools/simulation/README.md)

[Original anglais](../../../../../tools/simulation/README.md)

> Traduction automatique intégrale, pas encore relue par un locuteur natif. Les images et vidéos sont communes ; leur texte reste dans la langue d’origine.
<!-- /translation-navigation -->

<!-- translated-content -->
<a id="telemetry-viewer"></a>
# Visionneuse de télémétrie

Affichez la télémétrie en direct ou rejouez un enregistrement de contrôleur dans MuJoCo. La visionneuse lit les fichiers journaux ; il ne se connecte jamais aux moteurs ni n’envoie de commandes. Les deux modèles utilisent la même visionneuse, les mêmes graphiques et la même superposition de référence. Il affiche le mouvement enregistré ; il ne prédit pas la dynamique du moteur ni les résultats de réglage.

<a id="install"></a>
## Installer

Depuis la racine du référentiel, en utilisant Python 3.12 :

```sh
python3.12 -m venv tools/simulation/.venv
tools/simulation/.venv/bin/python -m pip install -r tools/simulation/requirements.txt
```

<a id="live-and-recorded-playback"></a>
## Lecture en direct et enregistrée

Lancez-le une fois pour regarder la session la plus récente et basculez automatiquement lorsqu'une autre relecture ou exécution de téléopération crée un journal :

```sh
mkdir -p logs/motion
tools/simulation/.venv/bin/python tools/simulation/viewer.py live logs/motion --model so101
```

Le répertoire doit exister. Un répertoire vide attend son premier journal. Les préférences de fenêtre, de caméra et d'affichage restent inchangées entre les exécutions ; les graphiques sont réinitialisés à chaque nouvelle session. Démarrez la relecture matérielle séparément dans un autre terminal.

Pour suivre un journal particulier ou lire un journal enregistré depuis le début :

```sh
tools/simulation/.venv/bin/python tools/simulation/viewer.py live /path/to/events.ndjson --model so101

tools/simulation/.venv/bin/python tools/simulation/viewer.py play /path/to/events.ndjson --model so101
```

La commande sélectionne automatiquement le lanceur de fenêtre natif sur macOS, y compris les chemins de référentiel contenant des espaces. Sélectionnez `--model so102` pour SO-102 ; c'est également la valeur par défaut en cas d'omission. Les modèles et les maillages sont regroupés, la visualisation ne nécessite donc aucune étape de téléchargement ou d'importation.

Pour un aperçu PNG, utilisez Python ordinaire sur toutes les plateformes :

```sh
tools/simulation/.venv/bin/python tools/simulation/viewer.py play /path/to/events.ndjson --model so101 --render preview.png
```

La visionneuse accepte les journaux d'événements du contrôleur, les fichiers de pose non nommés JSON. Envoyez les fichiers de pose via [hardware replay](../poses/README.md#replay-poses), puis affichez le journal résultant. La lecture préserve la durée d'enregistrement et conserve l'image finale. L'affichage en direct se met à jour uniquement après un passage complet du feedback moteur. Les mesures retardées sont étiquetées périmées ; les commandes seules ne peuvent pas les actualiser. Un journal remplacé ou tronqué doit être rouvert. La fermeture de la visionneuse laisse le contrôle matériel actif.

<a id="models-and-calibration"></a>
## Modèles et calibrage

| Modèle | Source | Afficher le mappage |
| --- | --- | --- |
| `so101` | [Abonné officiel SO-101](urdf/so101/README.md), Apache 2.0 | Les six moteurs, y compris le rouleau de poignet et la mâchoire de préhension révolutionnaire. |
| `so102` | [SO-ARM-102](urdf/README.md), CC BY 4.0 | Cartographie calibrée M1–M4 existante ; le rouleau du poignet et les mâchoires restent fixes. |

SO-101 utilise le `so101_new_calib.urdf` en amont. Sa carte par défaut suppose un assemblage standard et chaque URDF zéro commun au nombre d'encodeurs 2048. Les comptes positifs augmentent chaque angle d'articulation de URDF de 2π/4096 radians par compte. Cette convention doit correspondre à la pose de référence de votre bras et aux directions de vos articulations ; l'affichage indique qu'il **pose de référence supposée**, et non l'alignement hardware-verified. La pince utilise directement l'angle de l'encodeur, et non l'ouverture 0–100 normalisée de LeRobot. Son zéro URDF doit correspondre à l'angle de la mâchoire à votre référence d'étalonnage ; cela n'est pas déduit des limites de déplacement enregistrées.

SO-102 conserve ses clapets encoder-calibration existants et son accouplement à mâchoires fixes. Changer de modèle ne modifie pas le contrôleur matériel ni son modèle de gravité.

<a id="match-the-calibration-reference"></a>
### Faire correspondre la référence d'étalonnage

L'[outil de calibrage](../settings/README.md#choose-the-reference-pose) définit 2048 à la pose que vous capturez. Le spectateur convertit séparément ces comptes en angles :

```text
angle = referenceRadians + (counts − referenceCount) × radiansPerCount
```

| Carte groupée | Angles d'articulation affichés lorsque les comptes sont 2048 |
| --- | --- |
| SO-101 | 0° pour les six articulations URDF ; il s'agit d'une hypothèse, pas d'une pose physique détectée. |
| SO-102 | M1 0°, M2 −3°, M3 1°, M4 1° ; M5 et les mâchoires utilisent des positions d'affichage fixes. |

Une pose d'étalonnage mid-travel, y compris celle présentée dans le guide de LeRobot, n'établit pas en soi que chaque angle URDF est nul. À votre référence capturée, définissez le `referenceRadians` de chaque entrée de carte sur l'angle de cette articulation dans le URDF. Vérifiez un petit mouvement de la main pour confirmer le signe `radiansPerCount`, y compris le mouvement du poignet et la pince. Vérifiez également une deuxième pose ; faire correspondre une pose ne peut pas confirmer la direction ou l’échelle. L'outil ne dérive pas ces angles des comptes minimum et maximum.

La carte par défaut de SO-101 n'a pas de liaison de décalage exacte. La carte de SO-102 est liée aux décalages enregistrés du bras d'origine. Après recalibrage, mettre à jour la cartographie de l'angle physique ainsi que ses champs de calibrage ; la modification de ces champs uniquement contourne la vérification sans corriger l'affichage. Les rapports d'étalonnage ne sont pas importés automatiquement. La superposition cyan montre la pose prévue du micrologiciel ou la destination avec un retour compact ; elle est distincte de la pose d'étalonnage.

Pour ajuster ou lier une carte à un bras particulier, copiez `so101-encoder-map.json` ou `encoder-angle-map.json`, modifiez-la et transmettez `--mapping YOUR_MAP.json` avec l'une ou l'autre des commandes. Les cartes de la version 2 contiennent :

- `model` : doit correspondre au modèle sélectionné.
- `joints` : identifiants de moteur mappés sur URDF noms communs, `referenceCount`, `referenceRadians` et signés `radiansPerCount`.
- `fixedJoints` : positions des joints modèles sans cartographie mesurée, en radians pour les joints révolutés ou en mètres pour les joints coulissants.
- `encoderCalibration` : paramètres facultatifs exacts per-motor `positionCorrection`, `resolution` et `reverse`, vérifiés par rapport au contrôle en amont de l'enregistrement.

Chaque joint de modèle doit être mappé ou explicitement corrigé. Les comptes dans le journal incluent déjà la correction de position du servo ; ne le soustrayez plus. La résolution de l’encodeur unitaire est requise. Un codeur inversé nécessite une entrée d'étalonnage explicite et un mappage d'angle signé correspondant. Pour les cartes personnalisées réalisées avec le format précédent, copiez la carte version 2 et transférez vos angles et directions de référence.

<a id="display"></a>
## Affichage

Les deux modèles ont un fond neutre et un plan quadrillé translucide à la base. La grille est une référence visuelle, sans réponse de collision ; les poses en dessous restent visibles. La lecture conserve son image finale et ne boucle ni ne redémarre. Le mode Live avec un fichier suit uniquement ce fichier. Avec un répertoire, il suit les nouveaux fichiers `.ndjson` dans ce répertoire, sans rechercher de sous-répertoires ni revenir en arrière lorsqu'un ancien journal est mis à jour.

`1`–`6` sélectionnez un moteur ; `G` bascule la superposition de référence ; `C` cartes ; `J` repères articulaires ; `M`/`R` measured/reference pose ; `F` qualité du rendu ; `H` aide. L'assemblage sélectionné porte l'étiquette d'erreur. Les lectures manquantes affichent `--`.

Le feedback compact C1 a mesuré les positions mais aucune référence de planificateur ; sa comparaison utilise la destination commandée. Un feedback détaillé C2 fournit la référence du planificateur. L'erreur de destination pendant le mouvement n'est pas une erreur de suivi. Les nouveaux journaux de relecture utilisent un retour détaillé : l'ombre cyan suit les positions intermédiaires planifiées du firmware. Les anciens journaux compact-feedback affichent toujours des sauts entre les destinations ; le spectateur ne peut pas récupérer les références intermédiaires manquantes. Les graphiques conservent jusqu'à 20 secondes et ne créent pas de nouveaux horodatages de mesure.

Le spectateur reproduit la géométrie avec les contacts et la gravité désactivés. Il ne simule pas la dynamique du moteur et ne prédit pas le réglage PID. Les positions des joints sont affichées sans serrage aux limites nominales CAD.

<a id="tests"></a>
## Essais

```sh
PYTHONPATH=tools/simulation tools/simulation/.venv/bin/python -m unittest discover -s tools/simulation/test -v
```
<!-- /translated-content -->
