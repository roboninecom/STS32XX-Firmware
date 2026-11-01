<!-- translation-navigation -->
[English](../../../en/tools/tuning/README.md) · [Русский](../../../ru/tools/tuning/README.md) · [Español](../../../es/tools/tuning/README.md) · [Français](README.md) · [Deutsch](../../../de/tools/tuning/README.md) · [Português (Brasil)](../../../pt-BR/tools/tuning/README.md) · [简体中文](../../../zh-CN/tools/tuning/README.md) · [日本語](../../../ja/tools/tuning/README.md) · [हिन्दी](../../../hi/tools/tuning/README.md) · [العربية](../../../ar/tools/tuning/README.md)

[Original anglais](../../../../../tools/tuning/README.md)

> Traduction automatique intégrale, pas encore relue par un locuteur natif. Les images et vidéos sont communes ; leur texte reste dans la langue d’origine.
<!-- /translation-navigation -->

<!-- translated-content -->
<a id="automated-tuning"></a>
# Réglage automatisé

Exécutez un lot limité de paramètres candidats, comparez les mouvements répétés et les prises plus longues, et obtenez une recommandation machine-readable. Utilise le même pilote v9, le même contrôleur et le même modèle de gravité calibré pour la relecture et la téléopération. Aucun paramètre n'est écrit dans EEPROM et aucun candidat gagnant n'est automatiquement installé.

<a id="start"></a>
## Commencer

Depuis la racine du référentiel, installez les dépendances Node.js 20+ avec `npm install`. Copiez `controller.example.json` et `example.json` à côté des originaux comme `controller.local.json` et `plan.local.json`. Définissez le `config` du plan sur `controller.local.json`, puis modifiez le port, les identifiants du moteur, les profils, les paires de déplacements communs sécurisés et les limites de votre mécanisme. Les exemples de gains et de poses sont illustratifs. Le contrôleur fait référence au [profil de moteur](../../../../../host/arm-control/profile.example.json) partagé ; copiez-le pour vos propres paramètres et mettez à jour son chemin, ou insérez le profil. Incluez chaque moteur de support comme `{ "followerId": ID }` dans `joints` ; aucune cartographie des leaders n’est nécessaire. Effectuez le [calibrage](../settings/README.md#choose-the-reference-pose) avant de choisir les positions de test. Les positions utilisent des comptes d'encodeurs corrigés ; un nouveau décalage change leur signification physique. Mettre à jour les paires de tests, les enregistrements et le modèle gravitationnel après le recalibrage. Pour la gravité, ajoutez `gravityModel` exactement comme décrit dans le [guide du contrôleur partagé](../../host/arm-control/README.md).

Le chemin `config` du plan est relatif au plan. Le profil du contrôleur et les chemins `gravityModel` sont relatifs à ce fichier de contrôleur. La même configuration de contrôleur peut être utilisée pour la relecture de pose. Omettez `durationMs` pour le réglage : le plan est propriétaire du budget du lot. Sécurisez le mécanisme de démarrage et de modification de profil. Changer un profil libère brièvement ce moteur ; une nouvelle configuration peut libérer tous les abonnés configurés.

```sh
npm run tune -- inspect tools/tuning/plan.local.json
npm run tune -- preflight tools/tuning/plan.local.json
npm run tune -- run tools/tuning/plan.local.json
```

L'outil continue de prendre en charge les articulations au niveau des cibles de maintien du micrologiciel existantes. Seul `probeId` parcourt ses paires de tests déclarées. Il n'y a pas de repositionnement automatique whole-arm. Les cibles actuelles et les positions mesurées sont enregistrées pour comparaison entre les exécutions. Utilisez les chemins d’articulation révisés pour la configuration actuelle du bras.

Utilisez la même commande pour le premier lot et pour chaque lot suivant :

```sh
npm run tune -- run NEXT_PLAN.json
```

Les modifications de démarrage et de profil utilisent le [cycle de vie du contrôleur partagé](../../host/arm-control/README.md#control-behaviour). N'exécutez pas un autre contrôleur sur le même bus.

`inspect` ne se connecte pas. `preflight` lit le micrologiciel, l'étalonnage, les limites enregistrées, la santé et les profils sans modifier les moteurs. `run` les déplace. Les cibles sont plafonnées aux limites de positions enregistrées ; le contrôle en amont rapporte le chemin effectif. Une paire repliée dans une position ne peut pas être utilisée comme exercice de réglage.

<a id="tuning-order"></a>
## Ordre de réglage

1. **Référence :** vérifiez l'étalonnage, les mouvements sûrs, les températures et la répétabilité avec les paramètres existants. Utilisez `stage: "baseline"` et aucun candidat.
2. **Gravité :** conservez des gains de feedback modestes et comparez le ralenti dans les deux sens dans plusieurs poses et au moins deux vitesses. Commencez avec un modèle calibré. `stage: "gravity"` collecte les données d'identification sans modifier les gains.
3. **Réaction anticipée de vitesse :** une fois la gravité vérifiée, comparez les gains de vitesse directionnelle en utilisant un mouvement stable à plusieurs vitesses.
4. **P/D et filtrage de vitesse :** filtre un petit ensemble explicite de candidats. Incluez des poses avec une charge de gravité élevée et faible, puis utilisez des prises plus longues pour exposer les oscillations. Un petit lot factoriel peut comparer P, D et le filtrage ensemble ; vérifier la meilleure combinaison sur les paires held-out.
5. **Intégral :** uniquement si une erreur persistante persiste ; comparer la précision des mouvements ainsi que les longues prises. Incluez de petites inversions : de longs balayages peuvent à eux seuls manquer une limite intégrale qui empêche un joint stationnaire de surmonter le frottement. Conservez le zéro intégral à moins que le résultat ne prenne en charge son activation.
6. **Temps d'accélération et de rampe :** avec les gains fixes, utilisez `stage: "motion"` pour comparer l'accélération et le lissage aux vitesses requises.
7. **Mouvements combinés :** rejouez un parcours enregistré qui exerce chaque articulation et comprend des configurations pliées et étendues. Un gain qui fonctionne avec des articulations de support stationnaires peut osciller lorsque l'ensemble du mécanisme bouge. Revérifiez les joints modifiés sur ce même chemin avant d'accepter leurs réglages.
8. **Validation :** figez la configuration sélectionnée, répétez le chemin à chaque vitesse et accélération requises, puis maintenez les poses représentatives plus longtemps. Enregistrez la précision, le dépassement, la stabilisation, la température et la saturation de sortie pour chaque moteur. Revérifiez après avoir modifié la charge utile ou l'étalonnage.

`stage` restreint les champs de candidature : `velocity` autorise `velocityFeedforward` ; `pid` autorise `kpQ8`, `kdQ8`, `velocityFilterQ8` ; `integral` autorise `kiQ8` et `integralLimit` ; `motion` autorise `accelerationLimit` et `rampTimeMs`. Les étapes de référence, de gravité et de validation collectent des données sans changement de candidat. P/D/I et les gains de vitesse utilisent les unités Q8 du firmware : divisez par 256 pour le gain correspondant. Les limites de sortie restent les limites explicitement fournies par le contrôleur tout au long du lot.

Gardez le temps d'accélération et de rampe fixes tout en comparant les gains. Comparez ensuite les paramètres de mouvement aux vitesses requises. L'accélération maximale configurable est 30,000 counts/s² ; la valeur utilisable dépend des limites de charge et d'effort. Vérifiez la référence réelle et les vitesses mesurées : les courses courtes peuvent ne jamais atteindre la vitesse demandée.

Le gain intégral et sa limite doivent être testés ensemble. Une correction accumulée importante peut continuer à entraîner une articulation après le relâchement du frottement, provoquant un dépassement. La limite intégrale limite uniquement cette correction ; la puissance totale du moteur est contrôlée séparément par `effortLimit`. Préférez une erreur résiduelle stable à une recherche répétée et signalez tout critère de précision auquel les paramètres sélectionnés ne répondent pas.

<a id="reuse-settings"></a>
## Réutiliser les paramètres

Un profil de contrôleur peut être un fichier JSON distinct, par exemple `"profiles": {"1": "motor-1.json"}`. Les chemins sont relatifs au fichier du contrôleur. Les fichiers moteur contiennent les mêmes champs que les profils en ligne ; facultatifs `accelerationLimit` et `rampTimeMs` remplacent les valeurs par défaut partagées. La relecture, la téléopération et le réglage chargent ces fichiers via le même chargeur. Les paramètres sont appliqués à RAM lors de la configuration de l'extension, non enregistrés dans EEPROM.

Exportez un contrôleur dans un nouveau répertoire contenant un fichier par moteur, `controller.json`, un `gravity.json` facultatif et un manifeste :

```sh
npm run tune -- export CONFIG.json NEW_DIRECTORY
```

L'exportation ne se connecte pas aux moteurs et ne certifie pas les paramètres. Utilisez le `controller.json` exporté avec la relecture, la téléopération ou un plan de réglage.

Pour appliquer les paramètres acceptés et conserver la position actuelle :

```sh
npm run tune -- apply NEW_DIRECTORY/controller.json
```

Le démarrage gère automatiquement les moteurs alimentés et non alimentés. Dans une session existante, seuls les moteurs modifiés sont brièvement désactivés et reconfigurés, un à la fois. Les moteurs de support restent alimentés et les cibles existantes sont conservées. L'omission du modèle de gravité supprime l'effort de gravité retenu. Replay applique sa configuration automatiquement, cette commande n'est donc nécessaire que pour appliquer les paramètres sans relecture.

Conservez ensemble les paramètres acceptés, le modèle de gravité, l'étalonnage, la description payload/mounting et les preuves de validation. Un autre bras a besoin de son propre étalonnage et validation. Ne restaurez pas les décalages d'encodeur d'un autre bras.

<a id="how-a-batch-works"></a>
## Comment fonctionne un lot

Pour la sélection, l'outil exécute la ligne de base → tous les candidats → la ligne de base. Chaque bloc exerce chaque paire et chaque vitesse dans les deux sens, en alternant la première approche entre les répétitions. Si les deux lignes de base dérivent au-delà de `driftRatio`, le lot se termine comme non concluant et conserve sa position motorisée. La dérive de position permet un nombre d'encodeurs de quantification. Les candidats éligibles sont classés et jusqu'à `finalists`, répétez la comparaison entre les lignes de base partagées sur différentes paires de validation avec des prises plus longues. Une recommandation nécessite de réussir la validation et de dépasser sa ligne de base.

Les mesures incluent le suivi du mouvement RMS, l'erreur et l'étendue de position stable, le dépassement, le temps de stabilisation, le temps de réponse total et la fraction de saturation. La sédimentation nécessite une période finale continue à l'intérieur de la bande ; une traversée précoce ne compte pas. Si les retenues de filtrage sont plus courtes que le temps de stabilisation autorisé plus le temps d'arrêt, les mesures de retenue et de stabilisation sont signalées comme différées. Le dépistage classe ensuite l'erreur de déplacement, le dépassement et la saturation. La validation la plus longue doit réussir toutes les métriques avant qu'une recommandation ne soit faite. Utiliser la validation dure suffisamment longtemps pour couvrir le temps de stabilisation autorisé et un intervalle d’observation constant. Les limites d'acceptation sont fournies dans le plan. Une réponse infructueuse mais valable peut être notée ; les échantillons périmés, les alarmes, les dépassements de contrôle, les erreurs de suivi excessives, les mouvements de support, les limites temperature/voltage ou les échecs de journalisation arrêtent le lot et utilisent le [nettoyage des échecs partagés](../../host/arm-control/README.md#checks-and-timing). Un lot échoué ne fournit aucune recommandation.

Les commentaires et la gravité utilisent le [lecteur partagé](../../host/arm-control/README.md#checks-and-timing). Le plan estime l'utilisation du fil et rejette les demandes égales ou supérieures à 50 % de la capacité nominale ; les écarts réels sont vérifiés pendant l'exécution. La visualisation lit le journal.

**La modification d'un profil supprime brièvement le couple de ce moteur.** Les moteurs de support restent contrôlés. Le contrôleur attend le repos avant le changement et confirme ensuite la gravité ; voir [changements de profil](../../host/arm-control/README.md#api-and-tests).

Un maintien de point final déjà effectué est réutilisé avant d'inverser la direction ; l'outil n'envoie pas de cible de configuration en double et n'ajoute pas un autre délai de configuration.

L'achèvement normal restaure la ligne de base configurée et conserve le maintien motorisé avec compensation de gravité finale. Ctrl+C interrompt le lot de réglage et tente torque-off ; soutenir le mécanisme avant de l’interrompre. Un processus déconnecté ou tué peut laisser le micrologiciel conserver sa dernière cible. L'outil ne revient pas automatiquement à une position de repos.

<a id="results-and-agent-workflow"></a>
## Résultats et flux de travail des agents

Les exécutions sont enregistrées dans des répertoires `tools/tuning/logs/<run>/` ignorés :

- `events.ndjson` : plan/configuration exact, hachages d'implémentation, modèle gravitationnel, calibrage, modifications de profil, commandes, mesures et résultats d'essais.
- `summary.json` : état de réalisation, comparaisons, validation et recommandation.

Soumettez un plan contenant plusieurs candidats explicites, laissez le lot entier se terminer, puis inspectez le résumé. Utilisez les événements bruts pour les critères ayant échoué ou les résultats ambigus. Cela évite un processus et un cycle d’analyse par paramètre. Un budget de durée délimite toujours le travail. Un lot incomplet n’a aucune recommandation.

Recalculez les résultats ou extrayez les fenêtres d'identification steady-motion :

```sh
npm run tune -- analyse tools/tuning/logs/RUN/events.ndjson
node tools/tuning/cli.js extract tools/tuning/logs/RUN/events.ndjson > tools/tuning/logs/dataset.json
node tools/tuning/cli.js fit tools/tuning/logs/dataset.json
```

L'extraction nécessite des analyses gravity/velocity terminées, dans les deux sens et à plusieurs vitesses en termes de criblage et de validation. Il rejette les fenêtres accélératrices, saturées, mal mesurées et moving-support. Les ajustements maintiennent des trajectoires entières séparées entre l'entraînement et la validation, et utilisent la base gravitationnelle d'exécution. Ils renvoient des coefficients effort-space non révisés, pas de couple articulaire mesuré ni de modèle déployable. Mettez à jour le modèle et répétez délibérément les vérifications matérielles indépendantes.

Utilisez le [simulation viewer](../simulation/README.md) sur le même fichier d'événements pour inspecter le bras pendant ou après une exécution. Cela n’ajoute aucun trafic de bus.

<a id="tests"></a>
## Essais

Exécutez `npm run test:tuning` ou `npm test` pour tous les outils Node.js. Les tests ne se connectent pas aux moteurs.
<!-- /translated-content -->
