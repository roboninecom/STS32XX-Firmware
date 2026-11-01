<!-- translation-navigation -->
[English](../en/DETAILED_DOCUMENTATION.md) · [Русский](../ru/DETAILED_DOCUMENTATION.md) · [Español](../es/DETAILED_DOCUMENTATION.md) · [Français](DETAILED_DOCUMENTATION.md) · [Deutsch](../de/DETAILED_DOCUMENTATION.md) · [Português (Brasil)](../pt-BR/DETAILED_DOCUMENTATION.md) · [简体中文](../zh-CN/DETAILED_DOCUMENTATION.md) · [日本語](../ja/DETAILED_DOCUMENTATION.md) · [हिन्दी](../hi/DETAILED_DOCUMENTATION.md) · [العربية](../ar/DETAILED_DOCUMENTATION.md)

[Original anglais](../../../DETAILED_DOCUMENTATION.md)

> Traduction automatique intégrale, pas encore relue par un locuteur natif. Les images et vidéos sont communes ; leur texte reste dans la langue d’origine.
<!-- /translation-navigation -->

<!-- translated-content -->
<a id="detailed-documentation"></a>
# Documentation détaillée

Commencez par le guide **[Quick start](QUICKSTART.md)** pour le flashage, les tests, la relecture et la compensation de gravité. Voir [tools](tools/README.md) pour les guides de commandes individuels.

Firmware pour les servos GD32F130-based STS3215, avec deux façons de contrôler le moteur :

- **Le mode hérité** utilise les commandes standard STS pour la position, la vitesse et la puissance du moteur. Il est activé par défaut.
- **Le mode Extension** ajoute un mouvement fluide, un contrôle de position réglable et une compensation du mouvement et de la gravité. L'ordinateur connecté envoie les paramètres et les destinations ; chaque servo calcule son mouvement localement.

Ce document explique le fonctionnement des fonctionnalités, puis fournit la référence de commande et de registre pour le **protocole d'extension v9.0**. Les paramètres d'extension sont conservés dans la mémoire temporaire et doivent être renvoyés après une réinitialisation ou un cycle d'alimentation. Le logiciel de contrôle doit prendre en charge la version 9 ; les anciens clients d'extension ne sont pas compatibles.

- [Mode hérité](#legacy-mode)
- [Comment fonctionne le mode extension](#how-extension-mode-works)
- [S-curve mouvement](#s-curve-motion)
- [Pose de référence d'étalonnage](#calibration-reference-poses)
- [PID contrôleur](#pid-controller)
- [Réaction de vitesse](#velocity-feedforward)
- [Compensation de gravité](#gravity-compensation)
- [Démarrage et arrêt du mode d'extension](#starting-and-stopping-extension-mode)
- [Protocole d'extension](#extension-protocol)
- [Registres d'extension](#extension-registers)
- [Construction et vérification](#build-and-verification)
- [Disposition du référentiel](#repository-layout)
- [Limites actuelles](#current-limits)

<a id="legacy-mode"></a>
## Mode hérité

Le mode hérité prend en charge l'interface de registre standard STS, y compris la puissance du moteur, le mode de fonctionnement, les commandes de position et de vitesse et les lectures d'état. Le logiciel STS existant peut utiliser les registres **0–86** sans activer l'extension.

Dans les modes de position existants, l'activation de la puissance du moteur sans nouvelle commande de position maintient la position mesurée, même en dehors des limites enregistrées. Il ne rejoue pas une ancienne cible et ne déplace pas l'arbre jusqu'à la limite la plus proche. Les nouvelles commandes de position sont toujours limitées aux limites enregistrées.

L'extension utilise ses propres paramètres de mouvement et de contrôle. Les valeurs de gain ne doivent pas être copiées directement entre les deux modes car leurs échelles diffèrent. La prise en charge des commandes standard ne garantit pas un comportement physique identique sur tous les modèles de servos.

<a id="how-extension-mode-works"></a>
## Comment fonctionne le mode extension

[Regardez l'aperçu enregistré sur YouTube](https://youtu.be/AsxFs24vXQs) | [MP4](../../../assets/readme/videos/overview.mp4)

Le **hôte** est l'ordinateur ou le contrôleur connecté aux servos. Il envoie une **cible** : une destination et une limite de vitesse. Les paramètres d'accélération et de compensation sont configurés avant d'activer la puissance du moteur. Chaque servo alors :

1. Planifie un mouvement fluide vers la destination.
2. Mesure sa position et estime sa vitesse.
3. Ajuste la puissance du moteur pour suivre le mouvement prévu.
4. Contient la destination à la fin du mouvement.

La position et la vitesse prévues à tout moment sont appelées **référence**. Le contrôleur les compare au mouvement mesuré, de sorte qu'une position de référence et une position réelle peuvent différer.

Quelques termes utilisés tout au long de ce document :

| Durée | Signification |
| --- | --- |
| Nombre d'encodeurs | Une unité de mesure de position ; nominalement 4096 compte par tour |
| Effort | La commande signée motor-output : son signe définit la direction et sa taille définit la force de sortie |
| Gagner | Un paramètre qui détermine la force avec laquelle le contrôleur répond |
| Anticipation | Puissance moteur supplémentaire calculée à partir de la demande attendue, plutôt que d'attendre une erreur de position ou de vitesse |
| Commentaires | Mesures et état renvoyés par le servo |
| S'inscrire | Un réglage ou une lecture identifié par un numéro |
| Séance | Une période de contrôle de prolongation, identifiée par un numéro fourni par l'hébergeur |

L'effort est exprimé en unités PWM, les unités utilisées pour contrôler la puissance électrique du moteur. L'extension autorise une limite de sortie jusqu'à **1000** dans les deux sens. Ces valeurs ne sont pas des mesures directes du couple ou du courant.

<a id="s-curve-motion"></a>
## S-curve mouvement

[![Illustration conceptuelle du mouvement s-curve](../../../assets/readme/illustrations/s-curve.png)](https://youtu.be/92mDt4rbobY)

[Regarder sur YouTube](https://youtu.be/92mDt4rbobY) | [MP4](../../../assets/readme/videos/s-curve.mp4)

Rend l'accélération et le freinage plus progressifs. La courbe illustre l'accélération dans le temps. Illustration conceptuelle, données matérielles non mesurées.

Un S-curve fait augmenter et diminuer progressivement l'accélération. Au lieu d’appliquer soudainement une accélération ou un freinage complet, le servo entre et sort facilement de chaque partie du mouvement. Cela peut réduire les secousses mécaniques et les vibrations.

Un mouvement complet de repos en repos comporte ces étapes :

| Scène | Que se passe-t-il |
| --- | --- |
| 1 | L'accélération augmente progressivement |
| 2 | Le servo accélère à un rythme constant |
| 3 | L'accélération diminue progressivement jusqu'à zéro |
| 4 | Le servo se déplace à une vitesse constante |
| 5 | Le freinage augmente progressivement |
| 6 | Le servo freine à un rythme constant |
| 7 | Le freinage diminue progressivement à mesure que le servo s'arrête |

Les mouvements courts sautent des étapes lorsqu'il n'y a pas assez de distance pour atteindre la vitesse ou l'accélération demandée. La même limite d'accélération s'applique lors de l'accélération et du ralentissement.

Le paramètre `ramp_time_ms` contrôle le temps nécessaire à l'accélération pour passer de zéro à sa limite. Une rampe plus longue donne un changement plus doux, mais nécessite généralement plus de temps et de distance pour accélérer ou s'arrêter.

**Jerk** désigne la vitesse à laquelle l'accélération change. Ce planificateur limite les à-coups, donc l'accélération change en douceur. Le Jerk lui-même peut encore changer brusquement entre les étapes. Sa grandeur approximative est :

```text
jerk = 1000 × acceleration / ramp_time_ms    [counts/s³]
```

<a id="changing-a-destination-during-movement"></a>
### Changer de destination pendant le déplacement

Une nouvelle cible continue le mouvement actuellement prévu, en préservant sa position, sa vitesse et son accélération. Renvoyer la même destination ne relance pas le déplacement. Conservez la même limite de vitesse demandée lors de vos déplacements ; il peut changer pour le prochain coup une fois que le mouvement prévu s'est arrêté. Les temps d'accélération et de rampe appartiennent à la configuration et nécessitent une mise hors tension du moteur et une session désarmée pour changer.

Une destination située hors des limites de position Legacy enregistrées est **ramenée à la limite la plus proche**. La vitesse demandée est également plafonnée à sa limite configurée. Le servo utilise l’accélération configurée pour chaque mouvement. Une vitesse nulle ou une accélération configurée nulle est invalide.

L'ensemble du mouvement planifié doit rester à l'intérieur des limites de position. Une nouvelle cible peut donc être rejetée si le servo s'approche déjà trop rapidement d'une limite pour s'arrêter à l'intérieur de celle-ci, même lorsque la destination elle-même est autorisée.

À l'arrivée, le servo maintient automatiquement la destination avec le moteur sous tension. La position mesurée peut encore comporter des erreurs dues au frottement, à la charge, aux limites de sortie ou au réglage. Le maintien continue de corriger l'erreur de position ; il ne gèle pas la puissance du moteur à une valeur fixe.

Chaque servo planifie son propre mouvement. Envoyer plusieurs cibles ensemble ne garantit pas que tous les servos arriveront en même temps.

<a id="shared-position-limits"></a>
### Limites de position partagée

Le contrôle d'héritage et d'extension utilise les mêmes registres position-limit : **9–10** contiennent le minimum et **11–12** le maximum. Chacune est une valeur non signée de 16 bits dans le nombre de codeurs corrigés, y compris la direction configurée et la correction de position du servo. Il n'y a pas de paramètres d'extension distincts position-limit.

L'étalonnage attribue des comptes d'encodeur à des positions physiques. L'[outil d'étalonnage](tools/settings/README.md#choose-the-reference-pose) fait lire la pose de référence capturée 2048, puis mesure les limites de déplacement. Ce nombre ne correspond pas automatiquement à un angle d'articulation de zero-degree et le point médian du déplacement mesuré ne remplace pas la référence capturée. Les modèles gravitationnels et les visualisations nécessitent une cartographie count-to-angle correspondante.

Le micrologiciel lit ces registres au démarrage de la commande. Lorsque les limites sont activées, le minimum doit être inférieur au maximum, le maximum ne doit pas dépasser 32767 et la position mesurée doit se trouver dans cet intervalle. Sinon, le démarrage échoue sans mettre le moteur en mouvement. Le planificateur maintient tout le mouvement, freinage compris, dans l’intervalle lu.

**Des valeurs minimales et maximales égales désactivent les limites de déplacement**, correspondant au comportement existant. Les commandes d'extension restent toujours dans leur plage de positions prise en charge de −32767 à 32767 comptes.

Une écriture acceptée dans l'une ou l'autre des limites met fin à une session d'extension active et coupe l'alimentation du moteur, y compris les écritures qui ne sont appliquées qu'en RAM. Armez une nouvelle session pour utiliser les valeurs modifiées. La persistance normale des paramètres hérités s’applique toujours.

<a id="calibration-reference-poses"></a>
## Poses de référence d'étalonnage

Pour un nouvel étalonnage SO-101 ou SO-102, utilisez les positions des articulations illustrées. Centrez la base et le rouleau de poignet entre leurs butées et laissez la pince à moitié ouverte. L'outil d'étalonnage enregistre cette pose placée manuellement sous le nom 2048 pour chaque moteur. Conservez un étalonnage vérifié existant lors de la réutilisation de ses enregistrements et de son modèle de gravité.

**SO-101 pose de référence**

[![SO-101 pose de référence avec six articulations étiquetées](../../../tools/settings/images/so101-reference-pose.png)](../../../tools/settings/images/so101-reference-pose.png)

**SO-102 pose de référence**

[![SO-102 pose de référence avec six articulations étiquetées](../../../tools/settings/images/so102-reference-pose.png)](../../../tools/settings/images/so102-reference-pose.png)

Ouvrez une image pour une vue plus grande. Suivez le [guide d'étalonnage](tools/settings/README.md#reference-pose-images) pour la procédure two-step et les exigences model-mapping.

<a id="pid-controller"></a>
## PID contrôleur

[![Illustration conceptuelle du contrôle pid](../../../assets/readme/illustrations/pid-tuning.png)](https://youtu.be/TEpvaAMlfrg)

[Regarder sur YouTube](https://youtu.be/TEpvaAMlfrg) | [MP4](../../../assets/readme/videos/pid-tuning.mp4)

Ajuste la façon dont le servo corrige l’erreur de position. La courbe grise illustre l'oscillation ; la courbe blanche illustre une réponse plus amortie. La ligne pointillée est la cible. Illustration conceptuelle, données matérielles non mesurées.

Le contrôleur PID ajuste la sortie du moteur pour suivre le mouvement prévu. Ses trois réglages ont des missions différentes :

| Paramètre | Ce que ça fait | Principal compromis |
| --- | --- | --- |
| **P — correction de position** | Tire le moteur vers la position prévue ; des erreurs plus importantes produisent plus de corrections | Un P plus élevé peut réduire les erreurs mais peut également provoquer une oscillation |
| **I — correction accumulée** | Crée une correction supplémentaire lorsqu'une erreur persiste | Peut réduire une erreur durable, mais peut augmenter le temps de dépassement ou de stabilisation |
| **D — correction de vitesse** | Répond à la différence entre la vitesse planifiée et mesurée ; résiste au mouvement tout en tenant | Peut améliorer l'amortissement, mais une réponse excessive aux lectures de vitesse bruyantes peut rendre la sortie inégale |

Le calcul est :

```text
position error = planned position − measured position
speed error = planned speed − filtered measured speed

motor output = Kp × position error
             + Kd × speed error
             + accumulated I correction
             + gravity compensation
             + velocity feedforward
```

Le résultat est limité à la puissance maximale configurée. La protection du moteur peut la réduire davantage. Les commentaires signalent à la fois la sortie demandée et appliquée afin que l'hôte puisse voir quand le moteur est limité.

La vitesse mesurée est lissée à l'aide de lectures de position récentes et d'un filtre réglable. Un paramètre plus grand `velocity_filter_q8` répond plus rapidement aux changements mais supprime moins de bruit de mesure.

<a id="preventing-excessive-accumulated-correction"></a>
### Prévenir une correction accumulée excessive

La contribution I a sa propre limite. Le contrôleur l'empêche également de continuer à construire dans une direction où la puissance du moteur est déjà limitée ; c'est ce qu'on appelle communément **anti-windup**. Elle peut encore diminuer pour aider le moteur à récupérer de cette limite. Le réglage de `Ki` à zéro désactive et efface la correction I.

Lorsque le servo est presque immobile depuis au moins 50 ms et que l’erreur de position ne dépasse pas un pas d’encodeur, I cesse de s’accumuler. P, D et les deux formes de commande par anticipation restent actifs. La désactivation de la sortie moteur efface la correction I.

<a id="velocity-feedforward"></a>
## Anticipation de vitesse

[![Illustration conceptuelle du feedback de vitesse](../../../assets/readme/illustrations/velocity-feedforward.png)](https://youtu.be/osGGs-nhk9I)

[Regarder sur YouTube](https://youtu.be/osGGs-nhk9I) | [MP4](../../../assets/readme/videos/velocity-feedforward.mp4)

Ajoute la puissance du moteur en fonction de la vitesse prévue, calculée à l'intérieur du servo. Les deux courbes progressent de gauche à droite au fil du temps. Illustration conceptuelle, données matérielles non mesurées.

L’anticipation de vitesse fournit une partie des résultats attendus pour le mouvement avant qu’une erreur de suivi ne se développe. Elle est calculée **à l'intérieur du servo** à partir de la vitesse prévue :

```text
velocity feedforward = velocity gain × planned speed
```

Il y a un gain pour chaque direction et une limite sur la sortie résultante. Les deux gains sont non négatifs ; la direction du mouvement détermine le signe de sortie. Sa limite de sortie ne doit pas être supérieure à la limite principale motor-output.

Étant donné que le servo connaît sa propre vitesse planifiée, la compensation suit automatiquement l'accélération et le freinage et devient nulle lorsque le mouvement planifié s'arrête. L'hébergeur fournit uniquement ses paramètres ; il n'a pas besoin d'envoyer des valeurs velocity-feedforward continues.

Configurez cette fonctionnalité avec les autres paramètres dans `0xA0`, lorsque l'alimentation du moteur est coupée et que la session est désarmée. Réglez les deux gains et sa limite de sortie à zéro pour le désactiver.

<a id="gravity-compensation"></a>
## Compensation de gravité

[![Illustration conceptuelle de la compensation gravitationnelle](../../../assets/readme/illustrations/gravity-compensation.png)](https://youtu.be/25sc41PTDIA)

[Regarder sur YouTube](https://youtu.be/25sc41PTDIA) | [MP4](../../../assets/readme/videos/gravity-compensation.mp4)

L'hôte calcule la contribution et le servo l'applique. La flèche vers le bas représente le poids ; la flèche vers le haut représente le support. Illustration conceptuelle, données matérielles non mesurées.

La compensation gravitationnelle fournit la puissance nécessaire pour supporter le poids d'un bras et sa charge. C'est utile même lorsque le moteur reste immobile, où la vitesse d'anticipation est nulle.

Le **hôte calcule la compensation de gravité** et envoie une valeur de sortie signée à chaque servo. Le calcul peut utiliser les angles des articulations, les dimensions des bras, le poids des maillons et la charge utile. L'hôte doit convertir la charge estimée en unités de sortie du servo. Le firmware ne contient pas de modèle du bras.

La direction compte : la sortie d'extension positive suit l'augmentation du nombre d'encodeurs. La convention joint-angle d'un bras peut s'exécuter dans la direction opposée, la conversion de l'hôte doit donc en tenir compte.

Chaque mise à jour gravitationnelle contient la valeur de sortie souhaitée. Le **taux de montée** (la rapidité avec laquelle la compensation peut changer, en unités de sortie par seconde) fait partie de la configuration principale et reste fixe tout au long de la session.

Le servo modifie progressivement sa compensation vers la valeur demandée et l'ajoute à la sortie du contrôleur. Toutes les contributions restent soumises à la limite de puissance configurée et à la protection du moteur.

**Si les mises à jour de gravité cessent d'arriver, le servo continue vers la dernière compensation demandée à sa vitesse de balayage configurée, puis conserve cette valeur.** Il n'y a pas de minuterie d'expiration. L'hôte doit mettre à jour la compensation lorsque la pose du bras ou la charge change. Le réglage du registre torque-enable **40** sur zéro efface la compensation et désactive la sortie du moteur.

<a id="starting-and-stopping-extension-mode"></a>
## Démarrage et arrêt du mode extension

La séquence suivante utilise les numéros de registre et les commandes documentées ultérieurement. La sélection prépare une séance ; permettant le contrôle des démarrages de la puissance du moteur.

1. Recherchez les identifiants des servos connectés et lisez les capacités de chaque servo. Recherchez `ARMC` et la version `9.0`. Répétez cette vérification après une réinitialisation ou une modification du micrologiciel.
2. Coupez l'alimentation du moteur en réglant l'ancien registre torque-enable **40** sur `0`. Terminez n’importe quelle session existante et appliquez tous les paramètres hérités permanents.
3. Écrivez et relisez la configuration complète (`0xA0`), y compris les paramètres de anticipation de vitesse et le taux de balayage par gravité.
4. Écrivez `mode=1` et un nouveau numéro de session différent de zéro à `0xB8` (3 octets au total). Ceci sélectionne le mode d'extension et prépare le prochain démarrage ; l'alimentation reste coupée.
5. Réglez le registre **40** sur `1`. Le micrologiciel vérifie les capteurs, l'état de protection, la configuration et les limites de position enregistrées, puis capture la position mesurée comme cible de maintien initiale. Les compteurs de commandes, la correction I et la compensation gravitationnelle démarrent à zéro. Lisez `0xC1` et attendez la session correcte, les mesures actuellement utilisables, le moteur activé et la sortie prête.
6. Envoyez des cibles et toutes les mises à jour de gravité. Lisez les commentaires pour vérifier quelles commandes ont été acceptées et dans quelle mesure le servo les suit.
7. Le servo termine son dernier mouvement et maintient la destination jusqu'à ce qu'une nouvelle cible lui soit donnée. Réglez le registre **40** sur `0` pour éteindre le moteur et mettre fin à la session. Pour revenir au mode hérité, coupez l'alimentation et écrivez `mode=0, session=0` à `0xB8`.

Si un démarrage échoue, le registre **40** revient à `0`. Son accusé de réception normal en écriture ne suffit pas à lui seul à confirmer le démarrage réussi : vérifiez la relecture et le retour du registre. Chaque tentative de démarrage consomme la session préparée. Après un démarrage raté, torque-off ou un arrêt de protection, corrigez la cause et écrivez `0xB8` avec un nouveau numéro de session avant de réactiver le couple. La validation répétée du couple pendant le fonctionnement du contrôle préserve ses compteurs de cible, de compensation et de commande.

Les commandes qui déplacent ou ajustent un moteur alimenté nécessitent un matériel prêt, aucun défaut signalé et des lectures de capteur ne dépassant pas **2 ms**. Le contrôleur met normalement à jour toutes les **1 ms** et accepte des intervalles allant jusqu'à 2 ms. Des intervalles plus longs entraînent la désactivation de la sortie du moteur.

Lors de l'utilisation de l'extension, évitez les écritures héritées dans le registre de mode de fonctionnement **33** ou les registres de mouvement **41–47** : ils coupent l'alimentation du moteur et quittent le mode d'extension. L’enregistrement des paramètres permanents met également fin au contrôle des extensions. Le réglage du registre **40** sur `0` laisse le mode d'extension sélectionné, prêt pour une autre configuration de session.

<a id="if-host-commands-stop-arriving"></a>
### Si les commandes de l'hôte cessent d'arriver

Le servo termine le dernier mouvement accepté et continue de maintenir cette destination. La compensation gravitationnelle continue vers sa dernière valeur demandée et y reste. Aucun message répété n'est nécessaire pour maintenir la session active, et la perte de communication avec l'hôte ne modifie pas en soi la cible ni ne coupe l'alimentation du moteur.

Pour changer la direction du servo, envoyez une autre cible. Pour débloquer le moteur, réglez la validation du couple sur zéro. Les contrôles de fraîcheur des capteurs, la protection du moteur et le chien de garde du micrologiciel restent actifs pendant le déplacement et le maintien.

<a id="extension-protocol"></a>
## Protocole d'extension

Cette section décrit les messages exacts échangés entre l'hôte et le servo. Il est destiné aux lecteurs connectant leur propre logiciel.

<a id="message-format-and-number-encoding"></a>
### Format du message et encodage des numéros

Chaque message est un paquet : une séquence d'octets contenant la destination, la commande, les données et une somme de contrôle utilisée pour détecter les erreurs de transmission. Les commandes d'extension utilisent le format de paquet standard STS :

```text
Request:  FF FF ID LENGTH INSTRUCTION PARAMETERS... CHECKSUM
Response: FF FF ID LENGTH LEGACY_ERROR EXT_STATUS DATA... CHECKSUM
```

- Demande `LENGTH = parameter_bytes + 2`.
- Réponse `LENGTH = data_bytes + 3` ; l'état de l'extension occupe le premier paramètre de réponse, séparément de l'octet d'erreur hérité normal.
- `CHECKSUM = ~(ID + LENGTH + instruction_or_error + all_parameter_bytes) & 0xFF`. La somme des réponses comprend `EXT_STATUS` et toutes les données.
- Un champ occupant plusieurs octets envoie en premier l'octet de poids faible (**little-endian**). Par exemple, le nombre 256 est envoyé sous la forme `00 01` sur deux octets.
- `u8`, `u16` et `u32` sont des nombres entiers non négatifs occupant 1, 2 et 4 octets. `i16` et `i32` occupent 2 et 4 octets et peuvent également représenter des nombres négatifs. Les valeurs d'extension signées utilisent le **complément à deux** : par exemple, −1 est `FF FF` dans un champ `i16`. Cela diffère du codage existant des valeurs signées.
- **Q8** signifie qu'une valeur est multipliée par 256 avant la transmission afin que les fractions puissent être représentées sous forme de nombres entiers. Divisez par 256 lors de la lecture. Par exemple, la position 1000 compte est envoyée comme 256000 et le gain 4.5 est envoyé comme 1152.
- La position est en nombre d'encodeur et la vitesse est en counts/s. L'hôte gère toute conversion en angles d'articulation, y compris les changements de direction ou de position zéro.
- **Unicast** signifie un message adressé à un servo. **Broadcast** utilise ID `0xFE` et atteint tous les servos. Les commandes d'extension de diffusion ne génèrent jamais de réponses.

Exemple : lisez le bloc de capacités 8-octet du servo ID 1 :

```text
FF FF 01 04 90 90 08 D2
```

Un **sélecteur** identifie un bloc de registre complet, tel qu'une configuration ou un retour. Accédez-y avec l'extension READ/WRITE et la taille exacte du bloc indiquée ci-dessous. La lecture ou l'écriture d'une partie seulement d'un bloc n'est pas prise en charge et les anciennes commandes READ/WRITE ne peuvent pas accéder à ces blocs.

<a id="instructions"></a>
### Instructions

Les tailles de paramètres ci-dessous excluent l’en-tête du paquet et la somme de contrôle. Dans une réponse, `EXT_STATUS` indique si la commande d'extension a réussi, séparément de `LEGACY_ERROR`, l'octet d'erreur normal du servo. Une lecture réussie ajoute les données demandées après `EXT_STATUS` ; les écritures, les autres commandes et les lectures échouées n'ont pas de données supplémentaires.

| Instructions | Nom | Paramètres | Diffusion |
| --- | --- | --- | --- |
| `0x90` | READ | `selector:u8, count:u8` | Aucune réponse utile |
| `0x91` | WRITE | `selector:u8, block...` | Non accepté |
| `0x99` | GRAVITY | 6 octets, ci-dessous | Non accepté |
| `0x9A` | TARGETS | `session:u16` + 1–6 entrées de 9 octets | Accepté |

Numéros d'instruction `0x92`, `0x93`, `0x94`, `0x95`, `0x96`, `0x97` et `0x98`, et sélecteurs `0xA1`, `0xA3`, `0xB0`, `0xBA`, `0xE0` et `0xF0` sont réservés et ne doivent pas être utilisés.

| Statut de prolongation | Signification |
| --- | --- |
| `0` | OK |
| `1` | Longueur, sélecteur ou valeur de champ non valide |
| `2` | La commande ne peut pas être acceptée dans l'état actuel |
| `3` | Réservé |
| `4` | Réservé |
| `5` | Instruction non prise en charge |

Une incompatibilité de session renvoie un échec d'état. Inspectez à la fois l’octet d’erreur hérité et l’état de l’extension.

<a id="sessions-and-sequence-numbers"></a>
### Sessions et numéros de séquence

L'hôte attribue à chaque session un numéro de 1 à 65535 et l'inclut dans les commandes de contrôle. Cela permet au servo de vérifier qu'une commande appartient à la session en cours. Choisissez un nouveau numéro pour chaque startup ; les numéros de configuration ne sont pas stockés de manière permanente.

Un **numéro de séquence** compte les commandes acceptées dans l'ordre, permettant à l'hôte et au servo d'identifier les commandes manquantes, répétées ou out-of-order.

TARGETS a un compteur de séquence de mouvements per-servo. GRAVITY a un compteur séparé. Les deux démarrent à zéro lorsque l'activation du couple démarre le contrôle ; envoyez normalement **1** en premier. Les nombres augmentent jusqu'à 65535 puis reviennent à **0**, sans mettre fin à la session. Des écarts sont autorisés : après 10, le servo peut accepter 12 même si 11 a été perdu ou rejeté. Les nombres égaux ou plus anciens sont rejetés sans modifier la commande actuelle.

Pour une comparaison exacte, calculez `distance = (incoming − accepted) & 0xFFFF`. Une commande n'est plus récente que lorsque `1 ≤ distance ≤ 32767`. Un saut d'exactement 32768 est ambigu et rejeté. Gardez l'écart par rapport à la dernière commande acceptée ci-dessous 32768 ; si l'historique des commandes est incertain, désactivez le couple, préparez une nouvelle session ID et réactivez le couple. Ne réutilisez pas les paquets mis en file d’attente d’une session ou d’un cycle de compteur antérieur.

L'acceptation nécessite toujours des champs valides, des lectures actuelles du capteur et un mouvement réalisable. Une commande rejetée ne fait pas avancer son compteur. Ces commandes remplacent les cibles absolues ; il ne s'agit pas d'une file d'attente de points de cheminement. Pour visiter chaque point de cheminement, attendez chaque arrivée avant d'envoyer la destination suivante.

Lors de l'envoi d'une cible de groupe, lisez les commentaires de chaque servo pour vérifier sa séquence acceptée. Chaque servo décide indépendamment s'il peut accepter sa cible ; l'un peut le rejeter pendant que les autres se mettent en mouvement.

<a id="targets--0x9a"></a>
### TARGETS — `0x9A`

Les deux premiers octets de paramètres contiennent la session partagée. Chaque entrée suivante a cette disposition ; les décalages sont relatifs au début de cette entrée :

| Décalage | Tapez | Champ |
| --- | --- | --- |
| 0 | `u8` | Servo ID, 1–253 |
| 1 | `u16` | Séquence de mouvement plus récente pour ce servo |
| 3 | `i32` | Position de destination, Q8 compte |
| 7 | `u16` | Vitesse maximale, counts/s, différente de zéro |

La longueur du paramètre est `2 + 9 × entry_count`, au maximum 56 octets. Les identifiants doivent être uniques. Chaque servo vérifie le format et les champs obligatoires de **toutes** les entrées avant de gérer les siennes. Un servo qui n'est pas répertorié ne fait rien. Un servo répertorié vérifie sa session, sa séquence, son état de préparation et si le mouvement peut rester dans ses limites. Une cible acceptée démarre immédiatement et reste active jusqu'à ce qu'elle soit remplacée ou désarmée. Les valeurs sont plafonnées aux limites configurées comme décrit sous S-curve mouvement.

<a id="gravity--0x99"></a>
### GRAVITY — `0x99`

| Décalage | Tapez | Champ / contrainte |
| --- | --- | --- |
| 0 | `u16` | Session en cours |
| 2 | `u16` | Séquence gravitationnelle plus récente |
| 4 | `i16` | Effort de gravité souhaité ; amplitude ≤ limite de sortie configurée |

La longueur du paramètre est exactement de 6 octets. Nécessite une session armée avec le moteur sous tension, le matériel prêt, aucun défaut signalé et des lectures récentes du capteur. Cela ne fait pas avancer la séquence de mouvements. La valeur demandée reste active jusqu'à ce qu'elle soit remplacée ou désarmée.

<a id="extension-registers"></a>
## Registres d'extension

Un **offset** est l'octet de départ d'un champ, comptant à partir de zéro dans son bloc. Les décalages ci-dessous sont décimaux ; les sélecteurs utilisent la notation hexadécimale (`0x...`). Toutes les écritures utilisent l'instruction `0x91` ; les lectures utilisent `0x90` avec le nombre exact d'octets.

| Sélecteur | Bloquer | Accès | Octets |
| --- | --- | --- | --- |
| `0x90` | Capacités | Lire | 8 |
| `0xA0` | Configuration | Read/write | 24 |
| `0xB8` | Sélection du contrôleur et configuration de la session | Écrire | 3 |
| `0xC1` | Retour d'expérience opérationnel | Lire | 32 |
| `0xC2` | Commentaires de réglage | Lire | 54 |

<a id="capabilities--0x90"></a>
### Capacités — `0x90`

| Décalage | Tapez | Valeur/signification |
| --- | --- | --- |
| 0–3 | 4 octets | ASCII `ARMC` |
| 4 | `u8` | Version majeure : 9 |
| 5 | `u8` | Version mineure : 0 |
| 6 | `u8` | Réservé : 0 |
| 7 | `u8` | Intervalle normal de mise à jour du contrôleur : 1 ms |

La version du protocole définit les blocs disponibles et leurs longueurs exactes. La sélection et la configuration de la session partagent un bloc write-only, documenté ci-dessous.

<a id="configuration--0xa0"></a>
### Configuration — `0xA0`

| Décalage | Tapez | Champ | Unités / plage valide |
| --- | --- | --- | --- |
| 0 | `u16` | `kp_q8` | Gain × 256 ; 0–65535 |
| 2 | `u16` | `kd_q8` | Gain × 256 ; 0–65535 |
| 4 | `u16` | `ki_q8` | Gain × 256 ; 0–65535 |
| 6 | `u16` | `integral_limit` | Effort ; 0–`effort_limit` |
| 8 | `u16` | `effort_limit` | Effort ; 1–1000 |
| 10 | `u16` | `velocity_limit` | Counts/s; 1–65535 |
| 12 | `u16` | `acceleration_limit` | Counts/s² ; 1–30000 |
| 14 | `u8` | `velocity_filter_q8` | Réponse Speed-filter ; 1–255, plus haut répond plus rapidement |
| 15 | `u8` | `ramp_time_ms` | Rampe d'accélération ; 1–255 ms |
| 16 | `u16` | `velocity_ff.positive_gain_q8` | Sortie/(count/s) × 256 ; 0–65535 |
| 18 | `u16` | `velocity_ff.negative_gain_q8` | Sortie/(count/s) × 256 ; 0–65535 |
| 20 | `u16` | `velocity_ff.effort_limit` | Effort ; 0–principal `effort_limit` |
| 22 | `u16` | `gravity_slew` | Changement de rémunération, effort units/s ; 1–10000 |

Les gains sont envoyés sous la forme de la valeur souhaitée multipliée par 256. Leurs unités sont output/count pour P, sortie/(count/s) pour D et sortie/(count·s) pour I. Par exemple, P = 4.5 produit 4.5 unités de sortie par nombre d'erreurs et est envoyé sous la forme 1152.

Le servo a **une configuration active**. L'écriture nécessite la mise hors tension du moteur et une session désarmée. Chaque écriture remplace l'intégralité de la configuration, y compris les paramètres de anticipation. Les paramètres non valides rejettent l’intégralité de l’écriture sans rien changer. Lisez `0xA0` pour vérifier les paramètres acceptés.

Les gains Velocity-feedforward sont non négatifs. Une limite de sortie à anticipation nulle nécessite que les deux gains soient nuls. La même limite de sortie anticipée s’applique dans les deux sens et ne doit pas dépasser la limite de sortie principale.

Après une réinitialisation, configurez le servo avant d'activer l'alimentation du moteur. Conservez les paramètres enregistrés et les valeurs de réglage alternatives sur l'hôte ; modifiez les gains entre les courses avec le bras soutenu et le moteur hors tension.

<a id="selection-and-session-setup--0xb8"></a>
### Sélection et configuration de la session — `0xB8`

| Décalage | Tapez | Signification |
| --- | --- | --- |
| 0 | `u8` | Mode : `0` héritage, `1` extension |
| 1 | `u16` | Session : `0` pour l'héritage, `1–65535` pour l'extension |

La longueur exacte de la charge utile est de **3 octets**, avec la session dans l'ordre little-endian. Par exemple, le mode d'extension avec la session `0x1234` est `01 34 12` ; le mode hérité est `00 00 00`. Les combinaisons invalides rejettent l'intégralité de l'écriture sans changer d'état. Les deux modes nécessitent la mise hors tension du moteur et remplacent toute configuration de session antérieure. La sélection à elle seule ne permet pas de démarrer le contrôle ou de capturer une position de maintien.

L'ancien registre torque-enable **40** démarre la session d'extension préparée lorsqu'il est écrit dans `1`. Il nécessite une sortie moteur disponible, une configuration valide, des capteurs initialisés avec des lectures datant de moins de 2 ms, aucun défaut nécessitant un arrêt et des limites de position héritées enregistrées et utilisables. La position mesurée doit être dans ces limites lorsqu'elles sont activées. Ces contrôles ont lieu au moment de l'activation, de sorte que les mouvements ou les défauts entre la configuration et l'activation sont pris en compte.

Torque-off annule à la fois le contrôle en cours et la configuration inutilisée. Les pannes de capteur, l'arrêt de la protection, les modifications position-limit ou encoder-offset, l'étalonnage et l'enregistrement des paramètres permanents invalident également la configuration de la session. Lire les commentaires pour vérifier si le contrôle a réellement commencé ; il n'y a pas de commande ARM distincte. L'ancien sélecteur `0xBA` et l'ancienne charge utile de sélection one-byte sont rejetés.

<a id="operational-feedback--0xc1"></a>
### Retour d'expérience opérationnel — `0xC1`

| Décalage | Tapez | Champ / unités |
| --- | --- | --- |
| 0 | `u32` | Temps de mesure, ms depuis le démarrage ; revient à zéro après 4294967295 |
| 4 | `u16` | Numéro de mesure ; revient à zéro après 65535 |
| 6 | `u16` | Séance |
| 8 | `u16` | Séquence cible acceptée |
| 10 | `u16` | Séquence gravitationnelle acceptée |
| 12 | `u16` | Drapeaux, ci-dessous |
| 14 | `i32` | Position mesurée, Q8 compte |
| 18 | `i32` | Vitesse mesurée filtrée, Q8 counts/s |
| 22 | `i16` | Sortie appliquée ; le positif suit l'augmentation du nombre d'encodeurs |
| 24 | `i16` | Current-sensor lecture par rapport à sa ligne de base ; pas des ampères |
| 26 | `u8` | Tension d'alimentation, unités 0.1 V |
| 27 | `u8` | Température validée, °C |
| 28 | `u8` | Drapeaux du servo hérité fault/status |
| 29 | `u8` | Réservé : zéro |
| 30 | `u16` | Âge de la mesure au moment de la lecture, ms ; valeur maximale signalée 65535 |

| Mors de drapeau | Signification une fois défini |
| --- | --- |
| 0 | L'échantillon est frais et utilisable pour l'état actuel du contrôle du bras |
| 1 | Contrôleur actif |
| 2 | Réservé : zéro |
| 3 | Puissance du moteur limitée |
| 4 | Entraînement du bras activé |
| 5 | Session démarrée par l'activation du couple |
| 6 | Réservé : zéro |
| 7 | Sortie prête |
| 8 | Une commande de gravité a été reçue |
| 9 | Réservé : zéro |
| 10 | Température validée disponible |
| 11 | Réservé : zéro |
| 12 | Cible de mouvement active |
| 13 | Réservé : zéro |
| 14 | Contrôleur d'armement sélectionné |
| 15 | Réservé : zéro |

Chaque indicateur est constitué d'un bit : le bit 0 a la valeur 1, le bit 1 a la valeur 2, le bit 2 a la valeur 4, et ainsi de suite. Plusieurs drapeaux peuvent être définis à la fois. Un contrôleur actif avec le bit 12 clear conserve sa destination. Un mouvement clair ne signifie pas à lui seul que le moteur est alimenté ou prêt.

Les commentaires décrivent une mesure enregistrée. Si l'état du servo change avant que l'hôte ne le lise, certains champs peuvent décrire l'état antérieur. Le bit 0 est effacé lorsque la mesure a plus de 2 ms, que le contrôleur n'est plus sélectionné, armé, en marche ou prêt, ou que ses chiffres session/sequence ne correspondent plus. Vérifiez ensemble le bit 0, l'âge, la session et la séquence acceptée.

Les relevés de position et d'état de santé sont également disponibles en mode hérité et avec le moteur hors tension. Les champs de contrôle indisponibles sont nuls. La séquence d'échantillons avance lorsque les mesures sont acquises, et non à chaque fois que l'hôte les lit. Il distingue les échantillons qui partagent le même horodatage en millisecondes. Les changements de température importants et inattendus sont vérifiés sur plusieurs lectures avant d'apparaître ici ; voir la limitation de protection ci-dessous.

<a id="tuning-feedback--0xc2"></a>
### Commentaires de réglage – `0xC2`

Les octets 0–31 ont exactement la disposition `0xC1`. Les octets restants sont :

| Décalage | Tapez | Champ / unités |
| --- | --- | --- |
| 32 | `i32` | Position de référence, Q8 compte |
| 36 | `i32` | Vitesse de référence, Q8 counts/s |
| 40 | `i16` | Sortie demandée après sa limite configurée, avant la protection du moteur |
| 42 | `i16` | P contribution, effort |
| 44 | `i16` | D contribution, effort |
| 46 | `i16` | Contribution intégrale, effort |
| 48 | `i16` | Compensation gravitationnelle actuellement appliquée, effort |
| 50 | `i16` | Anticipation de vitesse locale, effort |
| 52 | `u16` | Délai supplémentaire accumulé du contrôleur, ms ; maximum 65535 |

Le compteur de retard ajoute le temps supplémentaire chaque fois qu'une mise à jour du contrôleur prend plus que la normale 1 ms (`elapsed_ms − 1`). Cela ne compte pas les messages perdus. Les contributions P et D déclarées sont limitées à ±32767, donc l'ajout des valeurs affichées peut ne pas reproduire le calcul interne complet.

Le servo envoie des commentaires uniquement lorsque cela lui est demandé. Utilisez `0xC1` pour une surveillance normale et `0xC2` lorsque le réglage nécessite des valeurs supplémentaires. La lecture de `0xC2` inclut déjà la totalité de `0xC1`, donc la lecture des deux ajoute inutilement du trafic. Des lectures distinctes peuvent faire référence à différents moments ; comparer leurs horodatages et leurs numéros d’échantillon.

<a id="build-and-verification"></a>
## Construction et vérification

Les sources du micrologiciel, les tests et les règles de construction se trouvent dans [`firmware/`](firmware/README.md). Après avoir installé la [toolchain](firmware/README.md#build-and-verify), exécutez :

```sh
make
make verify
```

La sortie de construction passe à `build/` ignorée. La vérification est hors ligne et ne fait pas flasher le matériel. Voir [project checks](tools/README.md#offline-checks) pour les tests d'hôte, flashing-tool et de visionneuse. Pour installer une version publiée du micrologiciel, utilisez l'[outil Flash et de récupération](tools/flash/README.md).

<a id="repository-layout"></a>
## Disposition du référentiel

| Annuaire | Responsabilité |
| --- | --- |
| [`firmware/`](firmware/README.md) | Sources C, en-têtes, pilotes matériels, script de liaison, règles de construction et tests de micrologiciel |
| [`host/servo-driver/`](host/servo-driver/README.md) | Pilote Node.js installable pour les commandes héritées et l'extension v9 |
| [`tools/teleoperation/`](tools/teleoperation/README.md) | Contrôler un suiveur d'un leader hand-operated |
| [`tools/poses/`](tools/poses/README.md) | Enregistrez les poses et rejouez-les avec le contrôle d'héritage ou d'extension |
| [`tools/settings/`](tools/settings/README.md) | Découverte du moteur, calibrage conjoint et réglages backup/restore |
| [`tools/tuning/`](tools/tuning/README.md) | Comparer les paramètres du contrôleur par lots |
| [`tools/simulation/`](tools/simulation/README.md) | Visualisez les mouvements en direct et lisez la télémétrie enregistrée |
| [`tools/hw-diff-tests/`](tools/hw-diff-tests/README.md) | Tests de comparaison du matériel pour les micrologiciels d'usine et personnalisés |
| [`tools/diagnostics/`](tools/diagnostics/README.md) | Benchmarks de latence des bus et contrôles de télémétrie stationnaire |
| [`tools/flash/`](tools/flash/README.md) | Flashage du micrologiciel et récupération des paramètres |

Pour les détails d'implémentation, consultez les [commandes d'extension](../../../firmware/app/arm_extension.c), [planificateur de mouvement](../../../firmware/core/control/arm_motion.c), [contrôleur d'armement](../../../firmware/core/control/arm_control.c) et [runtime](../../../firmware/app/runtime.c). Les avis de redistribution des fournisseurs sont conservés dans les en-têtes et [fournisseur README](firmware/platform/gd32f130/vendor/README.md).

<a id="current-limits"></a>
## Limites actuelles

[![Jeu de boîte de vitesses et flexion du cadre](../../../assets/readme/posters/mechanical-limits.jpg)](https://youtu.be/53l7at5aE6k)

[Regarder sur YouTube](https://youtu.be/53l7at5aE6k) | [MP4](../../../assets/readme/videos/mechanical-limits.mp4)

La température signalée via le retour d'extension est vérifiée pour supprimer les sauts isolés, mais la protection thermique du moteur utilise toujours les lectures brutes du capteur. Cela signifie qu'une brève mauvaise lecture peut affecter la protection même si elle est filtrée du retour d'extension.

Les gains, les limites et la compensation doivent être ajustés au mécanisme lui-même. Les tests logiciels à eux seuls ne permettent pas d'établir comment un bras se comportera sous charge. Vérifiez la position mesurée, la vitesse et la sortie appliquée pour évaluer la précision, la stabilisation et si le moteur atteint sa limite de sortie.
<!-- /translated-content -->
