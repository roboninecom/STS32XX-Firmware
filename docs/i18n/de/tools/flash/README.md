<!-- translation-navigation -->
[English](../../../en/tools/flash/README.md) · [Русский](../../../ru/tools/flash/README.md) · [Español](../../../es/tools/flash/README.md) · [Français](../../../fr/tools/flash/README.md) · [Deutsch](README.md) · [Português (Brasil)](../../../pt-BR/tools/flash/README.md) · [简体中文](../../../zh-CN/tools/flash/README.md) · [日本語](../../../ja/tools/flash/README.md) · [हिन्दी](../../../hi/tools/flash/README.md) · [العربية](../../../ar/tools/flash/README.md)

[Englisches Original](../../../../../tools/flash/README.md)

> Vollständige maschinelle Übersetzung, noch nicht von Muttersprachlern geprüft. Bilder und Videos werden gemeinsam verwendet; enthaltene Texte bleiben in der Originalsprache.
<!-- /translation-navigation -->

<!-- translated-content -->
<a id="flash-firmware"></a>
# Flash Firmware

Flash benutzerdefinierte oder Fabrik-Firmware auf einem kompatiblen **GD32F130 STS TTL Servo**. Ein Uploader behandelt beide; das Release Manifest wählt die Anwendungsprüfungen.

**Warnung: Blitz-Firmware kann Ihr Servo beschädigen, die Kalibrierung löschen oder unbrauchbar lassen. Verwenden Sie dieses Tool auf eigenes Risiko. Wiederherstellung ist nicht garantiert.**

Verwenden Sie das Firmware-Image des Herausgebers und das passende `release.json`, das im gleichen Ordner aufbewahrt wird. Rohe Firmware-Builds werden nicht unterstützt. Überprüfen Sie die Hardware-Kompatibilität des Releases vor dem Flashen.

<a id="install"></a>
## Installation

Erfordert **Python 3.10 oder neuer**. Führen Sie aus dem Repository Root:

```sh
python3 -m venv tools/flash/.venv
source tools/flash/.venv/bin/activate
python -m pip install -r tools/flash/requirements.txt
```

Aktivieren Sie stattdessen unter Windows mit `tools\flash\.venv\Scripts\Activate.ps1`.

<a id="choose-firmware"></a>
## Firmware auswählen

| Firmware | Manifest |
| --- | --- |
| Benutzerdefinierte Erweiterung v9 | Laden Sie das Bild des Verlegers und `release.json` zusammen in `tools/flash/releases/`. |
| Fabrik **SCServo21-GD32-TTL 3.10**, Modell **9.3** | Gebündelt mit [`factory/release.json`](../../../../../tools/flash/factory/release.json), neben seinem Bild. |

Das Werksbild ist nur für passende Hardware. Verwenden Sie das ausgewählte Manifest mit `inspect`, `flash` oder `recover`; es wird kein separater Werksbefehl oder -modus benötigt.

<a id="prepare"></a>
## Bereiten

- Normales Flashen setzt nur den ausgewählten Motor ID zurück. Motoren mit eindeutigen IDs können angeschlossen bleiben; flashen sie sequentiell, während die anderen normal laufen. power-cycle nicht den Bus oder einen anderen Uploader während einer Übertragung ausführen.
- Schließen Sie für **recovery** nur das vorgesehene Servo an. Recovery wählt keinen Motor von ID, und Bootloader-Transfers werden nicht angesprochen.
- Sichern Sie den Mechanismus, verwenden Sie stabile Motorleistung und schließen Sie andere Programme mit der seriellen Schnittstelle.
- Zum normalen Flashen, Deaktivieren des Drehmoments, Sperreinstellungen schreiben und löschen Sie jeden aktiven Alarm mit Ihrem üblichen Steuergerät. Kennen Sie die aktuelle ID und Baudrate des Servos.
- Sichern Sie wichtige Kalibrierung und Einstellungen. Beginnen Sie mit den Einstellungen, die auf dem Servo gespeichert werden; temporäre Änderungen können nach dem Neustart verschwinden.

Ersetzen Sie den Port und ID durch Ihre Werte. Die Standard-Baudrate ist **1,000,000**; fügen Sie z.B. `--baud 500000` hinzu. Typische Ports sind `/dev/cu.usbmodem…` auf macOS, `/dev/ttyUSB0` auf Linux und `COM3` auf Windows.

```sh
python tools/flash/settings.py backup \
  --port /dev/cu.usbmodemYOUR_ADAPTER --id 2 \
  --file backups/servo-2-settings.json
```

Halten Sie dieses Backup für dieses exakte Servo. Bestehende Backup-Dateien werden nicht überschrieben.

<a id="flash"></a>
## Blitzlicht

Überprüfen und flashen Sie eine heruntergeladene benutzerdefinierte Veröffentlichung:

```sh
python tools/flash/flash.py inspect \
  --manifest tools/flash/releases/release.json

python tools/flash/flash.py flash \
  --manifest tools/flash/releases/release.json \
  --port /dev/cu.usbmodemYOUR_ADAPTER --id 2
```

Um die gebündelte Fabrik-Firmware zu installieren, wählen Sie stattdessen das Manifest aus. Isolieren Sie das Servo für diese Operation: Das Werksstartup kann seine ID in 1 ändern, im Gegensatz zu einem anderen Motor im Bus.

```sh
python tools/flash/flash.py flash \
  --manifest tools/flash/factory/release.json \
  --port /dev/cu.usbmodemYOUR_ADAPTER --id 2
```

`inspect` überprüft die Dateigröße, die Checksumme und das Manifest ohne Verbindung zu einem Servo. Typ `FLASH` bei Aufforderung. Halten Sie die Energie verbunden, bis der Befehl beendet. Das Werkzeug überprüft das Servo, speichert seine Einstellungen Snapshot, lädt die Firmware, dann überprüft die Anwendung und vergleicht Einstellungen. Erfolgreiche Überprüfung lässt Drehmoment deaktiviert.

Nach einem Werksblitz überprüft das Werkzeug den vorherigen ID/baud, dann ID **1** bei **1,000,000** Baud, und druckt die Arbeitsverbindung. Exit-Code **2** bedeutet Fabrik-Firmware reagiert, aber Einstellungen geändert. Fahren Sie mit Einstellungen Reparatur unten anstatt wieder flashen.

<a id="recover-an-unresponsive-servo"></a>
## Recover ein nicht responsives Servo

Erste Kontrolle von Strom, Verdrahtung, ID und Baudrate. Wenn die Wiederherstellung erforderlich ist, verbinden Sie **nur das beabsichtigte Servo** und verwenden Sie das ausgewählte Manifest. Zum Beispiel, um mit der Fabrikfirmware wiederherzustellen:

```sh
python tools/flash/flash.py recover \
  --manifest tools/flash/factory/release.json \
  --port /dev/cu.usbmodemYOUR_ADAPTER --id 1
```

Nach Bestätigung, **power-cycle das Servo bei Aufforderung**, so dass der USB Adapter angeschlossen. Das Tool wartet bis zu 60 Sekunden für den Bootloader.

Verwenden Sie die ID und Baudrate nach der Wiederherstellung erwartet. Wiederherstellung kann nicht überprüfen, das aktuelle Modell oder sichern Sie Einstellungen vor dem Hochladen, so bestätigen Sie die Hardware-Kompatibilität selbst.

<a id="restore-factory-settings"></a>
## Werkseinstellungen wiederherstellen

Nach der Rückkehr zur Fabrik-Firmware wiederherstellen Sie das Backup dieses Servos, auch wenn die Einstellungen zunächst korrekt aussehen. Fabrik-Firmware kann built-in Standardeinstellungen verwenden, wenn seine gespeicherten Einstellungen ungültig sind; gewöhnliche Register schreibt möglicherweise nicht beheben.

Verwenden Sie den **current** ID/baud gedruckt nach dem Flashen. Wenn es zum Beispiel jetzt als ID 1 antwortet:

```sh
python tools/flash/settings.py restore \
  --port /dev/cu.usbmodemYOUR_ADAPTER --id 1 \
  --file backups/servo-2-settings.json
```

Typ `RESTORE` zu bestätigen. Dies unterstützt Fabrik **3.10** und verweigert erkannte kundenspezifische Firmware. Es stellt Einstellungen wieder her, **ersetzt die gespeicherte Reset-Vorlage**, repariert die gespeicherten Einstellungen, sperrt das Servo ab und startet es neu. Es folgt jeglichen Änderungen von ID/baud und überprüft die Rücklese, ohne Bewegungsbefehle zu senden.

Dann **power-cycle das Servo** und überprüfen Sie mit dem **wiederhergestellt** ID/baud:

```sh
python tools/flash/settings.py verify \
  --port /dev/cu.usbmodemYOUR_ADAPTER --id 2 \
  --file backups/servo-2-settings.json
```

Halten Sie das Drehmoment ab, bis die Überprüfung vorüber ist. Sie können auch einen normalen Blitz `report.json` mit einem before-flash Snapshot als `--file` liefern. Backups, die nach dem Verlust der Einstellungen getätigt wurden, können die ursprüngliche Kalibrierung nicht wiederherstellen.

Bei Ausfall, Reparatur versucht, Einstellungen zu relock, aber nicht rückgängig machen Teil schreibt oder erneut versuchen die Reparatur automatisch. Behalten Sie den Bericht vor der Untersuchung.

<a id="results-and-options"></a>
## Ergebnisse und Optionen

Flash-Reports werden unter `backups/flash/` gespeichert; Einstellungen unter `backups/settings/`. Beide enthalten verfügbare Einstellungen Snapshots. Ein erfolgreicher Upload beinhaltet Anwendungschecks; er liest das vollständige Firmware-Image nicht zurück. Einstellungen werden nicht automatisch wiederhergestellt.

- `--output DIRECTORY`: Wählen Sie, wo Berichte gespeichert werden.
- `--yes`: Überspringen Sie die Bestätigungsaufforderung; alle Überprüfungen laufen noch.
- `--help`: Befehlsoptionen anzeigen.

Wenn die Datei-Validierung fehlschlägt, erhalten Sie ein passendes Release-Paar. Wenn das Flashen unterbrochen wird, muss das Servo möglicherweise wiederhergestellt werden. Wenn die Übertragung beendet, aber die Überprüfung fehlschlägt, überprüfen Sie den Bericht und überprüfen Sie ID, Baudrate und Einstellungen vor dem erneuten Testen.

Für Release-Autoren zeigt [release.example.json](../../../../../tools/flash/release.example.json) ein benutzerdefiniertes Manifest und [factory/release.json](../../../../../tools/flash/factory/release.json) ein Manifest. Das benutzerdefinierte Beispiel ist kein nutzbares Firmware-Release.

<a id="acknowledgments"></a>
## Danksagungen

Die Flashing- und Recovery-Tools wurden von [0o8o0-blip/sts3215-firmware](https://github.com/0o8o0-blip/sts3215-firmware/).
<!-- /translated-content -->
