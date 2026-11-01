<!-- translation-navigation -->
[English](../../../en/tools/flash/README.md) · [Русский](../../../ru/tools/flash/README.md) · [Español](../../../es/tools/flash/README.md) · [Français](README.md) · [Deutsch](../../../de/tools/flash/README.md) · [Português (Brasil)](../../../pt-BR/tools/flash/README.md) · [简体中文](../../../zh-CN/tools/flash/README.md) · [日本語](../../../ja/tools/flash/README.md) · [हिन्दी](../../../hi/tools/flash/README.md) · [العربية](../../../ar/tools/flash/README.md)

[Original anglais](../../../../../tools/flash/README.md)

> Traduction automatique intégrale, pas encore relue par un locuteur natif. Les images et vidéos sont communes ; leur texte reste dans la langue d’origine.
<!-- /translation-navigation -->

<!-- translated-content -->
<a id="flash-firmware"></a>
# Micrologiciel Flash

Flashez un firmware personnalisé ou d'usine sur un servo **GD32F130 STS TTL compatible**. Un téléchargeur gère les deux ; le manifeste de version sélectionne les vérifications d’application.

**Attention : le firmware clignotant peut endommager votre servo, effacer le calibrage ou le rendre inutilisable. Utilisez cet outil à vos propres risques. La récupération n’est pas garantie.**

Utilisez l'image du firmware de l'éditeur et le `release.json` correspondant, conservés dans le même dossier. Les versions brutes du micrologiciel ne sont pas prises en charge. Vérifiez la compatibilité matérielle de la version avant de flasher.

<a id="install"></a>
## Installer

Nécessite **Python 3.10 ou plus récent**. Exécutez à partir de la racine du référentiel :

```sh
python3 -m venv tools/flash/.venv
source tools/flash/.venv/bin/activate
python -m pip install -r tools/flash/requirements.txt
```

Sous Windows, activez plutôt avec `tools\flash\.venv\Scripts\Activate.ps1`.

<a id="choose-firmware"></a>
## Choisissez le micrologiciel

| Micrologiciel | Manifeste |
| --- | --- |
| Extension personnalisée v9 | Téléchargez l'image de l'éditeur et `release.json` ensemble dans `tools/flash/releases/`. |
| Usine **SCServo21-GD32-TTL 3.10**, modèle **9.3** | Regroupé à [`factory/release.json`](../../../../../tools/flash/factory/release.json), à côté de son image. |

L'image d'usine concerne uniquement le matériel correspondant. Utilisez le manifeste sélectionné avec `inspect`, `flash` ou `recover` ; aucune commande ou mode d'usine séparé n'est nécessaire.

<a id="prepare"></a>
## Préparer

- Le flashage normal réinitialise uniquement le moteur sélectionné ID. Les moteurs avec des identifiants uniques peuvent rester connectés ; flashez-les séquentiellement pendant que les autres fonctionnent normalement. Ne power-cycle pas le bus et n'exécutez pas un autre téléchargeur pendant un transfert.
- Pour la **récupération**, connectez uniquement le servo prévu. La récupération ne sélectionne pas de moteur par ID et les transferts du chargeur de démarrage ne sont pas traités.
- Sécurisez le mécanisme, utilisez une puissance moteur stable et fermez d'autres programmes à l'aide du port série.
- Pour un flashage normal, désactivez le couple, verrouillez les écritures des paramètres et effacez toute alarme active à l'aide de votre outil de contrôle habituel. Connaissez le courant ID et le débit en bauds du servo.
- Sauvegardez l’étalonnage et les paramètres importants. Commencez par les paramètres enregistrés sur le servo ; les modifications temporaires peuvent disparaître après le redémarrage.

Remplacez le port et ID par vos valeurs. Le débit en bauds par défaut est **1,000,000** ; ajoutez `--baud 500000`, par exemple, si nécessaire. Les ports typiques sont `/dev/cu.usbmodem…` sur macOS, `/dev/ttyUSB0` sur Linux et `COM3` sur Windows.

```sh
python tools/flash/settings.py backup \
  --port /dev/cu.usbmodemYOUR_ADAPTER --id 2 \
  --file backups/servo-2-settings.json
```

Conservez cette sauvegarde pour ce servo précis. Les fichiers de sauvegarde existants ne sont pas écrasés.

<a id="flash"></a>
## Flash

Vérifiez et flashez une version personnalisée téléchargée :

```sh
python tools/flash/flash.py inspect \
  --manifest tools/flash/releases/release.json

python tools/flash/flash.py flash \
  --manifest tools/flash/releases/release.json \
  --port /dev/cu.usbmodemYOUR_ADAPTER --id 2
```

Pour installer le micrologiciel d'usine fourni, sélectionnez plutôt son manifeste. Isolez le servo pour cette opération : le démarrage d'usine peut changer son ID en 1, en conflit avec un autre moteur sur le bus.

```sh
python tools/flash/flash.py flash \
  --manifest tools/flash/factory/release.json \
  --port /dev/cu.usbmodemYOUR_ADAPTER --id 2
```

`inspect` vérifie la taille du fichier, la somme de contrôle et le manifeste sans se connecter à un servo. Tapez `FLASH` lorsque vous y êtes invité. Maintenez l'alimentation connectée jusqu'à la fin de la commande. L'outil vérifie le servo, enregistre l'instantané de ses paramètres, télécharge le firmware, puis vérifie l'application et compare les paramètres. Une vérification réussie laisse le couple désactivé.

Après un flash d'usine, l'outil vérifie le ID/baud précédent, puis le ID **1** à **1,000,000** bauds si nécessaire, et imprime la connexion fonctionnelle. Le code de sortie **2** signifie que le micrologiciel d'usine a répondu mais que les paramètres ont été modifiés. Continuez avec la réparation des paramètres ci-dessous plutôt que de flasher à nouveau.

<a id="recover-an-unresponsive-servo"></a>
## Récupérer un servo qui ne répond pas

Vérifiez d'abord l'alimentation, le câblage, ID et le débit en bauds. Si une récupération est nécessaire, connectez **uniquement le servo prévu** et utilisez le manifeste sélectionné. Par exemple, pour restaurer avec le firmware d'usine :

```sh
python tools/flash/flash.py recover \
  --manifest tools/flash/factory/release.json \
  --port /dev/cu.usbmodemYOUR_ADAPTER --id 1
```

Après confirmation, **power-cycle le servo lorsque vous y êtes invité**, en laissant l'adaptateur USB connecté. L'outil attend jusqu'à 60 secondes le chargeur de démarrage.

Utilisez le ID et le débit en bauds attendus après la récupération. La récupération ne peut pas vérifier le modèle actuel ni sauvegarder les paramètres avant le téléchargement, alors confirmez vous-même la compatibilité matérielle. Vérifiez les limites d’étalonnage et de position avant d’activer le couple par la suite.

<a id="restore-factory-settings"></a>
## Restaurer les paramètres d'usine

Après être revenu au firmware d'usine, restaurez la sauvegarde de ce servo même si les paramètres semblent initialement corrects. Le micrologiciel d'usine peut utiliser les valeurs par défaut built-in lorsque ses paramètres enregistrés ne sont pas valides ; les écritures de registre ordinaires peuvent ne pas résoudre ce problème.

Utilisez le **actuel** ID/baud imprimé après le flashage. Par exemple, s'il répond maintenant par ID 1 :

```sh
python tools/flash/settings.py restore \
  --port /dev/cu.usbmodemYOUR_ADAPTER --id 1 \
  --file backups/servo-2-settings.json
```

Tapez `RESTORE` pour confirmer. Cela prend en charge l'usine **3.10** et refuse le micrologiciel personnalisé détecté. Il restaure les paramètres, **remplace le modèle de réinitialisation enregistré**, répare les paramètres enregistrés, verrouille les écritures et redémarre le servo. Il suit toutes les modifications ID/baud et vérifie la relecture sans envoyer de commandes de mouvement.

Puis **power-cycle le servo** et vérifiez à l'aide du **restauré** ID/baud :

```sh
python tools/flash/settings.py verify \
  --port /dev/cu.usbmodemYOUR_ADAPTER --id 2 \
  --file backups/servo-2-settings.json
```

Maintenez le couple coupé jusqu'à ce que la vérification soit réussie. Vous pouvez également fournir un flash normal `report.json` contenant un instantané before-flash comme `--file`. Les sauvegardes effectuées après la perte des paramètres ne peuvent pas récupérer le calibrage d'origine. Sans sauvegarde valide, obtenez les paramètres du modèle exact et recalibrez ce servo.

En cas d'échec, la réparation tente de reverrouiller les paramètres mais n'annule pas les écritures partielles ni ne réessaye automatiquement la réparation. Conservez le rapport avant d’enquêter.

<a id="results-and-options"></a>
## Résultats et options

Les rapports Flash sont enregistrés sous `backups/flash/` ; rapports de paramètres sous `backups/settings/`. Les deux incluent des instantanés de paramètres disponibles. Un téléchargement réussi inclut des vérifications d’application ; il ne relit pas l'image complète du micrologiciel. Les paramètres ne sont pas automatiquement restaurés.

- `--output DIRECTORY` : choisissez l'emplacement où les rapports sont enregistrés.
- `--yes` : ignorez l'invite de confirmation ; tous les contrôles sont toujours en cours.
- `--help` : afficher les options de commande.

Si la validation du fichier échoue, obtenez une paire de versions correspondante. Si le flashage est interrompu, le servo peut avoir besoin d'être récupéré. Si le transfert se termine mais que la vérification échoue, inspectez le rapport et vérifiez ID, le débit en bauds et les paramètres avant de réessayer.

Pour les auteurs de versions, [release.example.json](../../../../../tools/flash/release.example.json) affiche un manifeste personnalisé et [factory/release.json](../../../../../tools/flash/factory/release.json) un manifeste d'usine. L'exemple personnalisé n'est pas une version de micrologiciel utilisable.

<a id="acknowledgments"></a>
## Remerciements

Les outils de flashage et de récupération ont été inspirés par [0o8o0-blip/sts3215-firmware](https://github.com/0o8o0-blip/sts3215-firmware/).
<!-- /translated-content -->
