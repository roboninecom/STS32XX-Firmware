<!-- translation-navigation -->
[English](../../../en/firmware/tests/README.md) · [Русский](../../../ru/firmware/tests/README.md) · [Español](../../../es/firmware/tests/README.md) · [Français](README.md) · [Deutsch](../../../de/firmware/tests/README.md) · [Português (Brasil)](../../../pt-BR/firmware/tests/README.md) · [简体中文](../../../zh-CN/firmware/tests/README.md) · [日本語](../../../ja/firmware/tests/README.md) · [हिन्दी](../../../hi/firmware/tests/README.md) · [العربية](../../../ar/firmware/tests/README.md)

[Original anglais](../../../../../firmware/tests/README.md)

> Traduction automatique intégrale, pas encore relue par un locuteur natif. Les images et vidéos sont communes ; leur texte reste dans la langue d’origine.
<!-- /translation-navigation -->

<!-- translated-content -->
<a id="firmware-tests"></a>
# Tests du micrologiciel

Exécutez `make verify` à partir de la racine du référentiel après avoir installé la [chaîne d'outils du micrologiciel](../README.md#build-and-verify). Il construit le micrologiciel et exécute des tests C épurés, des vérifications de contrat register/storage, des vérifications des limites des modules et une vérification de la disposition des images. Il ne se connecte pas au matériel.

`fixtures/` contient les entrées de régression requises. Gardez-les avec les tests. `support/` fournit des interfaces matérielles et des dispositifs de stockage simulés.

Voir [project checks](../../tools/README.md#offline-checks) pour les tests d'hôte, de flashage et de visualisation, et la [suite de comparaison de matériel](../../tools/hw-diff-tests/README.md) pour factory/custom vérifications de comportement sur un banc dédié.
<!-- /translated-content -->
