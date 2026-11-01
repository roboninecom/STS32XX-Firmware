<!-- translation-navigation -->
[English](../../en/tools/README.md) · [Русский](../../ru/tools/README.md) · [Español](../../es/tools/README.md) · [Français](README.md) · [Deutsch](../../de/tools/README.md) · [Português (Brasil)](../../pt-BR/tools/README.md) · [简体中文](../../zh-CN/tools/README.md) · [日本語](../../ja/tools/README.md) · [हिन्दी](../../hi/tools/README.md) · [العربية](../../ar/tools/README.md)

[Original anglais](../../../../tools/README.md)

> Traduction automatique intégrale, pas encore relue par un locuteur natif. Les images et vidéos sont communes ; leur texte reste dans la langue d’origine.
<!-- /translation-navigation -->

<!-- translated-content -->
<a id="tools"></a>
# Outils

Utilitaires pour travailler avec les servos STS. Chaque guide comprend des instructions de configuration, des commandes et la configuration matérielle requise. Pour le développement d'applications, utilisez le [servo driver Node.js](../host/servo-driver/README.md), disponible sous forme de package npm autonome construit à partir de ce référentiel. La relecture et la téléopération partagent le [contrôleur de bras et le modèle de gravité](../host/arm-control/README.md).

Pour un nouveau mécanisme : [calibrer les décalages et les limites](settings/README.md#choose-the-reference-pose), enregistrer les poses, puis régler et valider la compensation. Conservez l’étalonnage vérifié lorsque vous réutilisez des poses et des modèles de gravité existants.

| Outil | Objectif |
| --- | --- |
| [Réglage automatisé](tuning/README.md) | Comparez des lots limités de paramètres avec des mouvements répétés et des validations plus longues. |
| [Visionneuse de télémétrie](simulation/README.md) | Visualisez la télémétrie en direct et lisez des enregistrements avec les modèles SO-101 et SO-102 groupés ; pas d'accès aux bus. |
| [Téléopération](teleoperation/README.md) | Contrôlez un suiveur d'un leader hand-operated. |
| [Enregistrement et relecture](poses/README.md) | Enregistrez les poses nommées ; rejouez avec les paramètres hérités ou d'extension, ou lisez une session de téléopération enregistrée. |
| [Découverte, calibrage et réglages](settings/README.md) | Recherchez des moteurs, calibrez les décalages et les limites des articulations, et sauvegardez ou restaurez les paramètres persistants. |
| [Tests de comparaison de matériel](hw-diff-tests/README.md) | Comparez le comportement du micrologiciel d'usine et personnalisé sur un banc d'asservissement dédié. |
| [Benchmark bus et télémétrie](diagnostics/README.md) | Mesurez la latence de communication et vérifiez les lectures stationnaires pour déceler des valeurs inhabituelles. |
| [Flashage et récupération du micrologiciel](flash/README.md) | Flashez le firmware d'usine personnalisé ou fourni, récupérez les téléchargements interrompus et réparez les paramètres d'usine. |

Les outils Node.js nécessitent Node.js 20 ou plus récent. Le flashage et la récupération des paramètres nécessitent Python 3.10 ou une version plus récente. La simulation utilise Python 3.12. Exécutez les commandes depuis la racine du référentiel et suivez le guide correspondant avant de connecter le matériel : les tests de comparaison peuvent déplacer les moteurs et écraser les paramètres, et le flashage peut endommager un servo.

<a id="offline-checks"></a>
## Chèques hors ligne

Exécuté à partir de la racine du référentiel. Installez d'abord les dépendances de nœud et les exigences de chaque outil Python. Aucune de ces commandes n'ouvre un port série ou ne déplace le matériel.

| Commande | Couverture |
| --- | --- |
| `make verify` | Construction du firmware, tests de régression C, contrats register/storage et mise en page des images. Voir [configuration de la chaîne d'outils](../firmware/README.md). |
| `npm test` | Pilote, contrôleur partagé et tous les outils Node.js. |
| `npm run test:driver-package` | Package de pilotes et installation isolée à l'aide de dépendances npm mises en cache. |
| `make flash-verify PYTHON=tools/flash/.venv/bin/python` | Clignotement et récupération des paramètres d'usine avec des périphériques série simulés. |
| `PYTHONPATH=tools/simulation tools/simulation/.venv/bin/python -m unittest discover -s tools/simulation/test` | Modèles, enregistrement des lecteurs et comportement des spectateurs. |

La comparaison du matériel utilise la [suite de banc dédiée](hw-diff-tests/README.md) ; il peut remplacer les paramètres et réinitialiser les modèles. Utiliser [diagnostics](diagnostics/README.md) pour la communication et la télémétrie stationnaire sur un mécanisme assemblé.
<!-- /translated-content -->
