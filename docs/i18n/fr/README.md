<!-- translation-navigation -->
[English](../en/README.md) · [Русский](../ru/README.md) · [Español](../es/README.md) · [Français](README.md) · [Deutsch](../de/README.md) · [Português (Brasil)](../pt-BR/README.md) · [简体中文](../zh-CN/README.md) · [日本語](../ja/README.md) · [हिन्दी](../hi/README.md) · [العربية](../ar/README.md)

[Original anglais](../../../README.md)

> Traduction automatique intégrale, pas encore relue par un locuteur natif. Les images et vidéos sont communes ; leur texte reste dans la langue d’origine.
<!-- /translation-navigation -->

<!-- translated-content -->
<a id="sts32xx-firmware"></a>
# STS32XX Micrologiciel

Firmware pour les servos GD32F130-based STS3215. Les commandes standard STS sont disponibles en mode hérité ; Le mode d'extension ajoute un mouvement fluide planifié localement, un contrôle de position configurable, une anticipation de vitesse et une compensation de gravité host-calculated.

Commencez par le **[Guide de démarrage rapide](QUICKSTART.md)** ou lisez la [documentation détaillée](DETAILED_DOCUMENTATION.md) pour les détails de configuration et de protocole.

[![Aperçu : tests SO-101 et SO-102 before-and-after enregistrés](../../../assets/readme/posters/overview.jpg)](https://youtu.be/AsxFs24vXQs)

[Regarder sur YouTube](https://youtu.be/AsxFs24vXQs) | [MP4](../../../assets/readme/videos/overview.mp4)

Les valeurs approximatives décrivent les démonstrations enregistrées, sans garantie de précision dans l'espace de travail.

Sélectionnez une image vidéo ou le lien YouTube en dessous pour regarder le clip silencieux. Toutes les vidéos de documentation sont disponibles par lien (Non répertorié) ; MP4 exemplaires sont également fournis.

- [Pourquoi nous l'avons construit](#why-we-built-it)
- [Quels changements dans le contrôle](#what-changes-in-control)
- [Résultats sur SO-101 / SO-102](#results-on-so-101--so-102)
- [Robots et liens](#robots-and-links)
- [Démarrage rapide](#quick-start)
- [Documentation détaillée](#detailed-documentation)

<a id="why-we-built-it"></a>
## Pourquoi nous l'avons construit

Un bras robotique peut revenir systématiquement au même point tout en manquant la cible commandée. **Répétabilité** décrit cette cohérence ; **précision de positionnement absolue** décrit la distance entre le bras et la cible.

**Rendements répétés mesurés avec un indicateur**

[![Rendements répétés mesurés avec un indicateur](../../../assets/readme/posters/repeatability.jpg)](https://youtu.be/_VN10zWybBU)

[Regarder sur YouTube](https://youtu.be/_VN10zWybBU) | [MP4](../../../assets/readme/videos/repeatability.mp4)

**Répétabilité versus précision de positionnement absolue**

[![Explication conceptuelle de la répétabilité et de la précision absolue du positionnement](../../../assets/readme/posters/repeatability-vs-accuracy.jpg)](https://youtu.be/L5FINW5FATI)

[Regarder sur YouTube](https://youtu.be/L5FINW5FATI) | [MP4](../../../assets/readme/videos/repeatability-vs-accuracy.mp4)

Nous avons essayé de réduire les erreurs de positionnement en réglant PID sur le firmware d'origine. Dans certains scénarios de test, les paramètres réduisant l’erreur provoquaient également des oscillations. Nous avons développé un micrologiciel personnalisé pour nous donner plus de contrôle sur la planification des mouvements et le contrôle de position.

[![Micrologiciel d'origine : oscillation pendant le réglage PID](../../../assets/readme/posters/stock-pid-oscillation.jpg)](https://youtu.be/wIBd3jnOwRk)

[Regarder sur YouTube](https://youtu.be/wIBd3jnOwRk) | [MP4](../../../assets/readme/videos/stock-pid-oscillation.mp4)

<a id="what-changes-in-control"></a>
## Quels changements dans le contrôle

L'hôte envoie des cibles et des paramètres ; chaque servo planifie et contrôle son propre mouvement.

1. L'hôte envoie des cibles et des paramètres et calcule la compensation de gravité une fois configuré.
2. Chaque servo planifie son propre mouvement S-curve.
3. Le PID local et la commande anticipée ajustent la sortie du moteur en utilisant la position mesurée et la vitesse estimée.

[Regardez l'aperçu enregistré sur YouTube](https://youtu.be/AsxFs24vXQs) | [MP4](../../../assets/readme/videos/overview.mp4)

<a id="s-curve-motion"></a>
### S-curve mouvement

Rend l'accélération et le freinage plus progressifs. La courbe illustre l'accélération dans le temps.

[![Illustration conceptuelle du mouvement s-curve](../../../assets/readme/illustrations/s-curve.png)](https://youtu.be/92mDt4rbobY)

[Regarder sur YouTube](https://youtu.be/92mDt4rbobY) | [MP4](../../../assets/readme/videos/s-curve.mp4)

[Configuration et limitations](DETAILED_DOCUMENTATION.md#s-curve-motion).

<a id="pid-control"></a>
### Contrôle PID

Ajuste la façon dont le servo corrige l’erreur de position. La courbe grise illustre l'oscillation ; la courbe blanche illustre une réponse plus amortie. La ligne pointillée est la cible.

[![Illustration conceptuelle du contrôle pid](../../../assets/readme/illustrations/pid-tuning.png)](https://youtu.be/TEpvaAMlfrg)

[Regarder sur YouTube](https://youtu.be/TEpvaAMlfrg) | [MP4](../../../assets/readme/videos/pid-tuning.mp4)

[Configuration et limitations](DETAILED_DOCUMENTATION.md#pid-controller).

<a id="velocity-feedforward"></a>
### Anticipation de vitesse

Ajoute la puissance du moteur en fonction de la vitesse prévue, calculée à l'intérieur du servo. Les deux courbes progressent de gauche à droite au fil du temps.

[![Illustration conceptuelle du feedback de vitesse](../../../assets/readme/illustrations/velocity-feedforward.png)](https://youtu.be/osGGs-nhk9I)

[Regarder sur YouTube](https://youtu.be/osGGs-nhk9I) | [MP4](../../../assets/readme/videos/velocity-feedforward.mp4)

[Configuration et limitations](DETAILED_DOCUMENTATION.md#velocity-feedforward).

<a id="gravity-compensation"></a>
### Compensation de gravité

L'hôte calcule la contribution et le servo l'applique. La flèche vers le bas représente le poids ; la flèche vers le haut représente le support.

[![Illustration conceptuelle de la compensation gravitationnelle](../../../assets/readme/illustrations/gravity-compensation.png)](https://youtu.be/25sc41PTDIA)

[Regarder sur YouTube](https://youtu.be/25sc41PTDIA) | [MP4](../../../assets/readme/videos/gravity-compensation.mp4)

[Configuration et limitations](DETAILED_DOCUMENTATION.md#gravity-compensation).

Ces graphiques et animations explicatifs sont des tracés matériels conceptuels et non mesurés. Consultez la [documentation détaillée](DETAILED_DOCUMENTATION.md) pour les paramètres, les détails du protocole et les limitations. Les clients d'extension doivent prendre en charge le **protocole v9.0** ; les paramètres d’extension sont temporaires et doivent être renvoyés après une réinitialisation ou un cycle d’alimentation.

<a id="results-on-so-101--so-102"></a>
## Résultats sur SO-101 / SO-102

Les clips ci-dessous montrent des tests before-and-after enregistrés sur SO-101 et SO-102. Chaque comparaison montre d'abord le comportement d'origine, suivi de la configuration custom-firmware.

**SO-101 : avant, puis après**

[![SO-101 enregistré before-and-after comparaison](../../../assets/readme/posters/so101-before-after.jpg)](https://youtu.be/ZdLlv8q73gE)

[Regarder sur YouTube](https://youtu.be/ZdLlv8q73gE) | [MP4](../../../assets/readme/videos/so101-before-after.mp4)

**SO-102 : avant, puis après**

[![SO-102 enregistré before-and-after comparaison](../../../assets/readme/posters/so102-before-after.jpg)](https://youtu.be/0rmO15pFqJ4)

[Regarder sur YouTube](https://youtu.be/0rmO15pFqJ4) | [MP4](../../../assets/readme/videos/so102-before-after.mp4)

Les valeurs approximatives indiquées décrivent ces démonstrations, mais ne garantissent pas une précision dans l'espace de travail du bras. La répétabilité, la précision absolue du positionnement et la déflexion mécanique sont des mesures différentes.

<a id="complete-coordinated-movement"></a>
### Mouvement coordonné complet

[![Mouvement SO-101 enregistré complet](../../../assets/readme/posters/coordinated-motion.jpg)](https://youtu.be/dCtcS5aAko0)

[Regarder sur YouTube](https://youtu.be/dCtcS5aAko0) | [MP4](../../../assets/readme/videos/coordinated-motion.mp4)

Ce clip préserve l’intégralité du mouvement enregistré. Chaque servo planifie localement ; envoyer des cibles ensemble ne garantit pas en soi une arrivée simultanée.

<a id="mechanical-limitations"></a>
### Limites mécaniques

[![Jeu de boîte de vitesses et flexion du cadre](../../../assets/readme/posters/mechanical-limits.jpg)](https://youtu.be/53l7at5aE6k)

[Regarder sur YouTube](https://youtu.be/53l7at5aE6k) | [MP4](../../../assets/readme/videos/mechanical-limits.mp4)

Le jeu de la boîte de vitesses et la flexion du cadre affectent toujours la position finale du bras. Le réglage du contrôleur ne supprime pas ces limitations mécaniques. Valider les paramètres sur le mécanisme et la charge réels ; voir [limites actuelles](DETAILED_DOCUMENTATION.md#current-limits).

<a id="robots-and-links"></a>
## Robots et liens

Intéressé à construire une configuration similaire ? Découvrez les kits SO-ARM101 et SO-ARM102 de Robonine. Le contenu du kit est documenté sur les pages produits.

| SO-ARM101 | SO-ARM102 |
| --- | --- |
| ![SO-ARM101 kit robot](../../../assets/readme/illustrations/hardware-so101.jpg) | ![SO-ARM102 kit robot](../../../assets/readme/illustrations/hardware-so102.jpg) |
| [Achetez le kit SO-ARM101 chez Robonine](https://robonine.com/ru/shop/so-arm101-black-white-robotic-arm-kit/) | [Achetez le kit SO-ARM102 chez Robonine](https://robonine.com/ru/shop/so-arm102-robotic-arm-kit/) |

[Explorez le matériel SO-ARM102, CAD et BOM](https://github.com/roboninecom/SO-ARM102).

<a id="quick-start"></a>
## Démarrage rapide

Suivez le **[Guide de démarrage rapide existant](QUICKSTART.md)** pour les prérequis, les commandes, les vérifications et les précautions de flashage. Sa séquence de configuration est la suivante :

1. Installez les outils requis et sélectionnez le port servo.
2. Sauvegardez les paramètres du moteur et flashez le micrologiciel personnalisé publié.
3. Calibrez les décalages des articulations et les limites de déplacement selon les besoins de la configuration.
4. Vérifiez la communication avec le couple coupé.
5. Enregistrez les poses, prévisualisez la rediffusion et effectuez le premier test de mouvement.
6. Activez la compensation de la gravité avec un modèle correspondant au bras et à son calibrage.
7. Réglez et visualisez le mouvement.

**Le flashage peut endommager le servo ou effacer l'étalonnage.** Suivez les précautions de puissance, de couple et de récupération du guide avant de continuer.

Pour un nouvel étalonnage SO-101 ou SO-102, utilisez les images reference-pose existantes et suivez le [guide d'étalonnage](tools/settings/README.md#reference-pose-images). Conservez un étalonnage vérifié existant lors de la réutilisation de ses enregistrements et de son modèle de gravité.

**SO-101 pose de référence**

[![SO-101 pose de référence avec six articulations étiquetées](../../../tools/settings/images/so101-reference-pose.png)](../../../tools/settings/images/so101-reference-pose.png)

**SO-102 pose de référence**

[![SO-102 pose de référence avec six articulations étiquetées](../../../tools/settings/images/so102-reference-pose.png)](../../../tools/settings/images/so102-reference-pose.png)

<a id="detailed-documentation"></a>
## Documentation détaillée

La **[documentation détaillée](DETAILED_DOCUMENTATION.md)** couvre la configuration, les protocoles, les registres, la construction et la vérification. Des diagrammes techniques et des démonstrations vidéo pertinentes apparaissent à côté des sections correspondantes.

- [Mode hérité](DETAILED_DOCUMENTATION.md#legacy-mode)
- [Comment fonctionne le mode extension](DETAILED_DOCUMENTATION.md#how-extension-mode-works)
- [S-curve mouvement](DETAILED_DOCUMENTATION.md#s-curve-motion)
- [Pose de référence d'étalonnage](DETAILED_DOCUMENTATION.md#calibration-reference-poses)
- [PID contrôleur](DETAILED_DOCUMENTATION.md#pid-controller)
- [Réaction de vitesse](DETAILED_DOCUMENTATION.md#velocity-feedforward)
- [Compensation de gravité](DETAILED_DOCUMENTATION.md#gravity-compensation)
- [Démarrage et arrêt du mode d'extension](DETAILED_DOCUMENTATION.md#starting-and-stopping-extension-mode)
- [Protocole d'extension](DETAILED_DOCUMENTATION.md#extension-protocol)
- [Registres d'extension](DETAILED_DOCUMENTATION.md#extension-registers)
- [Construction et vérification](DETAILED_DOCUMENTATION.md#build-and-verification)
- [Disposition du référentiel](DETAILED_DOCUMENTATION.md#repository-layout)
- [Limites actuelles](DETAILED_DOCUMENTATION.md#current-limits)


Voir [tools](tools/README.md) pour les guides de commandes individuels et [firmware](firmware/README.md) pour la chaîne d'outils de construction.
<!-- /translated-content -->
