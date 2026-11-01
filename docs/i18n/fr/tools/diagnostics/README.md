<!-- translation-navigation -->
[English](../../../en/tools/diagnostics/README.md) · [Русский](../../../ru/tools/diagnostics/README.md) · [Español](../../../es/tools/diagnostics/README.md) · [Français](README.md) · [Deutsch](../../../de/tools/diagnostics/README.md) · [Português (Brasil)](../../../pt-BR/tools/diagnostics/README.md) · [简体中文](../../../zh-CN/tools/diagnostics/README.md) · [日本語](../../../ja/tools/diagnostics/README.md) · [हिन्दी](../../../hi/tools/diagnostics/README.md) · [العربية](../../../ar/tools/diagnostics/README.md)

[Original anglais](../../../../../tools/diagnostics/README.md)

> Traduction automatique intégrale, pas encore relue par un locuteur natif. Les images et vidéos sont communes ; leur texte reste dans la langue d’origine.
<!-- /translation-navigation -->

<!-- translated-content -->
<a id="bus-benchmark-and-telemetry-diagnostics"></a>
# Benchmark bus et diagnostic télémétrique

Deux outils command-line pour les servos STS : mesurez les performances de communication et vérifiez la télémétrie stationnaire pour les lectures inhabituelles. Nécessite Node.js 20 ou plus récent. Depuis la racine du référentiel, installez les dépendances avec `npm install`.

Gardez les moteurs à l'arrêt avec le couple coupé et les réglages verrouillés. Arrêtez les autres programmes utilisant le port série. Les deux outils vérifient les servos sélectionnés avant et après une course. Ni l’un ni l’autre n’active le couple, ne déplace un moteur, ne fait flasher le micrologiciel ou n’enregistre les paramètres.

<a id="bus-benchmark"></a>
## Référence des bus

```sh
npm run bus-benchmark -- --port /dev/cu.usbmodemXXXX --ids 1,2 --repetitions 1000
```

Par défaut, mesure PING et READ requêtes de différentes tailles. Chaque cas exécute 20 tentatives de préchauffage, puis 1,000 tentatives mesurées par moteur. L'ordre du moteur tourne entre les tours. Les tentatives infructueuses restent des échecs ; les tentatives ne les remplacent jamais.

Options utiles :

- `--list` : liste les cas sans ouvrir de port.
- `--cases ping,read-table-87` : exécute les cas sélectionnés.
- `--warmup 20`, `--repetitions 1000` : tentatives par boîtier et moteur.
- `--gap-ms 1` : pause entre les requêtes ; la valeur par défaut n'est pas de pause ajoutée.
- `--results DIR` : parent de sortie ; la valeur par défaut est `tools/diagnostics/results`.
- `--include-writes` : le test a également reconnu les écritures dans les registres RAM 51–54. Ces registres ne sont pas documentés sur d'autres firmwares ; utilisez cette option uniquement sur un servo compatible vérifié. Les valeurs d'origine sont restaurées en cas d'achèvement, d'échec ou d'interruption gracieuse. Les accusés de réception en écriture doivent être activés.

Chaque exécution crée un nouveau répertoire contenant `summary.csv`, `report.json` et `samples.jsonl`. Le résumé comprend la latence médiane, p95, p99 et maximale, ainsi que le nombre de délais d'attente et d'erreurs. Les enregistrements bruts incluent les échanges de préchauffage et de nettoyage.

La latence s'étend de l'appel d'écriture série à une réponse décodée correspondante. Il comprend les délais USB et operating-system ; il ne s'agit pas d'un temps de réponse firmware-only ou d'une mesure de la capacité maximale du bus. Les délais d'attente sont comptés séparément et ne sont pas inclus dans les percentiles de latence.

<a id="telemetry"></a>
## Télémétrie

```sh
npm run telemetry -- --port /dev/cu.usbmodemXXXX --ids 1,2 \
  --samples 1000 --interval-ms 20 --output tools/diagnostics/results/telemetry-check
```

Lit 17 octets à partir du registre 56, une fois par moteur et par tour. La valeur par défaut est 100,000 échantillons par moteur sans pause supplémentaire. Utilisez un nouveau répertoire de sortie pour chaque exécution ; les exemples de fichiers existants ne sont jamais écrasés.

- `--interval-ms 20` : intervalle minimum entre les débuts de tours. Les créneaux manqués sont ignorés et comptés dans `missedDeadlines` ; les tours retardés ne provoquent pas de rafales.
- `--gap-ms 1` : faites plutôt une pause après chaque demande du moteur. Ne peut pas être combiné avec `--interval-ms`.
- `--voltage-min 5.5 --voltage-max 8.4` : plage de tension attendue en volts ; la valeur par défaut est 8–16 V. Réglez cette valeur pour les moteurs et l'alimentation connectés.

Sorties : `samples.csv` contient toutes les tentatives, `anomalies.jsonl` contient les lectures signalées et les échanges bruts, et `report.json` contient les décomptes, les plages, les statistiques de synchronisation et les paramètres before/after. CSV la tension est en dixièmes de volt ; la position, la vitesse, le courant et l'effort conservent leurs unités de registre brutes.

Vérifie les changements de tension et de température, les lectures invraisemblables, l'état différent de zéro et l'effort lorsque le couple est coupé. La détection des pics de température nécessite trois réponses valides consécutives ; une réponse manquante ou invalide interrompt la séquence. Ces indicateurs identifient les lectures à inspecter, et non la preuve d'un défaut du micrologiciel ou du capteur. Des lectures stationnaires identiques sont normales et ne prouvent pas des données périmées.

<a id="common-options-and-tests"></a>
## Options et tests courants

Les deux outils acceptent `--baud 1000000`, `--timeout-ms 100` et `--help`. Les identifiants par défaut sont `1,2` ; préciser les moteurs réellement connectés. Le délai de réponse commence après l'épuisement de l'écriture série. Après un délai d'attente, les outils attendent un bus silencieux avant de continuer car les réponses ne contiennent aucun numéro de séquence.

Ctrl+C arrête l'exécution et effectue le nettoyage. Les erreurs, les analyses incomplètes et les échantillons signalés produisent un code de sortie différent de zéro. Les résultats sous `results/` sont ignorés par Git.

```sh
npm run test:diagnostics
```

Ces tests hors ligne ne se connectent pas au matériel.
<!-- /translated-content -->
