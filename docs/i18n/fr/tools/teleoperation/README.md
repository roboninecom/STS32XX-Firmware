<!-- translation-navigation -->
[English](../../../en/tools/teleoperation/README.md) · [Русский](../../../ru/tools/teleoperation/README.md) · [Español](../../../es/tools/teleoperation/README.md) · [Français](README.md) · [Deutsch](../../../de/tools/teleoperation/README.md) · [Português (Brasil)](../../../pt-BR/tools/teleoperation/README.md) · [简体中文](../../../zh-CN/tools/teleoperation/README.md) · [日本語](../../../ja/tools/teleoperation/README.md) · [हिन्दी](../../../hi/tools/teleoperation/README.md) · [العربية](../../../ar/tools/teleoperation/README.md)

[Original anglais](../../../../../tools/teleoperation/README.md)

> Traduction automatique intégrale, pas encore relue par un locuteur natif. Les images et vidéos sont communes ; leur texte reste dans la langue d’origine.
<!-- /translation-navigation -->

<!-- translated-content -->
<a id="teleoperation"></a>
# Téléopération

Déplacez un suiveur motorisé en déplaçant manuellement un leader non motorisé. Prend en charge les paires de joints 1–6 sur deux bus série distincts. Le leader peut utiliser le micrologiciel d'usine ; le suiveur nécessite le firmware v9 de ce référentiel.

<a id="run"></a>
## Courir

Installez Node.js 20 ou plus récent, puis exécutez `npm install` à partir de la racine du référentiel. Copiez [exemple.json](../../../../../tools/teleoperation/example.json) à côté de l'original sous le nom `controller.local.json`. Définissez les ports, le débit en bauds et les identifiants communs. L'exemple partage le [profil moteur](../../../../../host/arm-control/profile.example.json) avec relecture et réglage. Copiez-le pour vos propres paramètres et mettez à jour son chemin, ou intégrez vos profils. Les chemins sont relatifs au fichier du contrôleur. Des exemples de gains illustrent le format ; utilisez les paramètres testés sur votre mécanisme.

Prévisualisez le mappage sans modifier les paramètres du moteur :

```sh
npm run teleoperate -- CONFIG.json
```

Vérifiez les positions et les cibles signalées, soutenez les deux mécanismes et laissez la place au suiveur pour se rapprocher de la pose du leader. Démarrer le contrôle explicitement :

```sh
npm run teleoperate -- CONFIG.json --run
```

Chaque bus doit contenir exactement ses identifiants configurés. Les deux mécanismes nécessitent des limites de position enregistrées et non vides et un mode de position ordinaire avec une résolution unitaire. Les paramètres des suiveurs doivent être verrouillés sans aucune écriture différée en attente. Le couple leader doit déjà être désactivé ; cet outil n'écrit jamais au leader. Le démarrage suiveur gère automatiquement les moteurs alimentés et non alimentés.

Les exécutions se poursuivent jusqu'à Ctrl+C, sauf si vous définissez explicitement `durationMs`. **La sortie normale conserve une prise électrique.** Le démarrage, la gravité et le nettoyage des pannes suivent le [comportement du contrôleur partagé](../../host/arm-control/README.md#control-behaviour).

<a id="mapping-and-control"></a>
## Cartographie et contrôle

Chaque entrée `joints` contient `leaderId`, `followerId` et `mapping` :

| Paramètre | Signification |
| --- | --- |
| `mapping: "angle"` | Préserver le déplacement du codeur par rapport au centre des limites stockées. |
| `mapping: "range"` | Adaptez chaque moitié du voyage du leader à la moitié du suiveur correspondante. Utile pour les pinces. |
| `direction` | `1` (par défaut) ou `-1` pour inverser le mouvement. |
| `leaderMiddle`, `followerMiddle` | Centres optionnels pour la cartographie des plages, strictement à l'intérieur des limites respectives. |

Les cibles sont plafonnées aux limites enregistrées par le suiveur. `angle` fonctionne en nombre d'encodeurs, il suppose donc des échelles et des engrenages d'encodeur compatibles.

Le centre de cartographie est le point médian des limites enregistrées, qui peuvent différer de la référence d'étalonnage à 2048. La correspondance des poses d'étalonnage ne garantit donc pas à elle seule la correspondance des cibles lorsque les limites du leader et du suiveur sont asymétriques. Prévisualisez le mappage avant de vous déplacer. `leaderMiddle` et `followerMiddle` remplacent les centres uniquement pour le mappage `range`.

Fournissez un profil pour chaque suiveur et les paramètres acceleration/ramp partagés comme décrit dans [paramètres du moteur](../../host/arm-control/README.md#motor-settings-files). Ajoutez `gravityModel` pour activer la [compensation de gravité](../../host/arm-control/README.md#enable-gravity).

<a id="timing-and-checks"></a>
## Calendrier et contrôles

| Paramètre facultatif | Par défaut | Signification |
| --- | --- | --- |
| `hz` | 60 | Taux de mise à jour demandé, 1–60 Hz. Les périodes manquées sont sautées. |
| `maxAgeMs` | 100 | Âge maximum d'une trame leader avant envoi, 10–10000 ms. |
| `responseTimeoutMs` | 100 | Délai d'expiration de la file d'attente des réponses et des transactions, 25–10000 ms. |
| `durationMs` | Illimité | Durée d'exécution, démarrage du contrôle compris, 1–86400000 ms. |

Chaque image doit inclure chaque position de leader et rester entre `maxAgeMs` jusqu'à son envoi. Les périodes de mise à jour manquées sont ignorées. La rétroaction, la gravité et l'exploitation forestière partagent la boucle de contrôle ; la vitesse atteinte dépend des performances du bus et de l’ordinateur. Voir [contrôles et timing partagés](../../host/arm-control/README.md#checks-and-timing).

Les journaux sont enregistrés dans `logs/motion/` ignoré sous le nom newline-delimited JSON. Ils contiennent la configuration, la session choisie ID, l'aperçu, les commandes prévues, les trames envoyées, les commentaires et les enregistrements stop/error. Un enregistrement de commande à lui seul ne prouve pas qu’une cible a été envoyée ou acceptée. Les écritures sont attendues sans accumuler de file d'attente de journaux illimitée ; une journalisation lente peut déclencher la vérification frame-age.

Rejouez les journaux sans leader connecté à l'aide de la commande [recorded-session replay](../poses/README.md#replay-a-recorded-session).

Exécutez des tests hors ligne avec `npm run test:teleoperation`.
<!-- /translated-content -->
