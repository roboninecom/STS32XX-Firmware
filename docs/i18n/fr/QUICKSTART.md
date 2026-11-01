<!-- translation-navigation -->
[English](../en/QUICKSTART.md) · [Русский](../ru/QUICKSTART.md) · [Español](../es/QUICKSTART.md) · [Français](QUICKSTART.md) · [Deutsch](../de/QUICKSTART.md) · [Português (Brasil)](../pt-BR/QUICKSTART.md) · [简体中文](../zh-CN/QUICKSTART.md) · [日本語](../ja/QUICKSTART.md) · [हिन्दी](../hi/QUICKSTART.md) · [العربية](../ar/QUICKSTART.md)

[Original anglais](../../../QUICKSTART.md)

> Traduction automatique intégrale, pas encore relue par un locuteur natif. Les images et vidéos sont communes ; leur texte reste dans la langue d’origine.
<!-- /translation-navigation -->

<!-- translated-content -->
<a id="quick-start"></a>
# Démarrage rapide

Pour les servos GD32F130-based STS TTL. Les commandes ci-dessous utilisent la syntaxe shell macOS/Linux et sont exécutées à partir de la racine du référentiel. Les outils de mouvement d'extension nécessitent le micrologiciel v9 ; La relecture héritée prend également en charge le micrologiciel d'usine.

<a id="1-install"></a>
## 1. Installer

Installez Node.js 20+ et Python 3.10+ ; la visionneuse de simulation facultative a besoin de Python 3.12.

```sh
npm ci
python3 -m venv tools/flash/.venv
tools/flash/.venv/bin/python -m pip install -r tools/flash/requirements.txt
export SERVO_PORT=/dev/cu.usbmodemYOUR_ADAPTER
```

Remplacez le port par le vôtre, par exemple `/dev/ttyUSB0` sous Linux. Les exemples utilisent le moteur ID **1** et le baud **1000000** ; ajustez-les en fonction de votre servo.

<a id="2-back-up-and-flash"></a>
## 2. Sauvegarder et flasher

**Le flashage peut endommager le servo ou effacer son étalonnage.** Immobilisez le mécanisme, utilisez une alimentation stable, désactivez le couple et fermez les autres programmes utilisant le port série. Les réglages doivent être verrouillés et les alarmes effacées avant le flashage. Pour un flashage normal du micrologiciel personnalisé, les moteurs ayant des ID uniques peuvent rester connectés : flashez un ID à la fois et ne faites pas de power-cycle du bus. La récupération exige de ne connecter que le servo à récupérer.

```sh
npm run settings -- discover --port "$SERVO_PORT"
npm run settings -- backup --port "$SERVO_PORT" --id 1
```

Téléchargez le **micrologiciel personnalisé ZIP** à partir de la [v0.1-preview release](https://github.com/roboninecom/STS32XX-Firmware/releases/tag/v0.1-preview) sous **Assets**. Extrayez son image de firmware et `release.json` ensemble dans `tools/flash/releases/custom/`. N'utilisez pas les archives **Code source** de GitHub pour le flashage.

```sh
tools/flash/.venv/bin/python tools/flash/flash.py inspect \
  --manifest tools/flash/releases/custom/release.json
tools/flash/.venv/bin/python tools/flash/flash.py flash \
  --manifest tools/flash/releases/custom/release.json --port "$SERVO_PORT" --id 1
```

Tapez `FLASH` lorsque vous y êtes invité et maintenez l'alimentation connectée jusqu'à la fin de la vérification. Répétez la commande flash pour chaque moteur ID, en attendant la vérification à chaque fois. Voir [clignotant et récupération](tools/flash/README.md) si la vérification échoue.

Le **micrologiciel d'usine ZIP** sert à revenir au micrologiciel d'usine, pas aux outils de mouvement ci-dessous. Extrayez-le dans un dossier séparé et suivez [restauration des paramètres d'usine](tools/flash/README.md#restore-factory-settings) après le flashage. Conservez chaque image du firmware avec son propre `release.json`.

<a id="3-calibrate-joint-offsets-and-limits"></a>
## 3. Calibrer les décalages et les limites des articulations

Pour un mécanisme avec une course articulaire limitée, sélectionnez les ID de moteur à calibrer :

```sh
npm run settings -- calibrate --port "$SERVO_PORT" --ids 1,2,3 \
  --file tools/settings/calibrations/arm.json
```

Remplacez les exemples d'ID par les vôtres ; omettez `--ids` pour utiliser tous les moteurs découverts (jusqu'à six). Pour SO-101 et SO-102, voir les [images de pose de référence étiquetées](tools/settings/README.md#reference-pose-images). La commande comporte deux étapes :

1. Placez chaque articulation sélectionnée, y compris le rouleau de poignet et la pince, dans la pose de référence du mécanisme. Pour une nouvelle configuration sans, choisissez une pose reproductible près du milieu de la course de chaque articulation. Restez immobile et appuyez sur **Entrée** pour enregistrer les décalages afin qu'ils lisent 2048 à cette pose.
2. Déplacez chaque joint sélectionné d’un bout à l’autre, en faisant une brève pause aux extrémités. Consultez le tableau en direct et appuyez sur **Entrée** pour enregistrer les limites.

Soutenir le mécanisme tout au long ; ne forcez pas les arrêts. Le couple reste désactivé. Le fichier est mis à jour automatiquement et les sauvegardes du moteur sont conservées. Si la deuxième étape échoue, les décalages de la première étape restent enregistrés : terminez l'étalonnage avant d'activer le mouvement. Le point médian mesuré ne remplace pas la référence capturée. 2048 n'est qu'une référence d'encodeur ; il n'établit pas d'angle physique pour la simulation ou la gravité. Voir [choisir la pose de référence](tools/settings/README.md#choose-the-reference-pose). Faites-le avant d’enregistrer des poses ou d’installer une compensation de gravité. Les bras existants avec un calibrage vérifié n'ont pas besoin d'être recalibrés après un flash settings-preserving.

<a id="4-check-communication"></a>
## 4. Vérifier la communication

Gardez le couple coupé. Réglez `--ids` sur les moteurs connectés.

```sh
npm test
npm run bus-benchmark -- --port "$SERVO_PORT" --ids 1 --repetitions 100
npm run telemetry -- --port "$SERVO_PORT" --ids 1 --samples 1000 --interval-ms 20 \
  --output tools/diagnostics/results/first-check
```

`npm test` est hors ligne. Les autres commandes lisent le matériel et impriment les chemins des rapports. Utilisez à chaque fois un nouveau répertoire de sortie de télémétrie ; ajustez `--voltage-min` et `--voltage-max` si votre alimentation est en dehors de la plage 8–16 V par défaut. Inspectez les pannes et les lectures signalées avant le mouvement. Pour les comparaisons factory/custom, suivez le [guide de test du matériel](tools/hw-diff-tests/README.md) : sa suite complète déplace les moteurs et remplace les paramètres enregistrés et les modèles de réinitialisation.

<a id="5-record-and-replay-poses"></a>
## 5. Enregistrez et rejouez les poses

Soutenez le mécanisme avant de relâcher le couple. Déplacez-le à la main, saisissez un nom pour enregistrer chaque pose, puis tapez `done`. Utilisez tous les ID de moteur requis pour un bras.

```sh
npm run record-poses -- --port "$SERVO_PORT" --ids 1
cp tools/poses/replay.example.json tools/poses/controller.local.json
```

Modifiez `tools/poses/controller.local.json` : définissez `followerPort`, fournissez une entrée `profiles` pour chaque moteur et choisissez les gains, les limites d'effort, la vitesse et l'accélération appropriés. Les exemples de valeurs sont illustratifs. L'exemple fait référence à un profil partagé ; copiez ce profil pour vos propres gains et mettez à jour son chemin, ou mettez les paramètres en ligne. Les chemins sont relatifs au fichier du contrôleur. Vérifiez d'abord l'étalonnage enregistré et les limites de position. Le bus suiveur doit contenir exactement les moteurs configurés. Replay gère les moteurs alimentés et non alimentés et applique automatiquement les paramètres modifiés.

Remplacez `POSES.json` par le chemin enregistré de l'enregistreur :

```sh
npm run replay -- tools/poses/controller.local.json POSES.json
npm run replay -- tools/poses/controller.local.json POSES.json --run
```

La première commande affiche un aperçu ; `--run` active le mouvement. **L'achèvement normal laisse les moteurs alimentés, maintenant la cible finale. Ctrl+C n'est pas un arrêt d'urgence.** Voir [paramètres de relecture](tools/poses/README.md#replay-poses).

Pour comparer en utilisant les paramètres PID hérités enregistrés des moteurs, sans compensation :

```sh
npm run replay-legacy -- POSES.json --port "$SERVO_PORT" --run
```

Aucun fichier de contrôleur n'est nécessaire. Omettez `--run` pour un aperçu read-only. Voir [relecture héritée](tools/poses/README.md#legacy-replay) pour les paramètres de vitesse et d'accélération.

<a id="6-enable-gravity-compensation"></a>
## 6. Activer la compensation de gravité

Pour `tools/poses/controller.local.json`, ajoutez ce champ top-level :

```json
"gravityModel": "../../host/arm-control/models/arm-upright-empty.json"
```

Le modèle inclus est destiné au **SO-ARM-102 calibré et vertical avec une pince vide**. Incluez les moteurs 1–6 et les six profils. Les moteurs 2–4 reçoivent une compensation ; les autres reçoivent zéro. L'étalonnage du codeur doit correspondre ; le montage, la géométrie ou la charge utile modifiés nécessitent un modèle validé. Ne modifiez pas l’étalonnage simplement pour contourner une discordance. Pour un mécanisme ou un étalonnage différent, ajustez et validez un modèle correspondant.

[Les profils de contrôleur SO-101 et SO-102](host/arm-control/profiles/README.md) incluent PID, la anticipation de vitesse et les modèles de gravité correspondants. Lisez leurs limites avant utilisation ; ils sont liés au calibrage des bras installés.

La relecture, la téléopération et le réglage utilisent ce même champ. La gravité suit les positions mesurées pendant que l'outil fonctionne ; après la sortie, seul l'effort final est conservé. Consultez le [guide de gravité](host/arm-control/README.md) pour connaître les exigences du modèle.

<a id="7-tune-and-view-motion"></a>
## 7. Ajuster et visualiser le mouvement

Copiez et modifiez le [plan de réglage](../../../tools/tuning/example.json) et [l'exemple de contrôleur](../../../tools/tuning/controller.example.json) ; définissez le chemin `config` du plan vers votre fichier de contrôleur. Pour la première manche, utilisez de petits mouvements sûrs, `"stage": "baseline"` et `"candidates": []`.

```sh
npm run tune -- inspect PLAN.json
npm run tune -- preflight PLAN.json
npm run tune -- run PLAN.json
```

Seul `run` déplace le matériel. Suivez l'[ordre de réglage](tools/tuning/README.md#tuning-order) : ligne de base → gravité → anticipation de vitesse → P/D et filtrage → intégral si nécessaire → acceleration/ramp temps → mouvement combiné → validation.

Pour la visualisation, installez le [simulation viewer](tools/simulation/README.md), puis utilisez le chemin event-log imprimé par replay ou tuning :

```sh
tools/simulation/.venv/bin/python tools/simulation/viewer.py live EVENTS.ndjson --model so101
tools/simulation/.venv/bin/python tools/simulation/viewer.py play EVENTS.ndjson --model so101
```

Utilisez `--model so102` pour l'autre modèle de bras fourni. Vérifiez la convention reference-pose dans le guide du spectateur. La commande gère automatiquement le lanceur de fenêtre macOS. Le spectateur affiche un mouvement mesuré ; il ne prédit pas les résultats du réglage. Pour le contrôle hand-operated à l'aide d'adaptateurs leader et suiveur séparés, voir [téléopération](tools/teleoperation/README.md).
<!-- /translated-content -->
