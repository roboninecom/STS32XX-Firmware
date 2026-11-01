<!-- translation-navigation -->
[English](../../../en/tools/poses/README.md) · [Русский](../../../ru/tools/poses/README.md) · [Español](../../../es/tools/poses/README.md) · [Français](README.md) · [Deutsch](../../../de/tools/poses/README.md) · [Português (Brasil)](../../../pt-BR/tools/poses/README.md) · [简体中文](../../../zh-CN/tools/poses/README.md) · [日本語](../../../ja/tools/poses/README.md) · [हिन्दी](../../../hi/tools/poses/README.md) · [العربية](../../../ar/tools/poses/README.md)

[Original anglais](../../../../../tools/poses/README.md)

> Traduction automatique intégrale, pas encore relue par un locuteur natif. Les images et vidéos sont communes ; leur texte reste dans la langue d’origine.
<!-- /translation-navigation -->

<!-- translated-content -->
<a id="record-and-replay-poses"></a>
# Enregistrez et rejouez les poses

Enregistrez les positions nommées sans couple, puis rejouez-les avec les paramètres hérités enregistrés ou les paramètres d'extension réglés. Les commandes s'exécutent à partir de la racine du référentiel.

| Commande | Entrée | Micrologiciel |
| --- | --- | --- |
| `npm run record-poses` | Positionnement manuel | Usine ou personnalisé |
| `npm run replay` | Poses nommées ou séance de téléopération | Rallonge v9 |
| `npm run replay-legacy` | Poses nommées | Usine ou v9 personnalisé |

<a id="record-poses"></a>
## Enregistrer des poses

Installez Node.js 20 ou plus récent, puis exécutez à partir de la racine du référentiel :

```sh
npm install
npm run record-poses -- --port /dev/ttyUSB0 --ids 1,2,3
```

Remplacez le port et les identifiants pour votre configuration. Les indicateurs facultatifs sont `--baud` (par défaut 1000000), `--output DIR` et `--timeout-ms` (par défaut 1000).

Terminez d'abord [l'étalonnage du décalage et de la limite](../settings/README.md#calibrate-joint-offsets-and-limits). Les poses enregistrées sont des points de cheminement de mouvement ; capturer une pose nommée `home` ou `reference` ne modifie pas l'étalonnage du moteur.

1. Soutenez le mécanisme afin qu'il ne puisse pas tomber lorsque le couple est relâché.
2. Appuyez sur Entrée à l'invite de confirmation. L'enregistreur désactive le couple sur les moteurs sélectionnés et vérifie qu'il est éteint. Les autres moteurs ne sont pas modifiés.
3. Déplacez le mécanisme, maintenez-le immobile, puis appuyez sur Entrée pour capturer une pose. Vous pouvez plutôt saisir un nom unique ; les poses sans nom deviennent `position-1`, `position-2`, etc.
4. Répétez au besoin. Tapez `done` pour terminer ou appuyez sur Ctrl+C pour interrompre.

Le couple reste désactivé après l'enregistrement. Les lectures sont séquentielles, de sorte que chaque pose est un instantané d'un mécanisme stationnaire, et non une mesure de mouvement synchronisée. Une lecture manquante, une alarme ou un moteur activé arrête la session. À la sortie, l'outil tente à nouveau de désactiver le couple et signale tout échec de vérification.

<a id="saved-files"></a>
## Fichiers enregistrés

Un nouveau fichier JSON est créé en `tools/poses/recordings/` pour chaque session. Chaque capture réussie remplace ce fichier de manière atomique ; les poses enregistrées antérieurement restent disponibles si une capture ultérieure échoue. Les enregistrements sont ignorés par Git.

Le format `sts-poses` de la version 1 identifie les positions par le moteur ID, et non par l'ordre du tableau :

```json
{
  "format": "sts-poses",
  "version": 1,
  "units": "encoder-counts",
  "ids": [1, 3],
  "readMode": "sequential",
  "poses": [
    {
      "name": "home",
      "capturedAt": "2026-10-24T12:00:00.000Z",
      "durationMs": 4.2,
      "positions": {"1": 2048, "3": 3100}
    }
  ]
}
```

Les fichiers incluent également la durée de la session, le port série et le débit en bauds. Pose une marque d'horodatage lorsque la lecture commence ; `durationMs` mesure l'acquisition complète. Les décomptes sont des positions signalées signées, incluant déjà le décalage et le réglage de la direction du moteur, sans conversion en angles. Le fichier n'a aucun paramètre de vitesse, d'accélération ou de synchronisation de lecture, ni aucun instantané d'étalonnage. Re-record pose après avoir modifié l'étalonnage de l'encodeur ; la relecture ne peut pas détecter qu'un ancien fichier de pose utilise des décalages différents.

<a id="replay-poses"></a>
## Rejouer les poses

Copiez [replay.example.json](../../../../../tools/poses/replay.example.json) à côté de l'original, par exemple sous la forme `tools/poses/controller.local.json`. Réglez `followerPort` et fournissez une entrée `profiles` par moteur enregistré. Les identifiants proviennent de l’enregistrement ; aucun leader ou cartographie commune n’est nécessaire. L'exemple fait référence au [profil moteur](../../../../../host/arm-control/profile.example.json) partagé. Copiez ce profil pour vos propres paramètres et mettez à jour son chemin, ou insérez les paramètres en ligne. Tous les chemins de profil et de gravité sont relatifs au fichier du contrôleur. Des exemples de gains illustrent le format ; utilisez les paramètres testés sur votre mécanisme.

```sh
npm run replay -- CONFIG.json POSES.json
npm run replay -- CONFIG.json POSES.json --run
```

La première commande affiche un aperçu du chemin complet sans modifier les paramètres et signale les cibles limitées aux limites enregistrées. `--run` démarre le mouvement, y compris l'approche de la position actuelle à la première pose. Seul le port suiveur est ouvert. Les fichiers jusqu'à 64 MiB sont acceptés et validés avant l'ouverture d'un port.

Le [contrôleur partagé](../../host/arm-control/README.md) applique des profils, gère les sessions alimentées existantes et fournit une compensation de gravité lorsque `gravityModel` est configuré. **L'achèvement normal et Ctrl+C conservent un maintien alimenté.** Les défauts utilisent le nettoyage du contrôleur ; Ctrl+C n'est pas un arrêt d'urgence. Facultatif top-level `durationMs` termine la lecture plus tôt ; omettez-le pour relire tout le fichier.

Chaque pose est envoyée dans une seule commande de groupe. Échelle de vitesse commune avec la distance parcourue, sous réserve de la vitesse de relecture et de la limite de vitesse de chaque moteur. Chaque moteur génère son propre S-curve, l'arrivée est donc approximative et les waypoints ne sont pas mélangés. La lecture attend que les planificateurs terminent et que toutes les positions mesurées entrent `toleranceCounts`, puis démarre la mise en attente. Un mouvement dépassant `moveTimeoutMs` échoue. Les horodatages enregistrés manuellement ne définissent pas la vitesse de lecture.

| Réglage `replay` | Par défaut | Signification |
| --- | --- | --- |
| `speed` | 1000 | Vitesse maximale, 1–65535 encodeur counts/s. |
| `holdMs` | 1000 | Pause après l'arrivée, 0–600000 ms. |
| `repeat` | 1 | Nombre de passes, 1–1000 ; chaque passage revient à la première pose. |
| `moveTimeoutMs` | 30000 | Délai d'arrivée écoulé, 1–600000 ms. |
| `toleranceCounts` | 10 | Erreur de position mesurée autorisée, 0–32767 compte. |

<a id="replay-a-recorded-session"></a>
## Rejouer une session enregistrée

Rejouer un journal de téléopération sans connecter le leader :

```sh
npm run replay -- CONFIG.json SESSION.ndjson
npm run replay -- CONFIG.json SESSION.ndjson --run
```

L'enregistrement doit contenir un `preflight` avec les limites des leaders et une cartographie conjointe, suivi d'événements `command` avec des horodatages monotones et toutes les positions des leaders. Utilisez le même mappage commun dans la configuration actuelle. Les positions de leader enregistrées sont cartographiées à travers les limites de leader enregistrées et les limites actuelles du suiveur. Les profils de courant et la gravité sont appliqués ; les paramètres et les efforts historiques ne sont pas réutilisés. Une commande prévue dans un journal ayant échoué peut ne jamais avoir atteint les moteurs.

La lecture préserve les espaces enregistrés ; les retards de traitement étendent le timing au lieu d'envoyer des rafales catch-up. Les mises à jour des commentaires et de la gravité se poursuivent pendant les pauses. `replay.repeat`, `moveTimeoutMs` et `toleranceCounts` s'appliquent ; `speed` et `holdMs` s'appliquent uniquement aux poses nommées. La dernière image doit arriver avant la fin.

<a id="legacy-replay"></a>
## Rediffusion de l'héritage

Utilisez les paramètres PID enregistrés des moteurs sans anticipation de vitesse d'extension ni compensation de gravité. Aucun fichier de contrôleur n'est nécessaire et les paramètres persistants restent inchangés. Les moteurs ont besoin d'un mode de position absolue et d'une résolution d'encodeur unitaire.

```sh
npm run replay-legacy -- POSES.json --port /dev/ttyUSB0
npm run replay-legacy -- POSES.json --port /dev/ttyUSB0 --run
```

La première commande affiche un aperçu ; `--run` coups. Les identifiants proviennent du fichier de pose ; les autres moteurs de l'adaptateur sont laissés seuls. Le micrologiciel personnalisé passe en mode hérité. La configuration désactive brièvement et re-enables chaque moteur sélectionné, en commençant par sa position actuelle.

| Options | Par défaut | Signification |
| --- | --- | --- |
| `--speed` | 1000 | Vitesse maximale, 1–32767 encodeur counts/s. |
| `--acceleration` | 5000 | Counts/s², 100–25400 en multiples de 100. Les limites enregistrées s'appliquent. |
| `--hold-ms` | 1000 | Maintenez après chaque mouvement planifié, 0–600000 ms. |
| `--baud` | 1000000 | Débit en bauds de l'adaptateur. |

Chaque pose utilise une commande de groupe et des vitesses distance-scaled pour une arrivée approximativement simultanée. Les cibles sont plafonnées aux limites de position enregistrées. La lecture attend la fin des profils de mouvement internes, puis s'arrête ; il ne nécessite pas d'erreur de position mesurée nulle. Un mouvement d'une durée supérieure à 30 secondes échoue.

L'achèvement conserve le couple à la pose finale. Contrairement à la relecture d'extension, **Ctrl+C tente torque-off**, tout comme les échecs. Des échecs de nettoyage sont signalés.

<a id="logs-and-visualization"></a>
## Journaux et visualisation

Les deux commandes de relecture enregistrent les journaux dans un `logs/motion/` ignoré, y compris l'étalonnage, l'identité de la source, les commandes et les commentaires. Démarrez la [visionneuse de télémétrie](../simulation/README.md) une fois, puis exécutez les replays dans un autre terminal :

```sh
mkdir -p logs/motion
tools/simulation/.venv/bin/python tools/simulation/viewer.py live logs/motion --model so102
```

Utilisez `--model so101` pour l'autre modèle fourni et un mappage d'encodeur correspondant. La relecture d'extension lit les commentaires détaillés sur la référence mobile affichée par le spectateur. Pour réduire le trafic, ajoutez `--compact` ; le mouvement mesuré et la compensation restent actifs, mais l'ombre affiche les destinations au lieu des positions intermédiaires du planificateur. PID les modalités et les cotisations compensatoires appliquées sont également omises. Voir [commentaires et timing](../../host/arm-control/README.md#checks-and-timing).

Exécutez des tests d'enregistrement hors ligne, de relecture d'extension et de relecture héritée avec `npm run test:poses`.
<!-- /translated-content -->
