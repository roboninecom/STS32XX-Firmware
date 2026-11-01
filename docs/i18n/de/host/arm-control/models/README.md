<!-- translation-navigation -->
[English](../../../../en/host/arm-control/models/README.md) · [Русский](../../../../ru/host/arm-control/models/README.md) · [Español](../../../../es/host/arm-control/models/README.md) · [Français](../../../../fr/host/arm-control/models/README.md) · [Deutsch](README.md) · [Português (Brasil)](../../../../pt-BR/host/arm-control/models/README.md) · [简体中文](../../../../zh-CN/host/arm-control/models/README.md) · [日本語](../../../../ja/host/arm-control/models/README.md) · [हिन्दी](../../../../hi/host/arm-control/models/README.md) · [العربية](../../../../ar/host/arm-control/models/README.md)

[Englisches Original](../../../../../../host/arm-control/models/README.md)

> Vollständige maschinelle Übersetzung, noch nicht von Muttersprachlern geprüft. Bilder und Videos werden gemeinsam verwendet; enthaltene Texte bleiben in der Originalsprache.
<!-- /translation-navigation -->

<!-- translated-content -->
<a id="gravity-models"></a>
# Schwerkraftmodelle

Im Lieferumfang sind zwei aufrechte empty-gripper-Modelle enthalten:

- `arm-upright-empty.json`: SO-102.
- `so101-upright-empty.json`: SO-101.

Beide umfassen Encoder-Kalibrierung und gekoppelte Terme für Motoren 2–4. Die Motoren 1, 5 und 6 verfügen über eine explizite Nullkompensation. Sie gehen von der Originalmontage, den Encoder-Offsets und der Gestängegeometrie aus. Überprüfen Sie die Hardware erneut, bevor Sie ein anderes Setup verwenden. Passende [Controller-Profile](../profiles/README.md) beschreiben ihre Betriebseinstellungen und verbleibenden Einschränkungen.

Die Datei enthält vorzeichenbehaftete PWM-Aufwandskoeffizienten und die Encodereinstellungen, an die sie angepasst wurden. `encoderCalibration` listet vorzeichenbehaftete Positionskorrekturen, Einheitenauflösung und Encoder-Umkehr für jeden Motor auf. Für den Preflight müssen sie mit dem angeschlossenen Arm übereinstimmen. Grenzwerte und Gewinne sind separate Einstellungen.

Durch die Kalibrierung wird die erfasste physische Pose als 2048 angezeigt. Die von diesen Modellen verwendeten Gelenkwinkel werden nicht identifiziert. Diese Winkel sind bereits in den Begriffen Gewichtungen und Offsets enthalten. Die Reproduktion derselben Pose auf einem anderen Arm kann zu unterschiedlichen motorischen Versätzen führen. Passen Sie das Modell an diesen Arm an oder passen Sie es an und überprüfen Sie seine Ausgabe. Kopieren Sie keine Offsets vom gelieferten Modell in die Motoren. Wenn Sie nur `encoderCalibration` ändern, wird die Schwerkraftberechnung nicht aktualisiert. Siehe [Auswahl einer Referenzpose](../../../tools/settings/README.md#choose-the-reference-pose).

Jeder Motor hat eine `maxEffort`, eine erklärende `note` und eine Liste von `terms`. Ein Begriff trägt `coefficient * sin(angle)` oder `coefficient * cos(angle)` bei, wobei `angle = offsetRad + sum(measuredEncoderCounts[id] * weights[id])`. Winkel sind Bogenmaß. Ein `constant`-Term trägt seinen Koeffizienten bei und hat keine Gewichte. Eine leere Liste fordert explizit eine Nullkompensation an.

Alle gewichteten Motor-IDs müssen zu den kontrollierten Followern gehören. Jeder Follower benötigt ein explizites Modell. Die Auswertung lehnt fehlende Eingaben, nicht endliche Werte und Anstrengungen ab, die entweder über der Modellobergrenze oder der konfigurierten motorischen Anstrengungsgrenze liegen. Es schneidet niemals stillschweigend ein übermäßiges Ergebnis ab.
<!-- /translated-content -->
