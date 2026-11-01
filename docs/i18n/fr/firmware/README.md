<!-- translation-navigation -->
[English](../../en/firmware/README.md) · [Русский](../../ru/firmware/README.md) · [Español](../../es/firmware/README.md) · [Français](README.md) · [Deutsch](../../de/firmware/README.md) · [Português (Brasil)](../../pt-BR/firmware/README.md) · [简体中文](../../zh-CN/firmware/README.md) · [日本語](../../ja/firmware/README.md) · [हिन्दी](../../hi/firmware/README.md) · [العربية](../../ar/firmware/README.md)

[Original anglais](../../../../firmware/README.md)

> Traduction automatique intégrale, pas encore relue par un locuteur natif. Les images et vidéos sont communes ; leur texte reste dans la langue d’origine.
<!-- /translation-navigation -->

<!-- translated-content -->
<a id="firmware-sources"></a>
# Sources du micrologiciel

GD32F130 firmware, y compris le code de contrôle portable, les pilotes matériels et les tests. Le protocole d'extension est documenté dans la [documentation détaillée](../DETAILED_DOCUMENTATION.md#extension-protocol).

| Annuaire | Contenu |
| --- | --- |
| `app/` | Boucle principale et coordination entre les composants |
| `core/` | Contrôle, détection, protocole, registres et stockage |
| `include/` | Déclarations C partagées et types de données |
| `platform/gd32f130/` | Pilotes matériels, code de démarrage, script de liaison et en-têtes du fournisseur |
| [`tests/`](tests/README.md) | Tests de régression C, vérifications Python et accessoires requis |

<a id="build-and-verify"></a>
## Construire et vérifier

Depuis la racine du référentiel :

```sh
make
make verify
```

Installez `arm-none-eabi-gcc`, un compilateur hôte C avec address/undefined-behavior désinfectants, Python 3 et Make. Pour une chaîne d'outils en dehors de PATH :

```sh
make verify ARM_PREFIX=/path/to/toolchain/bin/arm-none-eabi-
```

Le Makefile racine délègue à ce répertoire. `make -C firmware` et `make -C firmware verify` fonctionnent également. Les deux écrivent des images de micrologiciel dans `build/motor-release/` et des exécutables de test natifs dans `build/host/` à la racine du référentiel. `make clean` supprime le répertoire généré `build/`.

Ces commandes ne flashent pas le matériel. Utilisez l'[outil flash](../tools/flash/README.md) avec une version publisher-supplied. Les bibliothèques hôtes et les outils command-line restent sous [`host/`](../host/servo-driver/README.md) et [`tools/`](../tools/README.md).
<!-- /translated-content -->
