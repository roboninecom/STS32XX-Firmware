<!-- translation-navigation -->
[English](../../../en/tools/hw-diff-tests/README.md) · [Русский](../../../ru/tools/hw-diff-tests/README.md) · [Español](../../../es/tools/hw-diff-tests/README.md) · [Français](README.md) · [Deutsch](../../../de/tools/hw-diff-tests/README.md) · [Português (Brasil)](../../../pt-BR/tools/hw-diff-tests/README.md) · [简体中文](../../../zh-CN/tools/hw-diff-tests/README.md) · [日本語](../../../ja/tools/hw-diff-tests/README.md) · [हिन्दी](../../../hi/tools/hw-diff-tests/README.md) · [العربية](../../../ar/tools/hw-diff-tests/README.md)

[Original anglais](../../../../../tools/hw-diff-tests/README.md)

> Traduction automatique intégrale, pas encore relue par un locuteur natif. Les images et vidéos sont communes ; leur texte reste dans la langue d’origine.
<!-- /translation-navigation -->

<!-- translated-content -->
<a id="hardware-comparison-tests"></a>
# Tests de comparaison de matériel

Comparez le firmware d'usine et le firmware personnalisé sur les servos STS. La suite couvre le protocole existant, les paramètres, le mouvement, l'étalonnage et la protection. Il ne teste pas le contrôle du protocole d'extension v9. Les tests utilisent le [pilote partagé](../../host/servo-driver/README.md) du référentiel.

**Utilisez un banc dédié avec des servos sécurisés et des arbres libres.** Certains tests effectuent des mouvements longs ou continus et remplacent les paramètres ou l'étalonnage enregistrés. Sauvegardez d'abord chaque servo. Gardez un moyen de débrancher immédiatement l’alimentation du moteur.

<a id="setup"></a>
## Configuration

Installez Node.js **20 ou plus récent**, puis exécutez à partir de la racine du référentiel :

```sh
npm ci
npm run test:diff
npm run diff -- --list
```

Ces commandes s'exécutent hors ligne. `--list` affiche l'étape de chaque scénario, la classification des mouvements et le nom exact. Utilisez `--help` pour toutes les options de commande.

Connectez uniquement les servos de test : certains cas utilisent des diffusions. Fermez d'autres programmes à l'aide de l'adaptateur et fournissez une alimentation moteur appropriée. Les connexions par défaut sont :

| Paramètre | Par défaut |
|---|---|
| Servo d'usine ID | `1` |
| Servo firmware personnalisé ID | `2` |
| Débit en bauds | `1000000` |

Définissez différentes valeurs avec `--factory-id`, `--candidate-id` et `--baud`. Les identifiants doivent être distincts ; laissez les identifiants **250 et 251** inutilisés car les tests les utilisent temporairement. Commencez avec le couple coupé, les paramètres sont verrouillés et aucune alarme active. Utilisez des moteurs, des alimentations et des charges comparables lorsque vous comparez les mouvements.

```sh
export SERVO_PORT=/dev/cu.usbmodemYOUR_ADAPTER
```

Remplacez le port par le vôtre. Linux utilise couramment `/dev/ttyUSB0` ; sous Windows, transmettez directement un port, tel que `--port COM3`.

<a id="run-tests"></a>
## Exécuter des tests

Commencez par un contrôle de communication :

```sh
npm run diff -- --port "$SERVO_PORT" --case test_ping
```

Exécutez le groupe par défaut :

```sh
npm run diff -- --port "$SERVO_PORT" --stage safe
```

Le groupe `safe` vérifie PING, les lectures de registre et le rejet d'une écriture dans un registre read-only. Il ne pilote pas les moteurs, mais il envoie un paquet WRITE.

Sélectionnez un groupe avec `--stage`, ou un scénario exact avec `--case` :

```sh
npm run diff -- --port "$SERVO_PORT" \
  --case test_motion_write_order_gap_matrix --allow-motion
```

`--case` remplace `--stage`. Les courses ciblées utilisent les paramètres de servo existants ; ils n'installent pas la configuration de test de la suite complète. Vérifiez les conditions préalables signalées pour un cas s'il ne peut pas démarrer.

| Autorisation | Permet |
|---|---|
| `--allow-motion` | Activation du lecteur ou émission de commandes de mouvement |
| `--allow-persistence-write` | Paramètres enregistrés écritures, calibrage et restore-defaults |
| `--allow-template-write` | Remplacement du modèle de réinitialisation enregistré |
| `--allow-current-protection` | Tests pilotés current-protection ; a également besoin d'une autorisation de mouvement |

La suite complète nécessite les quatre autorisations et un débit en bauds initial de 1000000 :

```sh
npm run diff -- --port "$SERVO_PORT" --stage all \
  --allow-motion --allow-persistence-write \
  --allow-template-write --allow-current-protection
```

Ajoutez `--fail-fast` pour arrêter après le premier cas non-passing. Sinon, les affaires indépendantes se poursuivent après les échecs ordinaires. Les conditions préalables défaillantes, les échecs de nettoyage et la perte de communication arrêtent les tests ultérieurs.

<a id="settings-and-cleanup"></a>
## Paramètres et nettoyage

**La suite complète ne restaure pas vos paramètres d'origine.** Elle installe une configuration de test enregistrée et termine en chargeant le modèle de réinitialisation du servo. Le test du modèle remplace ce modèle par les paramètres de la suite.

Ces tests ciblés ont également des effets durables :

- `prerequisites` inclut restore-defaults et l'étalonnage. Son test de décalage enregistre un nouveau décalage qui place la position affichée à 2048.
- `restore-defaults` charge le modèle de réinitialisation enregistré (`0x06`), qui peut différer des paramètres d'origine du fabricant.
- `template` remplace le modèle de réinitialisation (`0x09`) par les paramètres actifs pre-test. L'ancien modèle ne peut pas être relu ou restauré par cette suite.

D'autres cas de persistance tentent de restaurer les paramètres modifiés. Inspectez toujours les erreurs de nettoyage avant une autre exécution. Consultez le [guide de sauvegarde et de récupération des paramètres](../flash/README.md#restore-factory-settings) pour les commandes de sauvegarde et la récupération d'usine.

**Ctrl+C ne garantit pas le nettoyage ou un rapport enregistré.** Le coureur n'a pas de gestionnaire d'interruption gracieux. Si le mouvement doit s'arrêter immédiatement, débranchez l'alimentation du moteur ; puis vérifiez la communication, les paramètres et l'état du couple avant de continuer.

<a id="compare-against-a-saved-factory-run"></a>
## Comparez avec une exécution d'usine enregistrée

Utilisez les mêmes cas, révision de suite, débit en bauds et conditions de banc comparables :

```sh
npm run diff -- --port "$SERVO_PORT" --mode factory --case test_ping

npm run diff -- --port "$SERVO_PORT" --mode candidate --case test_ping \
  --reference tools/hw-diff-tests/results/FACTORY_TIMESTAMP/report.json
```

Remplacez le chemin de référence par le rapport de la première exécution. Conservez l'usine d'origine ID dans `--factory-id` ; le candidat doit avoir un ID différent, même en testant le même servo physique après le flash. La suite ne change rien à ce ID pour vous. Les cas Pair-only sont ignorés en mode single-device. Sans `--reference`, une réussite single-device vérifie uniquement les assertions de ce scénario, pas l'équivalence d'usine.

<a id="results"></a>
## Résultats

Les rapports sont enregistrés sous `tools/hw-diff-tests/results/`, ou dans le répertoire fourni avec `--results`. Les résultats et les journaux sont ignorés par Git.

Ouvrez `report.json` pour les observations, les comparaisons, les paquets transmis, les réponses reçues et le timing de chaque appareil. Inspectez `fatal`, `cleanupError` et `closeError` ainsi que les résultats du cas.

| Résultat | Signification |
|---|---|
| `passed` | Les assertions et toute comparaison disponible ont réussi |
| `mismatch` | Les observations de l'usine et des candidats différaient |
| `failed` | Une vérification d'assertion, de communication ou de récupération a échoué |
| `inconclusive` | L'usine n'a pas produit l'effet nécessaire à la comparaison |
| `skipped` | L'affaire n'a pas été menée |

Le code de sortie **0** signifie qu'aucun échec n'a été signalé ; des cas ignorés peuvent subsister. **1** signifie une erreur argument/setup ou une exception non gérée. **2** signifie que le rapport contient un échec, une incohérence, un résultat non concluant ou une erreur cleanup/connection-close.

Le timing inclut la planification de l'hôte, USB et les retards en série ; il ne s'agit pas d'une mesure directe du temps d'exécution du micrologiciel. Conservez le rapport et reproduisez un cas ciblé avant d’attribuer une différence de mouvement au micrologiciel.
<!-- /translated-content -->
