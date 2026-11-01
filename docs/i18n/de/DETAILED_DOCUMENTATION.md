<!-- translation-navigation -->
[English](../en/DETAILED_DOCUMENTATION.md) · [Русский](../ru/DETAILED_DOCUMENTATION.md) · [Español](../es/DETAILED_DOCUMENTATION.md) · [Français](../fr/DETAILED_DOCUMENTATION.md) · [Deutsch](DETAILED_DOCUMENTATION.md) · [Português (Brasil)](../pt-BR/DETAILED_DOCUMENTATION.md) · [简体中文](../zh-CN/DETAILED_DOCUMENTATION.md) · [日本語](../ja/DETAILED_DOCUMENTATION.md) · [हिन्दी](../hi/DETAILED_DOCUMENTATION.md) · [العربية](../ar/DETAILED_DOCUMENTATION.md)

[Englisches Original](../../../DETAILED_DOCUMENTATION.md)

> Vollständige maschinelle Übersetzung, noch nicht von Muttersprachlern geprüft. Bilder und Videos werden gemeinsam verwendet; enthaltene Texte bleiben in der Originalsprache.
<!-- /translation-navigation -->

<!-- translated-content -->
<a id="detailed-documentation"></a>
# Ausführliche Dokumentation

Beginnen Sie mit der **[Schnellstart](QUICKSTART.md)**-Anleitung zum Flashen, Testen, Wiederholen und zur Schwerkraftkompensation. Unter [tools](tools/README.md)] finden Sie individuelle Befehlsanleitungen.

Firmware für GD32F130-based STS3215 Servos, mit zwei Möglichkeiten, den Motor zu steuern:

- **Legacy-Modus** verwendet die standardmäßigen STS-Befehle für Position, Geschwindigkeit und Motorleistung. Es ist standardmäßig aktiviert.
- **Erweiterungsmodus** sorgt für sanfte Bewegung, einstellbare Positionssteuerung und Kompensation für Bewegung und Schwerkraft. Der angeschlossene Computer sendet Einstellungen und Ziele; Jedes Servo berechnet seine Bewegung lokal.

In diesem Dokument wird die Funktionsweise der Funktionen erläutert und anschließend die Befehls- und Registerreferenz für **Extension Protocol v9.0** bereitgestellt. Erweiterungseinstellungen werden im temporären Speicher gehalten und müssen nach einem Reset oder Aus- und Wiedereinschalten erneut gesendet werden. Die Steuerungssoftware muss Version 9 unterstützen; Ältere Erweiterungsclients sind nicht kompatibel.

- [Legacy-Modus](#legacy-mode)
- [So funktioniert der Erweiterungsmodus](#how-extension-mode-works)
- [S-curve Bewegung](#s-curve-motion)
- [Kalibrierungsreferenzposen](#calibration-reference-poses)
- [PID Controller](#pid-controller)
- [Geschwindigkeitsvorsteuerung](#velocity-feedforward)
- [Schwerkraftkompensation](#gravity-compensation)
- [Erweiterungsmodus starten und stoppen](#starting-and-stopping-extension-mode)
- [Erweiterungsprotokoll](#extension-protocol)
- [Erweiterungsregister](#extension-registers)
- [Build und Verifizierung](#build-and-verification)
- [Repository-Layout](#repository-layout)
- [Aktuelle Grenzwerte](#current-limits)

<a id="legacy-mode"></a>
## Legacy-Modus

Der Legacy-Modus unterstützt die standardmäßige STS-Registerschnittstelle, einschließlich Motorleistung, Betriebsmodus, Positions- und Geschwindigkeitsbefehle sowie Statusmesswerte. Vorhandene STS-Software kann Register **0–86** verwenden, ohne die Erweiterung zu aktivieren.

In älteren Positionsmodi wird die gemessene Position auch außerhalb der gespeicherten Grenzen beibehalten, wenn die Motorleistung ohne einen neuen Positionsbefehl aktiviert wird. Es wird kein altes Ziel erneut abgespielt und die Welle nicht bis zur nächsten Grenze bewegt. Neue Positionsbefehle sind weiterhin auf die gespeicherten Grenzwerte begrenzt.

Die Erweiterung verwendet ihre eigenen Bewegungs- und Steuerungseinstellungen. Verstärkungswerte sollten nicht direkt zwischen den beiden Modi kopiert werden, da ihre Maßstäbe unterschiedlich sind. Die Unterstützung der Standardbefehle garantiert nicht das identische physikalische Verhalten aller Servomodelle.

<a id="how-extension-mode-works"></a>
## So funktioniert der Erweiterungsmodus

[Sehen Sie sich die aufgezeichnete Übersicht auf YouTube an](https://youtu.be/AsxFs24vXQs) | [MP4](../../../assets/readme/videos/overview.mp4)

Der **Host** ist der Computer oder Controller, der mit den Servos verbunden ist. Es sendet ein **Ziel**: ein Ziel und eine Geschwindigkeitsbegrenzung. Beschleunigungs- und Kompensationseinstellungen werden vor der Aktivierung der Motorleistung konfiguriert. Jedes Servo dann:

1. Plant eine reibungslose Bewegung zum Ziel.
2. Misst seine Position und schätzt seine Geschwindigkeit.
3. Passt die Motorleistung an die geplante Bewegung an.
4. Hält das Ziel, wenn die Bewegung beendet ist.

Die zu jedem Zeitpunkt geplante Position und Geschwindigkeit werden als **Referenz** bezeichnet. Die Steuerung vergleicht sie mit der gemessenen Bewegung, sodass eine Referenzposition und eine tatsächliche Position unterschiedlich sein können.

Einige in diesem Dokument verwendete Begriffe:

| Begriff | Bedeutung |
| --- | --- |
| Anzahl der Encoder | Eine Positionsmesseinheit; nominell 4096 Zählungen pro Umdrehung |
| Aufwand | Der vorzeichenbehaftete motor-output-Befehl: Sein Vorzeichen bestimmt die Richtung und seine Größe bestimmt die Ausgabestärke |
| Gewinn | Eine Einstellung, die bestimmt, wie stark der Controller reagiert |
| Feedforward | Zusätzliche Motorleistung wird anhand des erwarteten Bedarfs berechnet, anstatt auf einen Positions- oder Geschwindigkeitsfehler zu warten |
| Rückmeldung | Vom Servo zurückgegebene Messwerte und Status |
| Registrieren | Eine Einstellung oder ein Messwert, der durch eine Nummer gekennzeichnet ist |
| Sitzung | Ein Zeitraum der Erweiterungskontrolle, identifiziert durch eine vom Host bereitgestellte Nummer |

Der Aufwand wird in PWM-Einheiten ausgedrückt, den Einheiten, die zur Steuerung der elektrischen Leistung des Motors verwendet werden. Die Erweiterung ermöglicht eine Leistungsbegrenzung bis zu **1000** in beide Richtungen. Bei diesen Werten handelt es sich nicht um direkte Drehmoment- oder Strommessungen.

<a id="s-curve-motion"></a>
## S-curve Bewegung

[![Konzeptionelle Darstellung von s-curve Bewegung](../../../assets/readme/illustrations/s-curve.png)](https://youtu.be/92mDt4rbobY)

[Auf YouTube ansehen](https://youtu.be/92mDt4rbobY) | [MP4](../../../assets/readme/videos/s-curve.mp4)

Sorgt für sanfteres Beschleunigen und Bremsen. Die Kurve veranschaulicht die Beschleunigung über die Zeit. Konzeptionelle Darstellung, keine gemessenen Hardwaredaten.

Eine S-curve sorgt dafür, dass die Beschleunigung allmählich zu- und abnimmt. Anstatt plötzlich die volle Beschleunigung oder das Bremsen auszuüben, bewegt sich das Servo sanft in jeden Teil der Bewegung hinein und wieder heraus. Dadurch können mechanische Stöße und Vibrationen reduziert werden.

Eine vollständige Bewegung von Ruhe zu Ruhe besteht aus diesen Phasen:

| Bühne | Was passiert |
| --- | --- |
| 1 | Die Beschleunigung nimmt allmählich zu |
| 2 | Das Servo beschleunigt gleichmäßig |
| 3 | Die Beschleunigung nimmt allmählich auf Null ab |
| 4 | Das Servo bewegt sich mit gleichmäßiger Geschwindigkeit |
| 5 | Die Bremswirkung nimmt allmählich zu |
| 6 | Das Servo bremst gleichmäßig |
| 7 | Die Bremswirkung nimmt allmählich ab, wenn das Servo stoppt |

Kurze Bewegungen überspringen Etappen, wenn die Distanz nicht ausreicht, um die gewünschte Geschwindigkeit oder Beschleunigung zu erreichen. Beim Beschleunigen und Verlangsamen gilt die gleiche Beschleunigungsgrenze.

Die Einstellung `ramp_time_ms` steuert, wie lange es dauert, bis die Beschleunigung von Null auf ihren Grenzwert ansteigt. Eine längere Rampe sorgt für einen sanfteren Wechsel, erfordert aber im Allgemeinen mehr Zeit und Distanz zum Beschleunigen oder Anhalten.

**Ruck** bezeichnet die Geschwindigkeit, mit der sich die Beschleunigung ändert. Dieser Planer begrenzt den Ruck, sodass sich die Beschleunigung reibungslos ändert. Der Ruck selbst kann sich zwischen den Phasen immer noch abrupt ändern. Seine ungefähre Größe beträgt:

```text
jerk = 1000 × acceleration / ramp_time_ms    [counts/s³]
```

<a id="changing-a-destination-during-movement"></a>
### Ändern eines Ziels während der Bewegung

Ein neues Ziel setzt die aktuell geplante Bewegung fort und behält seine Position, Geschwindigkeit und Beschleunigung bei. Durch erneutes Senden desselben Ziels wird die Verschiebung nicht neu gestartet. Halten Sie während der Fahrt die vorgeschriebene Geschwindigkeitsbegrenzung ein; es kann sich für die nächste Bewegung ändern, sobald die geplante Bewegung gestoppt wurde. Beschleunigung und Rampenzeit gehören zur Konfiguration und erfordern zum Ändern das Ausschalten des Motors und eine deaktivierte Sitzung.

Ein Ziel außerhalb der gespeicherten Legacy-Positionsgrenzen wird **auf die nächstgelegene Grenze begrenzt**. Auch die angeforderte Geschwindigkeit wird auf ihren konfigurierten Grenzwert begrenzt. Der Servo verwendet für jede Bewegung die konfigurierte Beschleunigung. Eine Geschwindigkeit von null oder eine konfigurierte Beschleunigung von null ist ungültig.

Die gesamte geplante Bewegung muss innerhalb der Positionsgrenzen bleiben. Ein neues Ziel kann daher abgelehnt werden, wenn sich der Servo bereits einer Grenze zu schnell nähert, um innerhalb dieser anzuhalten, selbst wenn das Ziel selbst zulässig ist.

Bei der Ankunft hält das Servo bei eingeschaltetem Motor automatisch das Ziel. Die gemessene Position kann aufgrund von Reibung, Last, Leistungsgrenzen oder Abstimmung immer noch Fehler aufweisen. Durch Halten wird der Positionsfehler weiterhin korrigiert; Die Motorleistung wird nicht auf einen festen Wert eingefroren.

Jedes Servo plant seine eigene Bewegung. Das gleichzeitige Senden mehrerer Ziele garantiert nicht, dass alle Servos gleichzeitig ankommen.

<a id="shared-position-limits"></a>
### Gemeinsame Positionslimits

Legacy- und Erweiterungssteuerung verwenden dieselben position-limit-Register: **9–10** enthalten das Minimum und **11–12** das Maximum. Jeder Wert ist ein vorzeichenloser 16-Bit-Wert in korrigierten Encoder-Zählungen, einschließlich der konfigurierten Richtung und Positionskorrektur des Servos. Es gibt keine separaten Erweiterungseinstellungen position-limit.

Durch die Kalibrierung werden die Encoder-Zählungen den physischen Positionen zugeordnet. Das [Kalibrierungstool](tools/settings/README.md#choose-the-reference-pose) lässt die erfasste Referenzposition 2048 anzeigen und misst dann die Verfahrgrenzen. Diese Zählung ist nicht automatisch ein Gelenkwinkel von zero-degree und der gemessene Wegmittelpunkt ersetzt nicht die erfasste Referenz. Schwerkraftmodelle und Visualisierungen benötigen eine passende count-to-angle-Zuordnung.

Die Firmware liest diese Register beim Start der Regelung. Bei aktivierten Positionsgrenzen muss das Minimum kleiner als das Maximum sein, das Maximum darf höchstens 32767 betragen und die gemessene Position muss innerhalb des Bereichs liegen. Andernfalls schlägt der Start fehl, ohne den Motor zu bewegen. Der Planer hält die gesamte Bewegung einschließlich des Bremsens innerhalb des eingelesenen Bereichs.

**Gleiche Mindest- und Höchstwerte deaktivieren die Reisebeschränkungen** und entsprechen dem alten Verhalten. Erweiterungsbefehle bleiben weiterhin innerhalb ihres unterstützten Positionsbereichs von −32767 bis 32767 Zählungen.

Ein akzeptierter Schreibzugriff auf einen der Grenzwerte beendet eine aktive Erweiterungssitzung und schaltet den Motor aus, einschließlich Schreibvorgängen, die nur in RAM angewendet werden. Aktivieren Sie eine neue Sitzung, um die geänderten Werte zu verwenden. Die normale Persistenz der alten Einstellungen gilt weiterhin.

<a id="calibration-reference-poses"></a>
## Kalibrierungsreferenzpositionen

Für eine neue SO-101- oder SO-102-Kalibrierung verwenden Sie die abgebildeten Gelenkpositionen. Zentrieren Sie die Basis und die Handgelenkrolle zwischen ihren Anschlägen und lassen Sie den Greifer halb geöffnet. Das Kalibrierungstool speichert diese manuell platzierte Pose als 2048 für jeden Motor. Behalten Sie eine vorhandene verifizierte Kalibrierung bei, wenn Sie die Aufzeichnungen und das Schwerkraftmodell wiederverwenden.

**SO-101 Referenzpose**

[![SO-101 Referenzpose mit sechs beschrifteten Gelenken](../../../tools/settings/images/so101-reference-pose.png)](../../../tools/settings/images/so101-reference-pose.png)

**SO-102 Referenzpose**

[![SO-102 Referenzpose mit sechs beschrifteten Gelenken](../../../tools/settings/images/so102-reference-pose.png)](../../../tools/settings/images/so102-reference-pose.png)

Öffnen Sie ein Bild für eine größere Ansicht. Befolgen Sie die [Kalibrierungsanleitung](tools/settings/README.md#reference-pose-images) für das two-step-Verfahren und die model-mapping-Anforderungen.

<a id="pid-controller"></a>
## PID Controller

[![Konzeptionelle Darstellung der PID-Regelung](../../../assets/readme/illustrations/pid-tuning.png)](https://youtu.be/TEpvaAMlfrg)

[Auf YouTube ansehen](https://youtu.be/TEpvaAMlfrg) | [MP4](../../../assets/readme/videos/pid-tuning.mp4)

Passt an, wie das Servo Positionsfehler korrigiert. Die graue Kurve veranschaulicht die Schwingung; Die weiße Kurve zeigt eine gedämpftere Reaktion. Die gestrichelte Linie ist das Ziel. Konzeptionelle Darstellung, keine gemessenen Hardwaredaten.

Der PID-Controller passt die Motorleistung an die geplante Bewegung an. Seine drei Einstellungen haben unterschiedliche Aufgaben:

| Einstellung | Was es bewirkt | Hauptkompromiss |
| --- | --- | --- |
| **P – Positionskorrektur** | Zieht den Motor in die geplante Position; Größere Fehler führen zu mehr Korrekturen | Ein höherer P kann Fehler reduzieren, kann aber auch zu Schwingungen führen |
| **I – kumulierte Korrektur** | Baut zusätzliche Korrekturen auf, wenn ein Fehler weiterhin besteht | Kann einen dauerhaften Fehler reduzieren, kann jedoch die Überschwing- oder Einschwingzeit verlängern |
| **D – Geschwindigkeitskorrektur** | Reagiert auf die Differenz zwischen geplanter und gemessener Geschwindigkeit; Widersteht Bewegungen beim Halten | Kann die Dämpfung verbessern, aber eine übermäßige Reaktion auf verrauschte Geschwindigkeitsmesswerte kann zu einer ungleichmäßigen Ausgabe führen |

Die Berechnung lautet:

```text
position error = planned position − measured position
speed error = planned speed − filtered measured speed

motor output = Kp × position error
             + Kd × speed error
             + accumulated I correction
             + gravity compensation
             + velocity feedforward
```

Das Ergebnis wird auf die konfigurierte maximale Leistung begrenzt. Durch den Motorschutz kann es noch weiter reduziert werden. Die Rückmeldung meldet sowohl die angeforderte als auch die angelegte Leistung, sodass der Host erkennen kann, wann der Motor begrenzt wird.

Die gemessene Geschwindigkeit wird mithilfe aktueller Positionswerte und eines einstellbaren Filters geglättet. Eine größere Einstellung von `velocity_filter_q8` reagiert schneller auf Änderungen, entfernt aber weniger Messrauschen.

<a id="preventing-excessive-accumulated-correction"></a>
### Verhinderung übermäßiger akkumulierter Korrekturen

Der I-Beitrag hat seine eigene Grenze. Der Regler verhindert außerdem, dass er in eine Richtung weiter baut, in der die Motorleistung bereits begrenzt ist; Dies wird allgemein als **anti-windup** bezeichnet. Sie kann immer noch verringert werden, um dem Motor zu helfen, sich von dieser Grenze zu erholen. Wenn Sie `Ki` auf Null setzen, wird die I-Korrektur deaktiviert und gelöscht.

Wenn der Servo mindestens 50 ms nahezu stationär war und der Positionsfehler innerhalb eines Encoder-Zählwerts liegt, hört die Akkumulation von I auf. P, D und beide Feedforward-Formen bleiben aktiv. Durch Ausschalten des Motorausgangs wird die I-Korrektur gelöscht.

<a id="velocity-feedforward"></a>
## Geschwindigkeitsvorsteuerung

[![Konzeptionelle Darstellung der Geschwindigkeitsvorsteuerung](../../../assets/readme/illustrations/velocity-feedforward.png)](https://youtu.be/osGGs-nhk9I)

[Auf YouTube ansehen](https://youtu.be/osGGs-nhk9I) | [MP4](../../../assets/readme/videos/velocity-feedforward.mp4)

Addiert die Motorleistung basierend auf der geplanten Geschwindigkeit, die im Servo berechnet wird. Beide Kurven verlaufen im Zeitverlauf von links nach rechts. Konzeptionelle Darstellung, keine gemessenen Hardwaredaten.

Die Geschwindigkeitsvorsteuerung liefert einen Teil der Ausgangsleistung, die voraussichtlich für die Bewegung benötigt wird, bevor ein Tracking-Fehler entsteht. Sie wird **im Servo** aus der geplanten Geschwindigkeit berechnet:

```text
velocity feedforward = velocity gain × planned speed
```

Es gibt einen Gewinn für jede Richtung und eine Grenze für die resultierende Ausgabe. Beide Gewinne sind nicht negativ; Die Bewegungsrichtung bestimmt das Ausgangszeichen. Seine Ausgabegrenze darf nicht größer sein als die Hauptgrenze motor-output.

Da das Servo seine eigene geplante Geschwindigkeit kennt, folgt die Kompensation automatisch der Beschleunigung und dem Bremsen und wird Null, wenn die geplante Bewegung stoppt. Der Host liefert lediglich seine Einstellungen; Es ist nicht erforderlich, kontinuierlich velocity-feedforward-Werte zu senden.

Konfigurieren Sie diese Funktion zusammen mit den anderen Einstellungen in `0xA0`, während der Motor ausgeschaltet und die Sitzung deaktiviert ist. Setzen Sie beide Verstärkungen und die Ausgangsgrenze auf Null, um sie zu deaktivieren.

<a id="gravity-compensation"></a>
## Schwerkraftkompensation

[![Konzeptionelle Darstellung der Schwerkraftkompensation](../../../assets/readme/illustrations/gravity-compensation.png)](https://youtu.be/25sc41PTDIA)

[Auf YouTube ansehen](https://youtu.be/25sc41PTDIA) | [MP4](../../../assets/readme/videos/gravity-compensation.mp4)

Der Host berechnet den Beitrag und der Servo wendet ihn an. Der Abwärtspfeil stellt das Gewicht dar; Der Aufwärtspfeil steht für Unterstützung. Konzeptionelle Darstellung, keine gemessenen Hardwaredaten.

Die Schwerkraftkompensation liefert die erforderliche Leistung, um das Gewicht eines Arms und seiner Last zu tragen. Dies ist auch dann nützlich, wenn der Motor stillsteht und die Geschwindigkeitsvorsteuerung Null ist.

Der **Host berechnet die Schwerkraftkompensation** und sendet einen vorzeichenbehafteten Ausgabewert an jedes Servo. Bei der Berechnung können Gelenkwinkel, Armabmessungen, Verbindungsgewichte und Nutzlast berücksichtigt werden. Der Host muss die geschätzte Last in die Ausgangseinheiten des Servos umrechnen. Die Firmware enthält kein Modell des Arms.

Die Richtung ist wichtig: Der positive Erweiterungsausgang folgt steigenden Encoder-Zählungen. Die joint-angle-Konvention eines Arms kann in die entgegengesetzte Richtung verlaufen, daher muss die Konvertierung des Hosts dies berücksichtigen.

Jede Schwerkraftaktualisierung enthält den gewünschten Ausgabewert. Die **Anstiegsrate** – wie schnell sich die Kompensation ändern kann, in Ausgabeeinheiten pro Sekunde – ist Teil der Hauptkonfiguration und bleibt während der gesamten Sitzung konstant.

Das Servo ändert seine Kompensation schrittweise in Richtung des gewünschten Werts und addiert ihn zum Reglerausgang. Alle Beiträge zusammen unterliegen weiterhin der konfigurierten Leistungsbegrenzung und dem Motorschutz.

**Wenn keine Schwerkraftaktualisierungen mehr eintreffen, fährt das Servo mit der konfigurierten Anstiegsgeschwindigkeit bis zur zuletzt angeforderten Kompensation fort und behält dann diesen Wert bei.** Es gibt keinen Ablaufzeitgeber. Der Host sollte die Kompensation aktualisieren, wenn sich die Armhaltung oder -last ändert. Durch Setzen des torque-enable-Registers **40** auf Null wird die Kompensation gelöscht und der Motorausgang ausgeschaltet.

<a id="starting-and-stopping-extension-mode"></a>
## Erweiterungsmodus starten und stoppen

Die folgende Sequenz verwendet die später dokumentierten Registernummern und Befehle. Die Auswahl bereitet eine Sitzung vor. Die Aktivierung der Motorleistung startet die Steuerung.

1. Suchen Sie die IDs der angeschlossenen Servos und lesen Sie die Fähigkeiten jedes Servos ab. Suchen Sie nach `ARMC` und Version `9.0`. Wiederholen Sie diese Prüfung nach einem Reset oder einer Firmware-Änderung.
2. Schalten Sie den Motor aus, indem Sie das Legacy-torque-enable-Register **40** auf `0` setzen. Beenden Sie eine beliebige bestehende Sitzung und wenden Sie alle dauerhaften Legacy-Einstellungen an.
3. Schreiben und lesen Sie die vollständige Konfiguration (`0xA0`) zurück, einschließlich der Geschwindigkeits-Feedforward-Einstellungen und der Schwerkraftanstiegsrate.
4. Schreiben Sie `mode=1` und eine neue Sitzungsnummer ungleich Null in `0xB8` (insgesamt 3 Bytes). Dadurch wird der Erweiterungsmodus ausgewählt und der nächste Start vorbereitet; Der Strom bleibt ausgeschaltet.
5. Setzen Sie das Register **40** auf `1`. Die Firmware überprüft Sensoren, Schutzstatus, Konfiguration und gespeicherte Positionsgrenzen und erfasst dann die gemessene Position als anfängliches Halteziel. Befehlszähler, I-Korrektur und Schwerkraftkompensation beginnen bei Null. Lesen Sie `0xC1` und warten Sie auf die richtige Sitzung, aktuelle nutzbare Messungen, aktivierten Motorantrieb und bereite Ausgabe.
6. Senden Sie Ziele und etwaige Schwerkraftaktualisierungen. Lesen Sie das Feedback, um zu überprüfen, welche Befehle angenommen wurden und wie genau das Servo ihnen folgt.
7. Der Servo beendet seine letzte Bewegung und hält das Ziel, bis ihm ein neues Ziel gegeben wird. Setzen Sie das Register **40** auf `0`, um den Motor auszuschalten und die Sitzung zu beenden. Um zum Legacy-Modus zurückzukehren, lassen Sie das Gerät ausgeschaltet und schreiben Sie `mode=0, session=0` bis `0xB8`.

Wenn ein Start fehlschlägt, kehrt Register **40** zu `0` zurück. Die normale Schreibbestätigung allein bestätigt den erfolgreichen Start nicht: Überprüfen Sie die Registerauslesung und Rückmeldung. Jeder Startversuch verbraucht die vorbereitete Sitzung. Beheben Sie nach einem fehlgeschlagenen Start, torque-off oder einer Schutzabschaltung die Ursache und schreiben Sie `0xB8` mit einer neuen Sitzungsnummer, bevor Sie das Drehmoment erneut aktivieren. Durch wiederholtes Aktivieren des Drehmoments während der Steuerung bleiben die Ziel-, Kompensations- und Befehlszähler erhalten.

Befehle, die einen angetriebenen Motor bewegen oder verstellen, erfordern fertige Hardware, keinen gemeldeten Fehler und Sensormesswerte, die nicht älter als **2 ms** sind. Der Controller aktualisiert normalerweise alle **1 ms** und akzeptiert Intervalle bis zu 2 ms. Längere Lücken führen dazu, dass die Motorleistung deaktiviert wird.

Vermeiden Sie bei Verwendung der Erweiterung ältere Schreibvorgänge in das Betriebsmodusregister **33** oder die Bewegungsregister **41–47**: Sie schalten den Motor aus und verlassen den Erweiterungsmodus. Durch das Speichern dauerhafter Einstellungen wird auch die Erweiterungssteuerung beendet. Wenn Sie das Register **40** auf `0` setzen, bleibt der Erweiterungsmodus ausgewählt und bereit für die Einrichtung einer weiteren Sitzung.

<a id="if-host-commands-stop-arriving"></a>
### Wenn keine Hostbefehle mehr eintreffen

Das Servo beendet die letzte akzeptierte Bewegung und behält dieses Ziel bei. Die Schwerkraftkompensation nähert sich weiterhin dem zuletzt angeforderten Wert und bleibt dort. Es sind keine wiederholten Nachrichten erforderlich, um die Sitzung aktiv zu halten, und der Verlust der Host-Kommunikation führt nicht selbst zu einer Änderung des Ziels oder zum Abschalten der Motorleistung.

Um die Richtung des Servos zu ändern, senden Sie ein anderes Ziel. Um den Motor freizugeben, setzen Sie die Drehmomentfreigabe auf Null. Sensorfrischeprüfungen, Motorschutz und der Firmware-Watchdog bleiben beim Bewegen und Halten aktiv.

<a id="extension-protocol"></a>
## Erweiterungsprotokoll

In diesem Abschnitt werden die genauen Nachrichten beschrieben, die zwischen Host und Servo ausgetauscht werden. Es richtet sich an Leser, die ihre eigene Software anschließen.

<a id="message-format-and-number-encoding"></a>
### Nachrichtenformat und Zahlenkodierung

Jede Nachricht ist ein Paket: eine Folge von Bytes, die das Ziel, den Befehl, die Daten und eine Prüfsumme zur Erkennung von Übertragungsfehlern enthält. Erweiterungsbefehle verwenden das Standardpaketformat STS:

```text
Request:  FF FF ID LENGTH INSTRUCTION PARAMETERS... CHECKSUM
Response: FF FF ID LENGTH LEGACY_ERROR EXT_STATUS DATA... CHECKSUM
```

- Anfrage `LENGTH = parameter_bytes + 2`.
- Antwort `LENGTH = data_bytes + 3`; Der Erweiterungsstatus belegt den ersten Antwortparameter, getrennt vom normalen Legacy-Fehlerbyte.
- `CHECKSUM = ~(ID + LENGTH + instruction_or_error + all_parameter_bytes) & 0xFF`. Die Antwortsumme umfasst `EXT_STATUS` und alle Daten.
- Ein Feld, das mehrere Bytes belegt, sendet das niedrigstwertige Byte zuerst (**little-endian**). Beispielsweise wird die Zahl 256 als `00 01` in zwei Bytes gesendet.
- `u8`, `u16` und `u32` sind nichtnegative ganze Zahlen, die 1, 2 und 4 Bytes belegen. `i16` und `i32` belegen 2 und 4 Bytes und können auch negative Zahlen darstellen. Vorzeichenbehaftete Erweiterungswerte verwenden **Zweierkomplement**: Beispielsweise ist −1 `FF FF` in einem `i16`-Feld. Dies unterscheidet sich von der alten Kodierung vorzeichenbehafteter Werte.
- **Q8** bedeutet, dass ein Wert vor der Übertragung mit 256 multipliziert wird, sodass Brüche als ganze Zahlen dargestellt werden können. Teilen Sie beim Lesen durch 256. Beispielsweise wird die Position 1000 als 256000 gesendet, und die Verstärkung 4.5 wird als 1152 gesendet.
- Die Position wird in Encoder-Zählungen angegeben und die Geschwindigkeit wird in counts/s angegeben. Der Host übernimmt die Konvertierung in Gelenkwinkel, einschließlich Richtungs- oder Nullpositionsänderungen.
- **Unicast** bedeutet eine an einen Servo gerichtete Nachricht. **Broadcast** verwendet ID `0xFE` und erreicht alle Servos. Broadcast-Erweiterungsbefehle generieren niemals Antworten.

Beispiel: Den 8-Byte-Funktionsblock von Servo ID 1 lesen:

```text
FF FF 01 04 90 90 08 D2
```

Ein **Selektor** identifiziert einen vollständigen Registerblock, z. B. Konfiguration oder Rückmeldung. Greifen Sie mit der Erweiterung READ/WRITE und der unten aufgeführten genauen Blockgröße darauf zu. Das Lesen oder Schreiben nur eines Teils eines Blocks wird nicht unterstützt und die alten READ/WRITE-Befehle können nicht auf diese Blöcke zugreifen.

<a id="instructions"></a>
### Anweisungen

Die folgenden Parametergrößen schließen den Paket-Header und die Prüfsumme aus. Als Antwort meldet `EXT_STATUS`, ob der Ausfahrbefehl erfolgreich war, getrennt von `LEGACY_ERROR`, dem normalen Fehlerbyte des Servos. Bei einem erfolgreichen Lesevorgang werden die angeforderten Daten nach `EXT_STATUS` hinzugefügt; Schreibvorgänge, andere Befehle und fehlgeschlagene Lesevorgänge enthalten keine zusätzlichen Daten.

| Anleitung | Name | Parameter | Ausstrahlung |
| --- | --- | --- | --- |
| `0x90` | READ | `selector:u8, count:u8` | Keine nützliche Antwort |
| `0x91` | WRITE | `selector:u8, block...` | Nicht akzeptiert |
| `0x99` | GRAVITY | 6 Bytes, unten | Nicht akzeptiert |
| `0x9A` | TARGETS | `session:u16` + 1–6 Einträge von 9 Bytes | Akzeptiert |

Befehlsnummern `0x92`, `0x93`, `0x94`, `0x95`, `0x96`, `0x97` und `0x98` sowie Selektoren `0xA1`, `0xA3`, `0xB0`, `0xBA`, `0xE0` und `0xF0` sind reserviert und dürfen nicht verwendet werden.

| Erweiterungsstatus | Bedeutung |
| --- | --- |
| `0` | OK |
| `1` | Ungültige Länge, ungültiger Selektor oder Feldwert |
| `2` | Befehl kann im aktuellen Zustand nicht angenommen werden |
| `3` | Reserviert |
| `4` | Reserviert |
| `5` | Nicht unterstützte Anweisung |

Eine Sitzungsinkongruenz führt zu einem Statusfehler. Überprüfen Sie sowohl das Legacy-Fehlerbyte als auch den Erweiterungsstatus.

<a id="sessions-and-sequence-numbers"></a>
### Sitzungen und Sequenznummern

Der Host weist jeder Sitzung eine Nummer von 1 bis 65535 zu und nimmt diese in Steuerbefehle auf. Dadurch kann der Servo prüfen, ob ein Befehl zur aktuellen Sitzung gehört. Wählen Sie für jeden Start eine neue Nummer. Setup-Nummern werden nicht dauerhaft gespeichert.

Eine **Sequenznummer** zählt die akzeptierten Befehle der Reihe nach und ermöglicht es dem Host und dem Servo, fehlende, wiederholte oder out-of-order Befehle zu identifizieren.

TARGETS hat einen per-servo Bewegungssequenzzähler. GRAVITY verfügt über einen separaten Zähler. Beide beginnen bei Null, wenn die Drehmomentfreigabe mit der Steuerung beginnt; Normalerweise senden Sie zuerst **1**. Die Zahlen steigen um 65535 und steigen dann auf **0** an, ohne die Sitzung zu beenden. Lücken sind erlaubt: Nach 10 kann das Servo 12 akzeptieren, auch wenn 11 verloren ging oder abgelehnt wurde. Gleiche oder ältere Nummern werden abgewiesen, ohne den aktuellen Befehl zu ändern.

Für einen genauen Vergleich berechnen Sie `distance = (incoming − accepted) & 0xFFFF`. Ein Befehl ist nur neuer, wenn `1 ≤ distance ≤ 32767`. Ein Sprung von genau 32768 ist mehrdeutig und wird abgelehnt. Halten Sie den Abstand zum zuletzt akzeptierten Befehl unten ein 32768; Wenn der Befehlsverlauf unsicher ist, schalten Sie das Drehmoment aus, bereiten Sie eine neue Sitzung vor ID und aktivieren Sie das Drehmoment erneut. Verwenden Sie in der Warteschlange befindliche Pakete aus einer früheren Sitzung oder einem früheren Zählerzyklus nicht wieder.

Für die Akzeptanz sind weiterhin gültige Felder, aktuelle Sensorwerte und eine durchführbare Bewegung erforderlich. Ein abgelehnter Befehl erhöht seinen Zähler nicht. Diese Befehle ersetzen absolute Ziele; Sie sind keine Wegpunktwarteschlange. Um jeden Wegpunkt zu besuchen, warten Sie auf jede Ankunft, bevor Sie das nächste Ziel senden.

Wenn Sie ein Gruppenziel senden, lesen Sie die Rückmeldung jedes Servos, um die akzeptierte Sequenz zu überprüfen. Jedes Servo entscheidet selbstständig, ob es sein Ziel annehmen kann; Einer kann es ablehnen, während die anderen anfangen, sich zu bewegen.

<a id="targets--0x9a"></a>
### TARGETS — `0x9A`

Die ersten beiden Parameterbytes enthalten die gemeinsame Sitzung. Jeder folgende Eintrag hat dieses Layout; Offsets sind relativ zum Anfang dieses Eintrags:

| Versatz | Typ | Feld |
| --- | --- | --- |
| 0 | `u8` | Servo ID, 1–253 |
| 1 | `u16` | Neuerer Bewegungsablauf für dieses Servo |
| 3 | `i32` | Zielposition, Q8 zählt |
| 7 | `u16` | Maximale Geschwindigkeit, counts/s, ungleich Null |

Die Parameterlänge beträgt `2 + 9 × entry_count`, maximal 56 Bytes. IDs müssen eindeutig sein. Jedes Servo prüft das Format und die erforderlichen Felder **aller** Einträge, bevor es seine eigenen Einträge verarbeitet. Ein Servo, das nicht aufgeführt ist, bewirkt nichts. Ein aufgelisteter Servo prüft seine Sitzung, Reihenfolge, Bereitschaft und ob die Bewegung innerhalb seiner Grenzen bleiben kann. Ein akzeptiertes Ziel startet sofort und bleibt aktiv, bis es ersetzt oder entwaffnet wird. Die Werte werden auf die konfigurierten Grenzwerte begrenzt, wie unter S-curve Bewegung beschrieben.

<a id="gravity--0x99"></a>
### GRAVITY — `0x99`

| Versatz | Typ | Feld / Einschränkung |
| --- | --- | --- |
| 0 | `u16` | Aktuelle Sitzung |
| 2 | `u16` | Neuere Schwerkraftsequenz |
| 4 | `i16` | Gewünschte Schwerkraftanstrengung; Betrag ≤ konfigurierte Ausgangsgrenze |

Die Parameterlänge beträgt genau 6 Bytes. Erfordert eine aktivierte Sitzung mit eingeschaltetem Motor, betriebsbereiter Hardware, keinem gemeldeten Fehler und aktuellen Sensormesswerten. Der Bewegungsablauf wird dadurch nicht vorangetrieben. Der angeforderte Wert bleibt aktiv, bis er ersetzt oder deaktiviert wird.

<a id="extension-registers"></a>
## Erweiterungsregister

Ein **Offset** ist das Startbyte eines Feldes, das innerhalb seines Blocks von Null an zählt. Die folgenden Offsets sind dezimal; Selektoren verwenden die hexadezimale Schreibweise (`0x...`). Alle Schreibvorgänge verwenden die Anweisung `0x91`; Beim Lesen wird `0x90` mit der genauen Byteanzahl verwendet.

| Selektor | Blockieren | Zugang | Bytes |
| --- | --- | --- | --- |
| `0x90` | Fähigkeiten | Lesen | 8 |
| `0xA0` | Konfiguration | Read/write | 24 |
| `0xB8` | Controller-Auswahl und Sitzungseinrichtung | Schreiben | 3 |
| `0xC1` | Operatives Feedback | Lesen | 32 |
| `0xC2` | Tuning-Feedback | Lesen | 54 |

<a id="capabilities--0x90"></a>
### Fähigkeiten – `0x90`

| Versatz | Typ | Wert / Bedeutung |
| --- | --- | --- |
| 0–3 | 4 Bytes | ASCII `ARMC` |
| 4 | `u8` | Hauptversion: 9 |
| 5 | `u8` | Nebenversion: 0 |
| 6 | `u8` | Reserviert: 0 |
| 7 | `u8` | Normales Controller-Aktualisierungsintervall: 1 ms |

Die Protokollversion definiert die verfügbaren Blöcke und deren genaue Längen. Auswahl und Sitzungsaufbau teilen sich einen write-only-Block, der unten dokumentiert ist.

<a id="configuration--0xa0"></a>
### Konfiguration – `0xA0`

| Versatz | Typ | Feld | Einheiten/gültiger Bereich |
| --- | --- | --- | --- |
| 0 | `u16` | `kp_q8` | Gewinn × 256; 0–65535 |
| 2 | `u16` | `kd_q8` | Gewinn × 256; 0–65535 |
| 4 | `u16` | `ki_q8` | Gewinn × 256; 0–65535 |
| 6 | `u16` | `integral_limit` | Aufwand; 0–`effort_limit` |
| 8 | `u16` | `effort_limit` | Aufwand; 1–1000 |
| 10 | `u16` | `velocity_limit` | Counts/s; 1–65535 |
| 12 | `u16` | `acceleration_limit` | Counts/s²; 1–30000 |
| 14 | `u8` | `velocity_filter_q8` | Speed-filter Antwort; 1–255, höher reagiert schneller |
| 15 | `u8` | `ramp_time_ms` | Beschleunigungsrampe; 1–255 ms |
| 16 | `u16` | `velocity_ff.positive_gain_q8` | Ausgabe/(count/s) × 256; 0–65535 |
| 18 | `u16` | `velocity_ff.negative_gain_q8` | Ausgabe/(count/s) × 256; 0–65535 |
| 20 | `u16` | `velocity_ff.effort_limit` | Aufwand; 0–Haupt `effort_limit` |
| 22 | `u16` | `gravity_slew` | Vergütungsänderung, Aufwand units/s; 1–10000 |

Verstärkungen werden als gewünschter Wert multipliziert mit 256 gesendet. Ihre Einheiten sind output/count für P, Ausgabe/(count/s) für D und Ausgabe/(Anzahl·s) für I. Beispielsweise erzeugt P = 4.5 4.5 Ausgabeeinheiten pro Fehleranzahl und wird als 1152 gesendet.

Das Servo verfügt über **eine aktive Konfiguration**. Das Schreiben erfordert das Ausschalten des Motors und eine entschärfte Sitzung. Jeder Schreibvorgang ersetzt die gesamte Konfiguration, einschließlich der Feedforward-Einstellungen. Ungültige Einstellungen lehnen den gesamten Schreibvorgang ab, ohne dass sich etwas ändert. Lesen Sie `0xA0`, um die akzeptierten Einstellungen zu überprüfen.

Velocity-feedforward Gewinne sind nicht negativ. Eine Feedforward-Ausgangsgrenze von Null erfordert, dass beide Verstärkungen Null sind. In beiden Richtungen gilt die gleiche Feedforward-Ausgangsgrenze, die die Hauptausgangsgrenze nicht überschreiten darf.

Konfigurieren Sie nach einem Reset den Servo, bevor Sie die Motorleistung aktivieren. Behalten Sie gespeicherte Einstellungen und alternative Tuning-Werte auf dem Host bei; Ändern Sie die Verstärkung zwischen den Läufen mit unterstütztem Arm und ausgeschaltetem Motor.

<a id="selection-and-session-setup--0xb8"></a>
### Auswahl und Sitzungsaufbau – `0xB8`

| Versatz | Typ | Bedeutung |
| --- | --- | --- |
| 0 | `u8` | Modus: `0` Legacy, `1` Erweiterung |
| 1 | `u16` | Sitzung: `0` für Legacy, `1–65535` für Erweiterung |

Die genaue Nutzlastlänge beträgt **3 Bytes**, mit der Sitzung in der Reihenfolge little-endian. Beispielsweise ist der Erweiterungsmodus mit Sitzung `0x1234` `01 34 12`; Der Legacy-Modus ist `00 00 00`. Ungültige Kombinationen lehnen den gesamten Schreibvorgang ab, ohne den Status zu ändern. Beide Modi erfordern das Ausschalten des Motors und ersetzen alle früheren Sitzungseinstellungen. Durch die Auswahl allein wird weder die Steuerung gestartet noch eine Halteposition eingenommen.

Das Legacy-Register torque-enable **40** startet die vorbereitete Erweiterungssitzung, wenn es in `1` geschrieben wird. Es erfordert eine verfügbare Motorleistung, eine gültige Konfiguration, initialisierte Sensoren mit Messwerten, die nicht älter als 2 ms sind, keinen Fehler, der eine Abschaltung erfordert, und verwendbare gespeicherte Legacy-Positionsgrenzwerte. Die gemessene Position muss innerhalb dieser Grenzen liegen, wenn sie aktiviert sind. Diese Prüfungen erfolgen zum Zeitpunkt der Aktivierung, sodass Bewegungen oder Fehler zwischen Einrichtung und Aktivierung berücksichtigt werden.

Torque-off bricht sowohl die laufende Steuerung als auch das ungenutzte Setup ab. Sensorausfälle, Schutzabschaltung, position-limit oder encoder-offset Änderungen, Kalibrierung und das Speichern dauerhafter Einstellungen führen ebenfalls dazu, dass die Sitzungseinrichtung ungültig wird. Lesen Sie das Feedback, um zu prüfen, ob die Kontrolle tatsächlich begonnen hat; Es gibt keinen separaten ARM-Befehl. Der frühere `0xBA`-Selektor und die frühere one-byte-Auswahlnutzlast werden abgelehnt.

<a id="operational-feedback--0xc1"></a>
### Operatives Feedback – `0xC1`

| Versatz | Typ | Feld / Einheiten |
| --- | --- | --- |
| 0 | `u32` | Messzeit, ms seit dem Start; kehrt nach 4294967295 auf Null zurück |
| 4 | `u16` | Messnummer; kehrt nach 65535 auf Null zurück |
| 6 | `u16` | Sitzung |
| 8 | `u16` | Akzeptierte Zielsequenz |
| 10 | `u16` | Akzeptierte Schwerkraftsequenz |
| 12 | `u16` | Flaggen, unten |
| 14 | `i32` | Gemessene Position, Q8 zählt |
| 18 | `i32` | Gefilterte gemessene Geschwindigkeit, Q8 counts/s |
| 22 | `i16` | Angewandte Leistung; positiv folgt steigenden Encoder-Zählungen |
| 24 | `i16` | Current-sensor Messwert relativ zur Grundlinie; nicht Ampere |
| 26 | `u8` | Versorgungsspannung, 0.1 V-Einheiten |
| 27 | `u8` | Validierte Temperatur, °C |
| 28 | `u8` | Legacy-Servo-fault/status-Flags |
| 29 | `u8` | Reserviert: Null |
| 30 | `u16` | Messalter zum Lesezeitpunkt, ms; maximaler gemeldeter Wert 65535 |

| Flag-Bit | Bedeutung, wenn festgelegt |
| --- | --- |
| 0 | Die Probe ist frisch und für den aktuellen Armkontrollzustand verwendbar |
| 1 | Controller aktiv |
| 2 | Reserviert: Null |
| 3 | Motorleistung begrenzt |
| 4 | Armantrieb aktiviert |
| 5 | Sitzung durch Drehmomentfreigabe gestartet |
| 6 | Reserviert: Null |
| 7 | Ausgabe bereit |
| 8 | Ein Schwerkraftbefehl wurde empfangen |
| 9 | Reserviert: Null |
| 10 | Validierte Temperatur verfügbar |
| 11 | Reserviert: Null |
| 12 | Bewegungsziel aktiv |
| 13 | Reserviert: Null |
| 14 | Arm-Controller ausgewählt |
| 15 | Reserviert: Null |

Jedes Flag ist ein Bit: Bit 0 hat den Wert 1, Bit 1 hat den Wert 2, Bit 2 hat den Wert 4 und so weiter. Es können mehrere Flags gleichzeitig gesetzt werden. Ein aktiver Controller mit gelöschtem Bit 12 hält sein Ziel. Ein Clear-Motion-Bit allein bedeutet nicht, dass der Motor mit Strom versorgt oder bereit ist.

Feedback beschreibt eine aufgezeichnete Messung. Wenn sich der Status des Servos ändert, bevor der Host ihn liest, beschreiben einige Felder möglicherweise den früheren Status. Bit 0 wird gelöscht, wenn die Messung älter als 2 ms ist, der Controller nicht mehr ausgewählt, scharfgeschaltet, fahrbereit oder bereit ist oder seine session/sequence Zahlen nicht mehr übereinstimmen. Überprüfen Sie gemeinsam Bit 0, Alter, Sitzung und akzeptierte Sequenz.

Positions- und Gesundheitswerte sind auch im Legacy-Modus und bei ausgeschaltetem Motor verfügbar. Nicht verfügbare Kontrollfelder sind Null. Die Probensequenz schreitet voran, wenn Messungen erfasst werden, nicht jedes Mal, wenn der Host sie liest. Es unterscheidet Samples, die denselben Millisekunden-Zeitstempel haben. Unerwartete große Temperaturänderungen werden über mehrere Messwerte hinweg überprüft, bevor sie hier angezeigt werden. siehe die Schutzbeschränkung unten.

<a id="tuning-feedback--0xc2"></a>
### Tuning-Feedback – `0xC2`

Bytes 0–31 haben genau das Layout `0xC1`. Die restlichen Bytes sind:

| Versatz | Typ | Feld / Einheiten |
| --- | --- | --- |
| 32 | `i32` | Referenzposition, Q8 zählt |
| 36 | `i32` | Referenzgeschwindigkeit, Q8 counts/s |
| 40 | `i16` | Angeforderter Ausgang nach dem konfigurierten Grenzwert, vor dem Motorschutz |
| 42 | `i16` | P Beitrag, Aufwand |
| 44 | `i16` | D Beitrag, Aufwand |
| 46 | `i16` | Integraler Beitrag, Aufwand |
| 48 | `i16` | Derzeit angewendeter Schwerkraftausgleich, Aufwand |
| 50 | `i16` | Lokale Geschwindigkeitsvorsteuerung, Aufwand |
| 52 | `u16` | Kumulierte zusätzliche Controller-Verzögerung, ms; maximal 65535 |

Der Verzögerungszähler fügt die zusätzliche Zeit hinzu, wenn ein Controller-Update länger als die normalen 1 ms (`elapsed_ms − 1`) dauert. Verlorene Nachrichten werden nicht gezählt. Die gemeldeten P- und D-Beiträge sind auf ±32767 begrenzt, sodass die Addition der angezeigten Werte möglicherweise nicht die vollständige interne Berechnung reproduziert.

Das Servo sendet nur dann Rückmeldung, wenn es dazu aufgefordert wird. Verwenden Sie `0xC1` für die normale Überwachung und `0xC2`, wenn für die Optimierung zusätzliche Werte erforderlich sind. Das Lesen von `0xC2` umfasst bereits alles von `0xC1`, sodass das Lesen beider den Verkehr unnötig erhöht. Separate Lesevorgänge können sich auf unterschiedliche Momente beziehen; Vergleichen Sie ihre Zeitstempel und Probennummern.

<a id="build-and-verification"></a>
## Erstellen und Verifizieren

Firmware-Quellen, Tests und Build-Regeln finden Sie in [`firmware/`](firmware/README.md). Führen Sie nach der Installation der [Toolchain](firmware/README.md#build-and-verify)] Folgendes aus:

```sh
make
make verify
```

Die Build-Ausgabe wird ignoriert `build/`. Die Verifizierung erfolgt offline und führt kein Flashen der Hardware durch. Siehe [Projektprüfungen](tools/README.md#offline-checks) für Host-, flashing-tool- und Viewer-Tests. Um eine veröffentlichte Firmware-Version zu installieren, verwenden Sie das [Flash- und Wiederherstellungstool](tools/flash/README.md).

<a id="repository-layout"></a>
## Repository-Layout

| Verzeichnis | Verantwortung |
| --- | --- |
| [`firmware/`](firmware/README.md) | C-Quellen, Header, Hardwaretreiber, Linker-Skript, Build-Regeln und Firmware-Tests |
| [`host/servo-driver/`](host/servo-driver/README.md) | Installierbarer Node.js-Treiber für Legacy-Befehle und die v9-Erweiterung |
| [`tools/teleoperation/`](tools/teleoperation/README.md) | Kontrollieren Sie einen Anhänger von einem hand-operated Anführer aus |
| [`tools/poses/`](tools/poses/README.md) | Nehmen Sie Posen auf und spielen Sie sie mit der Legacy- oder Erweiterungssteuerung ab |
| [`tools/settings/`](tools/settings/README.md) | Motorerkennung, gemeinsame Kalibrierung und Einstellungen backup/restore |
| [`tools/tuning/`](tools/tuning/README.md) | Vergleichen Sie die Controller-Einstellungen stapelweise |
| [`tools/simulation/`](tools/simulation/README.md) | Sehen Sie sich Live-Bewegungen an und spielen Sie aufgezeichnete Telemetriedaten ab |
| [`tools/hw-diff-tests/`](tools/hw-diff-tests/README.md) | Hardware-Vergleichstests für werkseitige und benutzerdefinierte Firmware |
| [`tools/diagnostics/`](tools/diagnostics/README.md) | Buslatenz-Benchmarks und stationäre Telemetrieprüfungen |
| [`tools/flash/`](tools/flash/README.md) | Firmware-Flashing und Wiederherstellung der Einstellungen |

Einzelheiten zur Implementierung finden Sie in den [Erweiterungsbefehlen](../../../firmware/app/arm_extension.c), [Motion Planner](../../../firmware/core/control/arm_motion.c), [Arm Controller](../../../firmware/core/control/arm_control.c) und [Runtime](../../../firmware/app/runtime.c)]“. Hinweise zur Anbieterumverteilung werden in den Kopfzeilen und [Anbieter README](firmware/platform/gd32f130/vendor/README.md)] gespeichert.

<a id="current-limits"></a>
## Aktuelle Grenzwerte

[![Getriebespiel und Rahmenflex](../../../assets/readme/posters/mechanical-limits.jpg)](https://youtu.be/53l7at5aE6k)

[Auf YouTube ansehen](https://youtu.be/53l7at5aE6k) | [MP4](../../../assets/readme/videos/mechanical-limits.mp4)

Die über die Erweiterungsrückmeldung gemeldete Temperatur wird überprüft, um isolierte Sprünge zu unterdrücken, der Temperaturschutz des Motors verwendet jedoch weiterhin die Rohsensorwerte. Dies bedeutet, dass ein kurzzeitiger schlechter Messwert den Schutz beeinträchtigen kann, selbst wenn er aus dem Erweiterungs-Feedback herausgefiltert wird.

Gewinne, Grenzen und Entschädigungen müssen an den tatsächlichen Mechanismus angepasst werden. Softwaretests allein geben keinen Aufschluss darüber, wie sich ein Arm unter Belastung verhält. Überprüfen Sie die gemessene Position, Geschwindigkeit und angelegte Leistung, um Genauigkeit, Einschwingverhalten und ob der Motor seine Leistungsgrenze erreicht, zu beurteilen.
<!-- /translated-content -->
