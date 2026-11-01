<!-- translation-navigation -->
[English](../../../../en/tools/simulation/urdf/README.md) · [Русский](../../../../ru/tools/simulation/urdf/README.md) · [Español](../../../../es/tools/simulation/urdf/README.md) · [Français](../../../../fr/tools/simulation/urdf/README.md) · [Deutsch](README.md) · [Português (Brasil)](../../../../pt-BR/tools/simulation/urdf/README.md) · [简体中文](../../../../zh-CN/tools/simulation/urdf/README.md) · [日本語](../../../../ja/tools/simulation/urdf/README.md) · [हिन्दी](../../../../hi/tools/simulation/urdf/README.md) · [العربية](../../../../ar/tools/simulation/urdf/README.md)

[Englisches Original](../../../../../../tools/simulation/urdf/README.md)

> Vollständige maschinelle Übersetzung, noch nicht von Muttersprachlern geprüft. Bilder und Videos werden gemeinsam verwendet; enthaltene Texte bleiben in der Originalsprache.
<!-- /translation-navigation -->

<!-- translated-content -->
<a id="so-arm-102-model"></a>
# SO-ARM 102 Modell

URDF und acht STL-Netze aus [Robonines SO-ARM-102](https://github.com/roboninecom/SO-ARM-102/tree/0f0dd95526638042a3213598ee0ae7f167c40efe/simulation/urdf), commit `0f0dd95526638042a3213598ee0ae7f167c40efe`. Die Dateien werden unverändert kopiert. `source.json` zeichnet ihre Prüfsummen auf. Xacro und ROS-Paketgerüste werden nicht benötigt, um das eigenständige URDF zu laden.

Copyright (c) 2026 Robonine. Attribution: Robonine, SO-ARM 102, https://github.com/roboninecom/SO-ARM-102, CC BY 4.0. Siehe [LICENSE.txt](../../../../../../tools/simulation/urdf/LICENSE.txt) und die vorgelagerte [Lizenzkarte](https://github.com/roboninecom/SO-ARM-102/blob/0f0dd95526638042a3213598ee0ae7f167c40efe/LICENSING.md).

<a id="model-assumptions"></a>
## Modellannahmen

Die vorgelagerte Massenschätzung ist **0.889 kg**. Sie geht von PLA-Druck und 70 g pro Servo aus. Siehe die vorgelagerten [Exporteinstellungen](https://github.com/roboninecom/SO-ARM-102/blob/0f0dd95526638042a3213598ee0ae7f167c40efe/simulation/urdf/export_settings.json) und [Masseigenschaften](https://github.com/roboninecom/SO-ARM-102/blob/0f0dd95526638042a3213598ee0ae7f167c40efe/simulation/urdf/mass_properties.json). Dies sind Schätzungen; das gemessene Hardwaregravitationsmodell bleibt getrennt.

URDF zero ist die exportierte CAD Pose. Die [Encoderkarte](../../../../../../tools/simulation/encoder-angle-map.json) setzt M1–M4 Winkel bei Zählung 2048 bis 0°, −3°, 1° bzw. 1°. M5 und Greiferkalibrierung bleiben ungeprüft. Das Festkieferdisplay verwendet +0.016 m und −0.016 m, passend zur URDF opposite-sign Kupplung.

Die Quelle behält ihre Kollisionsboxen. Die Modellvorbereitung lässt sie von der generierten Vorschau aus, da diese Werkzeuge die Kontaktsimulation deaktivieren. Sie bewahrt Optik, Trägheit und Gelenkkupplung. Simulationsergebnisse kalibrieren keine realen Motordynamiken oder etablieren keine Hardware-Tuning-Gewinne.
<!-- /translated-content -->
