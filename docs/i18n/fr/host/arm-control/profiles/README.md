<!-- translation-navigation -->
[English](../../../../en/host/arm-control/profiles/README.md) · [Русский](../../../../ru/host/arm-control/profiles/README.md) · [Español](../../../../es/host/arm-control/profiles/README.md) · [Français](README.md) · [Deutsch](../../../../de/host/arm-control/profiles/README.md) · [Português (Brasil)](../../../../pt-BR/host/arm-control/profiles/README.md) · [简体中文](../../../../zh-CN/host/arm-control/profiles/README.md) · [日本語](../../../../ja/host/arm-control/profiles/README.md) · [हिन्दी](../../../../hi/host/arm-control/profiles/README.md) · [العربية](../../../../ar/host/arm-control/profiles/README.md)

[Original anglais](../../../../../../host/arm-control/profiles/README.md)

> Traduction automatique intégrale, pas encore relue par un locuteur natif. Les images et vidéos sont communes ; leur texte reste dans la langue d’origine.
<!-- /translation-navigation -->

<!-- translated-content -->
<a id="arm-profiles"></a>
# Profils de bras

Paramètres de référence à partir des bras verticaux empty-gripper. Chaque répertoire contient un fichier de contrôleur et un profil par moteur, y compris PID et l'anticipation de vitesse directionnelle. Les deux contrôleurs utilisent les modèles gravitationnels pour les moteurs 2–4 ; les moteurs 1, 5 et 6 reçoivent un effort en apesanteur.

| Profil | Vitesse de relecture | Accélération | Portée |
| --- | ---: | ---: | --- |
| [SO-101](../../../../../../host/arm-control/profiles/so101/controller.json) | 1,000 counts/s ; plafond profilé 1,500 | 10,000 counts/s² | Paramètres de réglage conservés. L'oscillation de mouvement M1 et les excursions plus lentes M2 restent non résolues. |
| [SO-102](../../../../../../host/arm-control/profiles/so102/controller.json) | 2,000 counts/s | 15,000 counts/s² | Paramètres de comparaison actuels fixed-profile. Cette configuration rapide nécessite encore une validation matérielle. |

Ce sont des points de départ, et non des valeurs par défaut universelles ou une affirmation d'un réglage terminé. Le profil SO-102 utilise un M1 D=0.0625 fixe, un M6 P=4 et une rampe de 100 ms. L'ancienne rediffusion utilisait M1 D=0.75 lors du déplacement, M6 P=16 et une rampe de 180 ms, donc ce fichier ne reproduit pas cette ancienne exécution.

<a id="use"></a>
## Utiliser

Définissez `followerPort` dans le fichier de contrôleur choisi. Gardez le profil relatif et les chemins de gravité intacts. Depuis la racine du référentiel :

```sh
npm run replay -- host/arm-control/profiles/so102/controller.json POSES.json
npm run replay -- host/arm-control/profiles/so102/controller.json POSES.json --run
```

Utilisez `so101` pour l'autre profil. La première commande affiche un aperçu ; le second bouge le bras et le laisse tenir la pose finale. Replay applique les profils à RAM. Pour la téléopération, définissez également `leaderPort` et ajoutez `leaderId`, `mapping` et tout remplacement direction/center à chaque articulation ; voir le [guide de cartographie](../../../tools/teleoperation/README.md#mapping-and-control).

Les modèles gravitationnels incluent l’étalonnage de l’encodeur utilisé lors du montage. Le contrôle en amont exige qu'il corresponde au bras connecté. **Ne copiez pas les décalages de l'encodeur d'un autre bras pour satisfaire à cette vérification.** Calibrez votre bras, ajustez ou adaptez son modèle, et validez le résultat à vitesse modeste avant utilisation full-speed. Les modifications apportées au montage, à la géométrie du lien ou à la charge utile nécessitent également une validation. Voir le [format du modèle gravitationnel](../models/README.md) et la [procédure de réglage](../../../tools/tuning/README.md).

Ces fichiers ne définissent pas de pose d'étalonnage physique universelle. Suivez le [reference-pose guide](../../../tools/settings/README.md#choose-the-reference-pose) avant de créer un nouvel étalonnage. Le réglage de tous les moteurs sur 2048 reproduit la pose capturée sur ce bras, sous réserve de ses limites enregistrées et de son erreur de suivi ; il ne reproduit pas automatiquement la pose zéro des deux modèles groupés.
<!-- /translated-content -->
