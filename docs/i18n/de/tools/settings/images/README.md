<!-- translation-navigation -->
[English](../../../../en/tools/settings/images/README.md) · [Русский](../../../../ru/tools/settings/images/README.md) · [Español](../../../../es/tools/settings/images/README.md) · [Français](../../../../fr/tools/settings/images/README.md) · [Deutsch](README.md) · [Português (Brasil)](../../../../pt-BR/tools/settings/images/README.md) · [简体中文](../../../../zh-CN/tools/settings/images/README.md) · [日本語](../../../../ja/tools/settings/images/README.md) · [हिन्दी](../../../../hi/tools/settings/images/README.md) · [العربية](../../../../ar/tools/settings/images/README.md)

[Englisches Original](../../../../../../tools/settings/images/README.md)

> Vollständige maschinelle Übersetzung, noch nicht von Muttersprachlern geprüft. Bilder und Videos werden gemeinsam verwendet; enthaltene Texte bleiben in der Originalsprache.
<!-- /translation-navigation -->

<!-- translated-content -->
<a id="calibration-illustrations"></a>
# Abbildung zur Kalibrierung

Seiten- und Kopfansichten aus den gebündelten Robotermodellen, mit hinzugefügten Gelenketiketten und Platzierungsanweisungen. Dies sind Anleitungen für eine **neue manuelle Kalibrierung**, nicht Fotos oder Messungen der abgestimmten Arme.

- `so101-reference-pose.png`: Die Geometrie des Roboterstudios SO-101, verteilt unter Apache-2.0. [Pinnierte Quelle und Lizenz](../../simulation/urdf/so101/README.md).
- `so102-reference-pose.png`: Robonine's SO-ARM-102 Geometrie, CC BY 4.0. [Pinnierte Quelle und Lizenz](../../simulation/urdf/README.md). Diese Abbildung ist eine Anpassung an die Pose, Kamera, Hintergrund und Etiketten für diese Anleitung eingestellt; es ist auch unter CC BY 4.0 erhältlich.

<a id="poses-used-in-the-images"></a>
## In den Bildern verwendete Posen

M1–M4 verwenden die gebündelten Viewer-Mappings bei Zählung 2048. Wrist-Roll- und Greiferpositionen werden separat auf die Midpoints der Reiselimits des Modells gesetzt. Die physikalischen Stopps am eigentlichen Mechanismus bestimmen diese Midpoints während der manuellen Platzierung.

| Modell | M1–M4 Gelenkwinkel | Rollen für Handgelenke | Greifer |
| --- | --- | --- | --- |
| SO-101 | 0°, 0°, 0°, 0° | 2.789° | Bewegter Kiefer 45° |
| SO-102 | 0°, −3°, 1°, 1° | −1° | Schiebekieferpositionen +0.02075 m und −0.02075 m |

Die Winkel sind relativ zu jedem URDF-Gelenkrahmen, nicht zu den Winkeln, die an der Tabelle gemessen werden. Diese wrist/gripper-Positionen unterscheiden sich von den Standard-Viewer-Maps; weder die Karten noch die veröffentlichten Gravitationsmodelle wurden für diese Bilder geändert. Um eine neue Kalibrierung zu erhalten, aktualisieren Sie die Referenzwinkel des Viewers und die Kalibrierungsbindung, wie im [Viewer-Guide](../../simulation/README.md#match-the-calibration-reference) beschrieben.
<!-- /translated-content -->
