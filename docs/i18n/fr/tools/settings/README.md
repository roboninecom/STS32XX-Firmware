<!-- translation-navigation -->
[English](../../../en/tools/settings/README.md) · [Русский](../../../ru/tools/settings/README.md) · [Español](../../../es/tools/settings/README.md) · [Français](README.md) · [Deutsch](../../../de/tools/settings/README.md) · [Português (Brasil)](../../../pt-BR/tools/settings/README.md) · [简体中文](../../../zh-CN/tools/settings/README.md) · [日本語](../../../ja/tools/settings/README.md) · [हिन्दी](../../../hi/tools/settings/README.md) · [العربية](../../../ar/tools/settings/README.md)

[Original anglais](../../../../../tools/settings/README.md)

> Traduction automatique intégrale, pas encore relue par un locuteur natif. Les images et vidéos sont communes ; leur texte reste dans la langue d’origine.
<!-- /translation-navigation -->

<!-- translated-content -->
<a id="discovery-calibration-and-settings"></a>
# Découverte, calibrage et réglages

Recherchez les servos STS et sauvegardez ou restaurez leurs paramètres hérités persistants. Utilise le pilote partagé du référentiel et la table de contrôle STS. Nécessite Node.js 20 ou plus récent. Exécutez ces commandes à partir de la racine du référentiel après `npm ci`.

<a id="discover"></a>
## Découvrez

```sh
npm run settings -- discover --port /dev/cu.usbmodemYOUR_ADAPTER
```

Répertorie les ID de moteur répondant et les alarmes signalées sous la forme JSON. La découverte est read-only et analyse le débit en bauds sélectionné, qui est par défaut 1,000,000. Ajoutez `--baud 500000` pour un tarif pris en charge différent. Sous Linux ou Windows, utilisez le port de votre adaptateur, tel que `/dev/ttyUSB0` ou `COM3`.

Les moteurs doivent avoir des identifiants uniques. Discovery ne peut pas distinguer de manière fiable les moteurs qui partagent un ID, ni trouver les moteurs utilisant un autre débit en bauds.

<a id="back-up"></a>
## Sauvegarder

```sh
npm run settings -- backup --port /dev/cu.usbmodemYOUR_ADAPTER --id 2 \
  --file tools/settings/backups/servo-2.json
```

Enregistre l'identité de l'appareil et tous les paramètres persistants décrits par la table de contrôle partagée, y compris l'étalonnage, les limites, les gains, ID et le sélecteur de bauds. La sauvegarde lit uniquement le moteur. Les fichiers existants ne sont jamais écrasés. Sans `--file`, un fichier horodaté est créé sous `tools/settings/backups/`, qui est ignoré par Git.

<a id="restore"></a>
## Restaurer

Connectez uniquement le moteur en cours de restauration, désactivez le couple, verrouillez les paramètres et effacez les alarmes actives. Fermez les autres programmes utilisant le port. Utilisez une sauvegarde du même moteur : la restauration de l'étalonnage d'un autre moteur peut modifier sa position signalée.

```sh
npm run settings -- restore --port /dev/cu.usbmodemYOUR_ADAPTER --id 2 \
  --file tools/settings/backups/servo-2.json
```

`--id` et `--baud` décrivent la **connexion actuelle**. La sauvegarde peut restaurer un ID ou un débit en bauds différent ; l'outil suit ces modifications et signale la connexion finale. Il vérifie l'identité du modèle, écrit uniquement les paramètres modifiés, attend la fin de chaque plage de registre enregistrée, relit les paramètres et reverrouille le moteur. Il n'active jamais le couple ni n'envoie de commande de mouvement. Un échec de restauration peut entraîner la modification de certains paramètres ; inspectez l’erreur avant de réessayer.

Ces sauvegardes couvrent les paramètres hérités, et non la configuration de l'extension ou le modèle de réinitialisation d'usine. Pour la réparation après avoir flashé le micrologiciel d'usine sur un micrologiciel personnalisé, utilisez l'[outil de récupération des paramètres d'usine](../flash/README.md#restore-factory-settings). Ses fichiers de sauvegarde utilisent un format différent et ne sont pas interchangeables avec le JSON de cet outil.

<a id="calibrate-joint-offsets-and-limits"></a>
## Calibrer les décalages et les limites des articulations

Calibrez les moteurs 1–6 avec des ID uniques de 1 à 253 et une course commune limitée mécaniquement. Prend en charge la famille de modèles GD32 STS 9, y compris les variantes de moteurs mixtes, en mode position avec un diviseur de position de 1. Fermez les autres outils série.

```sh
npm run settings -- calibrate --port /dev/cu.usbmodemYOUR_ADAPTER --ids 1,2,3 \
  --file tools/settings/calibrations/arm.json
```

Remplacez les exemples d'ID par vos moteurs. Omettez `--ids` pour calibrer tous les moteurs découverts, jusqu'à six. Une sélection explicite laisse inchangés les autres moteurs connectés. Aucun nom d'articulation, géométrie de bras ou pose de référence standard n'est supposé.

<a id="choose-the-reference-pose"></a>
### Choisissez la pose de référence

La **pose de référence d'étalonnage** est la pose physique que vous capturez à l'étape 1. L'outil fait rapport à chaque moteur sélectionné **2048 à cette pose**. Il ne reconnaît pas la pose, ne déduit pas les angles d'articulation et ne la calcule pas à partir du balayage ultérieur.

Pour un nouvel étalonnage, placez chaque joint vers le milieu de sa course mécanique et choisissez une position que vous pourrez reproduire. Inclure le rouleau de poignet et la pince ; ne présumez pas que la pince doit être complètement ouverte ou fermée. Utilisez la même pose physique à chaque fois. Si le mécanisme a une pose de référence documentée, suivez-la. Pour SO-101, le [guide d'étalonnage LeRobot et la vidéo](https://huggingface.co/docs/lerobot/so101#calibrate) montrent le placement mid-travel suivi d'un balayage end-to-end.

<a id="reference-pose-images"></a>
### Images de pose de référence

Pour un **nouvel étalonnage**, utilisez les guides ci-dessous. Les étiquettes supposent les identifiants de moteur habituels 1–6. Placez la base à la verticale, le haut du bras à la verticale et l'avant-bras et la pince pointés vers l'avant, comme indiqué. Centrez la rotation de la base et le roulement du poignet entre leurs butées mécaniques ; réglez la pince à mi-chemin entre fermé et ouvert. Utilisez le déplacement physique pour trouver ces positions, pas les comptes non calibrés.

<a id="so-101"></a>
#### SO-101

![SO-101 référence d'étalonnage : vues latérales et de dessus avec les six articulations étiquetées, haut du bras droit, avant-bras en avant, rouleau de poignet centré et half-open pince](../../../../../tools/settings/images/so101-reference-pose.png)

<a id="so-102"></a>
#### SO-102

![SO-102 référence d'étalonnage : vues latérales et de dessus avec les six articulations étiquetées, haut du bras droit, avant-bras en avant, rouleau de poignet centré et half-open pince parallèle](../../../../../tools/settings/images/so102-reference-pose.png)

Les images illustrent le placement manuel des nouveaux décalages. Ils n’établissent pas de compatibilité avec un modèle gravitationnel optimisé existant. Les cartes de la visionneuse par défaut utilisent également différentes valeurs de référence wrist/gripper : mettez à jour le mappage si vous calibrez sur ces poses. [Sources d'images et angles du modèle](images/README.md).

La course complète doit s'inscrire dans 0–4095 après que la référence soit devenue 2048 : au plus 2048 compte en dessous de la référence et 2047 au-dessus. Un joint avec une course presque complète nécessite un centrage particulièrement soigné. Une pose reproductible près d'une butée peut ne pas laisser suffisamment de place, même lorsque la course totale est inférieure à un tour.

Si vous avez l'intention d'utiliser un simulateur ou un modèle gravitationnel, sa convention d'angle doit correspondre à cette pose physique. **2048 ne correspond pas automatiquement à zéro degré dans le modèle.** Voir le [cartographie du visualiseur](../simulation/README.md#models-and-calibration) et les [exigences du modèle gravitationnel](../../host/arm-control/models/README.md). Conserver un calibrage déjà vérifié lors de la réutilisation de ses enregistrements et de son modèle ; un flash du micrologiciel qui préserve les paramètres ne nécessite pas de recalibrage.

<a id="capture-offsets-then-limits"></a>
### Capturer les décalages, puis les limites

Une commande guide les deux étapes :

1. **Pose de référence :** placez les joints sélectionnés dans une pose reproductible choisie pour votre mécanisme. Soutenez-le, restez immobile et appuyez sur **Entrée**. L'outil écrit les décalages du moteur afin que chaque articulation sélectionnée indique **2048** à la pose capturée, puis vérifie les registres enregistrés.
2. **Limites des articulations :** déplacez chaque articulation sélectionnée d'une extrémité à l'autre. Faites une brève pause à chaque fin ; ne forcez pas les arrêts. Consultez les nombres minimum, maximum, médian et de déplacement en direct, puis appuyez sur **Entrée**. L'outil écrit des limites avec **10 nombres de dégagement** à l'intérieur de chaque point final mesuré.

Le **Milieu** du tableau est `(Min + Max) / 2`, arrondi à un nombre entier. C'est informatif : les limites de sauvegarde ne déplacent pas 2048 vers ce point médian et ne modifient pas les décalages. Les limites asymétriques sont valables.

Si les moteurs sont alimentés au démarrage, l'outil vous demande de soutenir le mécanisme avant de relâcher le couple. Sinon, il n'y a que les deux invites ci-dessus. Aucun mouvement n'est commandé ; le couple reste désactivé et les réglages sont verrouillés après la sauvegarde.

La capture de référence utilise la médiane de plusieurs lectures. Les petits mouvements de la main n'arrêtent pas l'étalonnage, et un léger mouvement pendant que les décalages sont enregistrés ne nécessite pas une autre confirmation. Les paramètres ayant échoué sont enregistrés à côté du moteur concerné et réessayent automatiquement. L'outil relit avant de réessayer une écriture, donc un accusé de réception manquant n'entraîne pas la réécriture des paramètres already-saved. Les moteurs terminés sont conservés ; aucune confirmation supplémentaire n'est nécessaire.

Les décalages sont enregistrés avant le balayage et ne sont pas modifiés lorsque les limites sont enregistrées. Les limites peuvent être asymétriques autour de 2048. Le bouclage du codeur est suivi ; un franchissement de plage 0 ou 4095 ne peut pas être stocké comme limites ordinaires et affiche `crosses zero` dans la colonne **Vérifier**. Chaque articulation doit se déplacer d'au moins 64 comptes et moins d'un tour complet avant que ses limites puissent être sauvegardées.

Des erreurs de lecture temporaires apparaissent à côté du moteur concerné et s'effacent automatiquement lorsque les lectures valides reprennent. Un mouvement plus rapide de la main ne déclenche pas une erreur speed-limit. Entrez les sauvegardes uniquement lorsque toutes les plages sont valides ; sinon l'enregistrement continue avec les mesures retenues. Utilisez `reset 2` pour effacer uniquement la plage mesurée de M2 et balayez à nouveau ce joint, sans répéter l'étape de référence ou les autres joints. Un véritable passage à zéro nécessite encore une correction de son placement de référence ; la réinitialisation des mesures ne peut pas adapter cette plage physique. Toutes les erreurs du moteur restent visibles à côté du moteur concerné. Les alarmes ou le couple inattendu mettent en pause l'écriture de ses paramètres jusqu'à ce qu'ils soient effacés ; les connexions perdues sont réessayées. La session reste ouverte et conserve les travaux terminés. Lors des tentatives automatiques, appuyez sur Ctrl+C pour annuler.

Le fichier de sortie est écrasé à chaque exécution. Les sauvegardes du moteur sont conservées dans un répertoire unique sous `backups/` à côté de ce fichier et peuvent être utilisées avec `settings restore`. Le rapport enregistre les lectures de référence, les décalages, les plages mesurées et les écritures terminées ; il ne stocke pas de photographie ni d’angles physiques d’articulation. Seul `status: "verified"` signifie que les deux étapes sont terminées.

Tapez `cancel` ou appuyez sur Ctrl+C pour arrêter. **Les décalages déjà enregistrés à l'étape 1 restent enregistrés si l'étape 2 est annulée ou échoue ; les anciennes limites restent jusqu'à ce qu'elles soient remplacées.** Terminez l'étalonnage avant d'autoriser le mouvement. Vous pouvez réexécuter la même commande à partir de la pose de référence, sans restaurer un calibrage précédent JSON.

<a id="expected-travel-warnings"></a>
### Avertissements de voyage attendus

Passez éventuellement `--expected-ranges FILE.json` contenant les nombres de déplacements et les tolérances vérifiés, saisis par le moteur ID. Exemple de format :

```json
{"1": {"counts": 2000, "tolerance": 100}}
```

Ces chiffres illustrent uniquement le format de fichier. Les écarts sont affichés sous forme d'avertissements ; appuyer sur Entrée accepte la plage mesurée. Les joints omis n'ont pas de vérification expected-range.

Terminez l'étalonnage avant d'enregistrer des poses ou d'ajuster la compensation de gravité. Après avoir modifié les décalages, enregistrez à nouveau les poses et mettez à jour ou réajustez le modèle gravitationnel et la cartographie du simulateur. Ni l'un ni l'autre n'est mis à jour par cette commande. Copier les décalages d'un autre bras ou modifier uniquement les champs calibration-check d'un modèle n'établit pas la relation correcte entre les comptes et les angles.

<a id="help-and-tests"></a>
## Aide et tests

```sh
npm run settings -- --help
npm run test:settings
```

Les tests s'exécutent hors ligne sans ouvrir de port série. Les commandes se terminent avec un statut différent de zéro en cas d'échec ; une liste de découverte vide signifie aucune réponse au débit sélectionné.
<!-- /translated-content -->
