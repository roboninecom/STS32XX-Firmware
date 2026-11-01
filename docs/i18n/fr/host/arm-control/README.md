<!-- translation-navigation -->
[English](../../../en/host/arm-control/README.md) · [Русский](../../../ru/host/arm-control/README.md) · [Español](../../../es/host/arm-control/README.md) · [Français](README.md) · [Deutsch](../../../de/host/arm-control/README.md) · [Português (Brasil)](../../../pt-BR/host/arm-control/README.md) · [简体中文](../../../zh-CN/host/arm-control/README.md) · [日本語](../../../ja/host/arm-control/README.md) · [हिन्दी](../../../hi/host/arm-control/README.md) · [العربية](../../../ar/host/arm-control/README.md)

[Original anglais](../../../../../host/arm-control/README.md)

> Traduction automatique intégrale, pas encore relue par un locuteur natif. Les images et vidéos sont communes ; leur texte reste dans la langue d’origine.
<!-- /translation-navigation -->

<!-- translated-content -->
<a id="shared-arm-controller-and-gravity-compensation"></a>
# Contrôleur de bras partagé et compensation de gravité

La téléopération en direct, le réglage, la relecture named-pose et la relecture timed-session utilisent un contrôleur suiveur. Il gère la configuration, les cibles, les retours mesurés, la gravité et le nettoyage. Le [servo driver](../servo-driver/README.md) possède le codage et le transport des paquets.

<a id="motor-settings-files"></a>
## Fichiers de paramètres du moteur

Voir les [SO-101 et SO-102 profils](profiles/README.md) pour les paramètres de référence et leurs limites de fonctionnement.

`profiles` peut contenir des paramètres en ligne ou des chemins relatifs au fichier du contrôleur :

```json
"profiles": {"1": "motor-1.json", "2": "motor-2.json"}
```

Le [exemple de profil](../../../../../host/arm-control/profile.example.json) est partagé par les exemples d'outils. Copiez-le pour vos propres paramètres et mettez à jour la référence, ou insérez le profil. Si vous déplacez un fichier de contrôleur, ajustez son profil et ses trajectoires gravitationnelles. Les fichiers nommés `*.local.json` sont ignorés par Git.

Réglez `acceleration` en counts/s² (1–30000) et `rampTimeMs` en millisecondes (1–255) sur le contrôleur. Chaque moteur peut les remplacer avec `accelerationLimit` et `rampTimeMs` dans son profil. Les profils sont les paramètres de l'extension RAM ; Les décalages d'encodeur enregistrés et les limites de course restent séparés.

| Champ de profil | Signification |
| --- | --- |
| `kpQ8`, `kdQ8`, `kiQ8` | Gains du contrôleur multipliés par 256. |
| `integralLimit`, `effortLimit` | Limites de sortie intégrale et totale en unités d'effort PWM. |
| `velocityLimit` | Vitesse maximale en counts/s ; la valeur par défaut est 65535. |
| `velocityFilterQ8` | Réglage du filtre de vitesse mesurée, 1–255. |
| `gravitySlewEffortPerS` | Limite de taux pour les changements d’effort de gravité. |
| `velocityFeedforward` | `positiveGainQ8`, `negativeGainQ8`, `effortLimit` ; zéro tous les trois pour désactiver. |

Consultez le [guide d'enregistrement du micrologiciel](../../DETAILED_DOCUMENTATION.md#configuration--0xa0) pour connaître les unités et gammes complètes. Il s'agit de paramètres per-motor, et non de profils de micrologiciel commutables.

L'application de réglage et de configuration utilise `joints: [{ "followerId": 1 }]` ; ajouter une entrée par moteur contrôlé. La relecture Named-pose obtient les identifiants de l'enregistrement et ne nécessite aucun tableau `joints`. Seules la téléopération en direct et la rediffusion recorded-leader nécessitent `leaderId`, `mapping` et direction/centers en option ; voir [cartographie de téléopération](../../tools/teleoperation/README.md#mapping-and-control).

<a id="enable-gravity"></a>
## Activer la gravité

Ajoutez `gravityModel` à votre configuration existante. Les chemins sont relatifs au **fichier de configuration**, pas au répertoire de travail. Pour une configuration enregistrée à la racine du référentiel :

```json
"gravityModel": "host/arm-control/models/arm-upright-empty.json"
```

Cette ligne est un ajout à une configuration complète, pas un fichier autonome. Fournissez un `profiles` testé pour chaque abonné ; `effortLimit` limite la puissance totale du moteur et `gravitySlewEffortPerS` limite la rapidité avec laquelle l'effort de gravité change. Le réglage seul de l'orientation ne permet pas la gravité. Sans `gravityModel`, la relecture efface tout effort de gravité retenu et s'exécute ensuite sans compensation de gravité.

Les [modèles de bras](models/README.md) fournis préservent l'étalonnage de chaque montant, empty-gripper bras. Leurs coefficients pour les moteurs 2–4 utilisent le nombre d'encodeurs mesuré, y compris les joints couplés ; les moteurs 1, 5 et 6 utilisent explicitement zéro. Chaque adepte contrôlé a besoin d'un modèle, et toutes les articulations utilisées par ses termes doivent être contrôlées et mesurées. Les modèles Angle-dependent déclarent également `encoderCalibration` pour chaque entrée : signés `positionCorrection`, `resolution: 1` et `reverse` (l'indicateur d'inversion de l'encodeur). Preflight les compare avec les registres du moteur et rejette toute inadéquation avant la configuration ou l'activation du couple. Restaurez une sauvegarde correspondante à partir de ce même bras, ou mettez à jour et validez le modèle après le recalibrage. Une capture de référence à 2048 n'établit pas elle-même les angles physiques du modèle ; voir le [guide d'étalonnage](../../tools/settings/README.md#choose-the-reference-pose). Pour l'un ou l'autre modèle six-motor fourni, incluez les ID 1–6 et les six profils. Ne réutilisez pas le modèle après avoir modifié les décalages de l'encodeur, le montage, la géométrie ou la charge utile sans vérifier l'étalonnage.

Utilisez le même champ de configuration pour chaque commande :

```sh
npm run teleoperate -- CONFIG.json
npm run replay -- CONFIG.json POSES.json
npm run replay -- CONFIG.json SESSION.ndjson
```

Ces commandes ne font qu'afficher un aperçu. Ajoutez `--run` pour démarrer le contrôle. La configuration actuelle et les positions mesurées des suiveurs déterminent la gravité ; les valeurs de gravité enregistrées et les gains historiques ne sont jamais rejoués. Le modèle est validé avant utilisation et son chemin et son hachage SHA-256 sont inclus dans le journal de session.

<a id="control-behaviour"></a>
## Comportement de contrôle

1. Le contrôle en amont vérifie le micrologiciel, les limites enregistrées, l'état de santé, les profils et les entrées du modèle.
2. Tous les outils du contrôleur poursuivent une session motorisée compatible ou en préparent une nouvelle automatiquement. Les profils assortis maintiennent le couple ; les profils modifiés sont appliqués un moteur à la fois. Une nouvelle configuration gère la libération, la configuration et la sélection du couple, puis active tous les moteurs préparés ensemble.
3. La gravité est mesurée, envoyée et confirmée avant la première cible de mouvement.
4. Pendant le mouvement et les pauses, une seule passe de rétroaction fournit à la fois des contrôles de santé et des calculs de gravité. La gravité est rafraîchie environ toutes les 50 ms. Il n'y a pas de deuxième lecteur de télémétrie ni de boucle de rétroaction de vitesse hôte.
5. Lors d'une sortie normale, la gravité continue jusqu'au mouvement final et au déplacement gravitationnel restant du micrologiciel. Le contrôleur attend 200 ms de repos, avec un délai d'expiration de 30 s, puis confirme la mise à jour finale de la gravité. Le couple reste activé ; le firmware conserve la dernière cible et l'effort de gravité.

Pour la relecture et la téléopération, Ctrl+C arrête les nouvelles cibles et suit la même séquence d'achèvement. Le réglage interrompt à la place le lot et tente torque-off. Ctrl+C n'est pas un arrêt d'urgence. Le repos signifie que les planificateurs se sont arrêtés et que chaque position mesurée reste dans une plage de one-count sur l'intervalle complet de 200 ms. Cela ne prouve pas une erreur de suivi nulle ; pose/session la relecture applique également sa tolérance d'arrivée configurée.

Le processus arrête de rafraîchir la gravité après la sortie. Si le bras est ensuite déplacé ou si sa charge change, l'effort retenu ne s'adapte pas. Un processus arrêté ou un bus déconnecté peut également laisser la dernière cible et le dernier effort actifs.

<a id="checks-and-timing"></a>
## Contrôles et timing

La gravité utilise des positions de suiveurs mesurées, jamais de cibles demandées. Un échantillon de feedback doit être sain, frais et appartenir à la session en cours. Chaque mise à jour gravitationnelle a sa propre séquence ; l'acceptation est vérifiée lors de la prochaine passe de feedback. Tous les résultats sont vérifiés par rapport aux plafonds d'effort du modèle et du moteur avant toute écriture. Un résultat excessif est une erreur et non une valeur écrêtée.

Les mesures couplées sont séquentielles. L'acquisition, la mise en file d'attente et les écritures ultérieures doivent rester dans les 100 ms du début de leur passe de rétroaction. La prochaine mise à jour doit également avoir lieu dans cette limite ; un lecteur, un enregistreur ou un bus retardé provoque une panne au lieu de continuer silencieusement avec l'ancienne gravité. Il s'agit de vérifications d'hôtes et non de délais d'attente du micrologiciel. Un I/O asynchrone peut retarder la détection ; ils ne font pas de l'hôte un contrôleur real-time.

Les contrôles de santé en direct s'exécutent environ toutes les 250 ms sans gravité ou toutes les 50 ms avec celle-ci. La relecture utilise un retour détaillé de C2 toutes les 50 ms pendant les mises en attente et la lecture chronométrée ; les contrôles d’arrivée peuvent s’interroger plus rapidement. `--compact` remplace les paquets C1 plus petits, qui omettent les positions intermédiaires du planificateur et les contributions PID. Le réglage lit les commentaires détaillés pour tous les moteurs au démarrage, puis C2 pour la sonde et C1 pour les moteurs de support. Les commentaires partagent toujours le lecteur de gravité.

Erreurs de modèle, mises à jour rejetées, commentaires missing/stale, perte de propriété, alarmes et températures égales ou supérieures à 60 °C, tentative vérifiée torque-off sur chaque suiveur préparé. Des échecs de nettoyage sont signalés.

Une exception est le non-respect du délai gravity-update lors d'un maintien établi : le contrôleur ne conserve le couple que si deux nouvelles passes de retour confirment des moteurs stationnaires et sains au cours de la même session. L'exécution échoue toujours et rapporte `holdRetained: true` ; il ne reprend pas automatiquement.

Les enregistrements du journal de télémétrie incluent les commentaires mesurés et la dernière gravité demandée effort/sequence. Les commentaires du micrologiciel confirment cette demande sur un échantillon ultérieur ; une demande enregistrée ne constitue pas à elle seule une preuve d’acceptation. `settledAt` est une estimation prudente de l'hôte du moment où le déplacement gravitationnel demandé peut se terminer.

<a id="api-and-tests"></a>
## API et tests

`session.run` gère les connexions série, les journaux de session et le nettoyage d'une source d'entrée. `ArmController` accepte un pilote suiveur, une configuration, une source d'entrée et une instance `GravityModel` facultative. Charger les modèles avec `await GravityModel.load(filename)` ; le CLI résout le chemin configuration-relative. Les sources d'entrée fournissent `joints`, `preflight`, `describe`, `sample` et `play` ; l'entrée en direct vérifie en outre que son leader n'est pas alimenté. Le réglage automatisé peut demander des commentaires détaillés sur son moteur de sonde via le même lecteur. `changeProfile` vérifie le contrôle stationnaire, libère uniquement ce moteur, le configure et re-enables, puis confirme à nouveau la gravité. Les moteurs de support restent alimentés. Le moteur modifié perd brièvement du couple et capture sa position mesurée au redémarrage ; utilisez une pose soutenue ou mécaniquement sûre pour les changements de profil. Les erreurs de profil utilisent le nettoyage d'échec normal all-motor.

Les sources soumettent des positions via le contrôleur et utilisent ses attentes, de sorte que de longues pauses continuent les mises à jour des commentaires.

Exécutez `npm run test:arm` pour le contrôleur partagé, `npm run test:poses` pour recording/replay et `npm run test:teleoperation` pour le contrôle en direct. Les tests utilisent des réponses en série simulées.
<!-- /translated-content -->
