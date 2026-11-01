<!-- translation-navigation -->
[English](../../../../en/host/arm-control/profiles/README.md) · [Русский](../../../../ru/host/arm-control/profiles/README.md) · [Español](../../../../es/host/arm-control/profiles/README.md) · [Français](../../../../fr/host/arm-control/profiles/README.md) · [Deutsch](README.md) · [Português (Brasil)](../../../../pt-BR/host/arm-control/profiles/README.md) · [简体中文](../../../../zh-CN/host/arm-control/profiles/README.md) · [日本語](../../../../ja/host/arm-control/profiles/README.md) · [हिन्दी](../../../../hi/host/arm-control/profiles/README.md) · [العربية](../../../../ar/host/arm-control/profiles/README.md)

[Englisches Original](../../../../../../host/arm-control/profiles/README.md)

> Vollständige maschinelle Übersetzung, noch nicht von Muttersprachlern geprüft. Bilder und Videos werden gemeinsam verwendet; enthaltene Texte bleiben in der Originalsprache.
<!-- /translation-navigation -->

<!-- translated-content -->
<a id="arm-profiles"></a>
# Armprofile

Referenzeinstellungen aus dem Stand, empty-gripper Arme. Jedes Verzeichnis enthält eine Controller-Datei und ein Profil pro Motor, einschließlich PID und Richtungsgeschwindigkeits-Feedforward. Beide Controller nutzen die Schwerkraftmodelle für Motoren 2–4; Die Motoren 1, 5 und 6 erfahren eine Schwerelosigkeitskraft.

| Profil | Wiedergabegeschwindigkeit | Beschleunigung | Umfang |
| --- | ---: | ---: | --- |
| [SO-101](../../../../../../host/arm-control/profiles/so101/controller.json) | 1,000 counts/s; Profildecke 1,500 | 10,000 counts/s² | Tuning-Einstellungen beibehalten. M1 Bewegungsoszillation und langsamere M2 Auslenkungen bleiben ungelöst. |
| [SO-102](../../../../../../host/arm-control/profiles/so102/controller.json) | 2,000 counts/s | 15,000 counts/s² | Aktuelle fixed-profile Vergleichseinstellungen. Diese schnelle Konfiguration erfordert noch eine Hardwarevalidierung. |

Dabei handelt es sich um Ausgangspunkte, nicht um universelle Vorgaben oder den Anspruch einer abgeschlossenen Abstimmung. Das SO-102-Profil verwendet feste M1 D=0.0625, M6 P=4 und eine 100 ms-Rampe. Die ältere Wiedergabe verwendete während der Bewegung M1 D=0.75, M6 P=16 und eine Rampe von 180 ms, sodass diese Datei diesen älteren Lauf nicht reproduziert.

<a id="use"></a>
## Benutzen

Stellen Sie `followerPort` in der ausgewählten Controller-Datei ein. Halten Sie das relative Profil und die Schwerkraftpfade intakt. Aus dem Repository-Stammverzeichnis:

```sh
npm run replay -- host/arm-control/profiles/so102/controller.json POSES.json
npm run replay -- host/arm-control/profiles/so102/controller.json POSES.json --run
```

Verwenden Sie `so101` für das andere Profil. Die erste Befehlsvorschau; die zweite bewegt den Arm und verlässt ihn mit der letzten Pose. Replay wendet die Profile auf RAM an. Zur Teleoperation setzen Sie `leaderPort` auch und fügen Sie `leaderId`, `mapping` und beliebige direction/center Überbrückungen zu jedem Gelenk hinzu; siehe [Mapping guide](../../../tools/teleoperation/README.md#mapping-and-control).

Gravity-Modelle enthalten die während der Montage verwendete Encoderkalibrierung. Preflight erfordert, dass sie dem angeschlossenen Arm entspricht. **Kopieren Sie keine anderen Encoder-Offsets, um diese Prüfung zu erfüllen.** Kalibrieren Sie Ihren Arm, passen oder passen Sie sein Modell an und validieren Sie das Ergebnis mit bescheidener Geschwindigkeit vor der Verwendung von full-speed. Änderungen an der Montage, Linkgeometrie oder Nutzlast erfordern auch eine Validierung. Siehe das [Gravity-Modellformat](../models/README.md) und [Tuning-Verfahren](../../../tools/tuning/README.md).

Diese Dateien definieren keine universelle physikalische Kalibrierpose. Folgen Sie der [reference-pose Anleitung](../../../tools/settings/README.md#choose-the-reference-pose) vor der Erstellung einer neuen Kalibrierung. Einstellung aller Motoren auf 2048 reproduziert die Pose auf diesem Arm erfasst, vorbehaltlich seiner gespeicherten Grenzen und Tracking-Fehler; es nicht automatisch reproduzieren entweder gebündelt Modell Null Pose.
<!-- /translated-content -->
