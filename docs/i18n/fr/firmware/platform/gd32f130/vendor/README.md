<!-- translation-navigation -->
[English](../../../../../en/firmware/platform/gd32f130/vendor/README.md) · [Русский](../../../../../ru/firmware/platform/gd32f130/vendor/README.md) · [Español](../../../../../es/firmware/platform/gd32f130/vendor/README.md) · [Français](README.md) · [Deutsch](../../../../../de/firmware/platform/gd32f130/vendor/README.md) · [Português (Brasil)](../../../../../pt-BR/firmware/platform/gd32f130/vendor/README.md) · [简体中文](../../../../../zh-CN/firmware/platform/gd32f130/vendor/README.md) · [日本語](../../../../../ja/firmware/platform/gd32f130/vendor/README.md) · [हिन्दी](../../../../../hi/firmware/platform/gd32f130/vendor/README.md) · [العربية](../../../../../ar/firmware/platform/gd32f130/vendor/README.md)

[Original anglais](../../../../../../../firmware/platform/gd32f130/vendor/README.md)

> Traduction automatique intégrale, pas encore relue par un locuteur natif. Les images et vidéos sont communes ; leur texte reste dans la langue d’origine.
<!-- /translation-navigation -->

<!-- translated-content -->
<a id="pinned-gd32f1x0-declarations"></a>
# Déclarations GD32F1x0 épinglées

Source : communauté `sts3215-firmware/firmware/lib` lors de la révision du référentiel `24ba15ba80bfe8213684c6bb4523a7d7ee079998`. Les en-têtes GD32 device/SPL identifient GigaDevice V3.3.0 (2020-09-21). L'en-tête principal CMSIS identifie ARM V3.30. `SHA256SUMS` enregistre les octets exacts de chaque en-tête copié. Aucune implémentation du fournisseur C ni source de démarrage du système n'est incluse.

La fermeture de dépendance contient 18 en-têtes : 5 CMSIS et 13 SPL. L'en-tête de l'appareil comprend `gd32f1x0_libopt.h` ; cet agrégateur local fait référence à chaque en-tête périphérique. Tous les en-têtes vendor/CMSIS sélectionnés, à l'exception de l'agrégateur, contiennent leurs propres droits d'auteur en amont, conditions de redistribution et clause de non-responsabilité. L'agrégateur n'a pas de notification intégrée ; la licence MIT du référentiel source est incluse en tant que `COMMUNITY_LICENSE`. Les mentions en amont restent inchangées dans chaque fichier et doivent accompagner les distributions sources et binaires. Incluez ce répertoire ou reproduisez ces avis dans les documents de distribution lors de l'expédition d'un binaire.

Seules les versions cibles ajoutent ces chemins d'inclusion. `mcu.h` sélectionne `GD32F130_150`. Aucune application, noyau ou interface publique ne doit inclure cet en-tête de périphérique. Ne remplacez pas le démarrage de l'horloge du projet, la disposition vectorielle ou le contrat de liaison par le code d'implémentation du fournisseur dans le cadre d'une migration declaration-only.
<!-- /translated-content -->
