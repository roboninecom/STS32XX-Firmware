<!-- translation-navigation -->
[English](../../../en/host/servo-driver/README.md) · [Русский](../../../ru/host/servo-driver/README.md) · [Español](../../../es/host/servo-driver/README.md) · [Français](README.md) · [Deutsch](../../../de/host/servo-driver/README.md) · [Português (Brasil)](../../../pt-BR/host/servo-driver/README.md) · [简体中文](../../../zh-CN/host/servo-driver/README.md) · [日本語](../../../ja/host/servo-driver/README.md) · [हिन्दी](../../../hi/host/servo-driver/README.md) · [العربية](../../../ar/host/servo-driver/README.md)

[Original anglais](../../../../../host/servo-driver/README.md)

> Traduction automatique intégrale, pas encore relue par un locuteur natif. Les images et vidéos sont communes ; leur texte reste dans la langue d’origine.
<!-- /translation-navigation -->

<!-- translated-content -->
<a id="sts32xx-servo-driver"></a>
# STS32XX servomoteur

Pilote Node.js pour les servos série STS et le firmware STS32XX **extension de mouvement v9**. Il fournit la découverte, l'accès aux registres, les opérations de paramétrage, les commandes de mouvement S-curve, la compensation de gravité et le retour via une seule connexion série. Nécessite **Node.js 20 ou plus récent** et un adaptateur série compatible.

Les opérations héritées utilisent la table de contrôle STS incluse dans ce package. Les opérations d'extension nécessitent un micrologiciel personnalisé v9 ; le firmware d'usine ne les fournit pas. Le package est destiné à Node.js, pas au navigateur Web Serial.

<a id="install"></a>
## Installer

Depuis ce référentiel :

```sh
npm ci
npm run test:driver
npm pack --workspace sts32xx-servo-driver --pack-destination /tmp
```

Dans un autre projet Node.js, installez l'archive produite par la dernière commande :

```sh
npm install /tmp/sts32xx-servo-driver-0.1.0.tgz
```

Cela fonctionne sans publication dans un registre npm. L'archive contient la bibliothèque, les exemples, README et la licence. Les dépendances en série s'installent via npm ; le micrologiciel, les journaux et les résultats des tests ne sont pas inclus.

CommonJS :

```js
const { StsServo } = require('sts32xx-servo-driver');
```

ES modules :

```js
import driver from 'sts32xx-servo-driver';
const { StsServo } = driver;
```

Les outils de référentiel existants peuvent continuer à importer `host/servo-driver` directement. Utilisez l'exportation principale du package ; les chemins de fichiers internes ne font pas partie de son public API.

<a id="connect-and-read"></a>
## Connectez-vous et lisez

```js
const { StsServo } = require('sts32xx-servo-driver');

const servo = new StsServo({
  serial: { path: '/dev/cu.usbmodemYOUR_ADAPTER', baudRate: 1000000 },
});

async function main() {
  try {
    const found = await servo.connect();
    for (const id of found.ids) {
      const values = await servo.bus.read(id,
        ['presentPosition', 'presentVoltage', 'servoStatus']);
      console.log(id, values, found.alarms.get(id) ?? []);
    }
  } finally {
    await servo.close();
  }
}
main().catch(console.error);
```

Utilisez `/dev/ttyUSB0`, `COM3` ou le port réel de votre adaptateur, selon le cas. La découverte trouve les identifiants répondants au débit sélectionné ; il ne modifie pas les paramètres du moteur et ne scanne pas d'autres débits en bauds. Les identifiants doivent être uniques. Les attentes tiennent compte du ID le plus élevé possible et du baud sélectionné. `connect()` ouvre le port et découvre les moteurs ; `open()` ouvre uniquement le port. Les méthodes de bus et d’extension nécessitent des ID découverts.

Les valeurs du registre utilisent des unités brutes. Par exemple, `presentVoltage: 120` signifie 12 V. `ControlTable` décrit les adresses, les encodages, les plages et les échelles d'affichage. Les champs Multi-byte utilisent l'encodage little-endian ; les valeurs héritées signées utilisent des bits de signe.

<a id="main-api"></a>
## Principal API

Toutes les opérations qui communiquent avec les promesses de retour du matériel.

| API | Objectif |
| --- | --- |
| `servo.connect()` / `servo.close()` | Open/discover ou fermez la connexion série. |
| `servo.bus.discover()` | Actualisez la liste des identifiants connus. |
| `servo.bus.scan()` | Découvrez sans remplacer la liste known-ID. |
| `servo.bus.verify(ids)` | Pingez les moteurs connus individuellement. |
| `servo.bus.read(id, keys, options)` | Lire les registres nommés ; renvoie un objet saisi par nom de registre. |
| `servo.bus.write(id, values, options)` | Écrivez un objet de registres nommés. |
| `servo.bus.readMany(ids, keys, options)` | Lisez plusieurs moteurs à l'aide de requêtes de groupe. |
| `servo.bus.syncWrite(entries, options)` | Écrivez des entrées en forme de `{ id, values }` dans un groupe. |
| `servo.bus.device(id)` | Obtenez un objet pratique avec les méthodes `read`, `write` et reset/calibration. |
| `servo.settings.read(id)` | Lisez les paramètres hérités persistants. |
| `servo.settings.save(id, values)` | Déverrouillez, enregistrez, vérifiez et reverrouillez les paramètres ordinaires. |
| `servo.arm` | Accédez aux méthodes v9 ci-dessous. |

Les enregistrements des paramètres utilisent un délai d'expiration de la demande de 250 ms. Après un accusé de réception d'écriture perdu, le pilote attend la persistance et relit le registre avant de réessayer. Already-applied les écritures ne sont pas répétées. Les échecs de communication temporaires nécessitent jusqu'à trois tentatives ; les pannes persistantes signalent toujours une erreur et tentent de reverrouiller le moteur. Passez `{ timeoutMs }` à `settings.save` pour remplacer le délai d'attente.

Exemple existant, pour un moteur sécurisé en mode position destiné à se déplacer :

```js
await servo.bus.write(id, { targetPosition: 2048 },
  { timeoutMs: 100, rejectOnAlarm: true });
```

Une écriture d'objectif héritée peut activer automatiquement le couple, en fonction des paramètres enregistrés. Les écritures persistantes peuvent modifier l'étalonnage, les limites ou les gains. Désactivez le couple avant de modifier les paramètres. Les paramètres API protègent ID, bauds et response-level changent ; utilisez les [paramètres CLI](../../tools/settings/README.md) dans le référentiel pour un backup/restore complet. La réinitialisation d'usine, reset-template et les commandes d'étalonnage sont exposées via `servo.protocol` ; appelez-les uniquement lorsque ces changements sont prévus.

<a id="v9-control-lifecycle"></a>
## Cycle de vie du contrôle v9

1. Commencez avec le couple coupé. Capacités de lecture et configuration.
2. Appliquez une configuration validée avec `arm.configure()` lorsque le couple est désactivé.
3. Sélectionnez le mode d'extension avec une nouvelle session non nulle ID.
4. Activez le couple à l'aide du registre existant 40, puis lisez les commentaires jusqu'à ce que la session soit armée, fraîche, drive-enabled et output-ready.
5. Envoyez des cibles et des mises à jour de gravité. Vérifiez leurs numéros de séquence acceptés dans de nouveaux commentaires.
6. Écrivez `torqueEnable: 0` lorsque l'application a l'intention de libérer le moteur.

```js
const options = { timeoutMs: 100, rejectOnAlarm: true };
const caps = await servo.arm.capabilities(id, options);
if (caps?.major !== 9) throw new Error('Extension v9 is required');

// config must contain values validated for this motor and mechanism.
await servo.arm.configure(id, config, options);
await servo.arm.select(id, true, session, options);
await servo.bus.write(id, { torqueEnable: 1 }, options);
// Check readiness using servo.arm.feedback() before sending motion.

await servo.arm.setTargets([
  { id, target: { sequence: 1, positionQ8: 2048 * 256, speedLimit: 100 } },
], session, options);

await servo.arm.updateGravity(id,
  { session, sequence: 1, gravityEffort: -20 }, options);
```

Cet extrait montre les appels ; l'[exemple de mouvement complet ](../../../../../host/servo-driver/examples/v9-move.js) comprend la validation, l'interrogation de préparation, les contrôles d'acceptation et le nettoyage torque-off. Si les accusés de réception d'écriture sont désactivés, les écritures héritées nécessitent `expectResponse: false` et une vérification par relecture. L'exemple complet gère cela automatiquement.

Le micrologiciel conserve la dernière cible et conserve le dernier effort de gravité jusqu'à ce qu'il soit remplacé ou que le couple soit désactivé. Il n’y a pas de battement de cœur, de délai d’attente de commande ou d’expiration de gravité. **La fermeture de la connexion série n'arrête ni ne libère un moteur.** Choisissez le nettoyage de l'application en fonction du mécanisme ; relâcher un bras chargé peut le faire tomber. La protection des capteurs et du moteur reste active dans le firmware.

L'activation du couple capture la position mesurée. Ne démarrez pas une session d’extension avec des écritures d’objectifs hérités. Une coupure de couple ou un défaut met fin à la séance ; préparez une nouvelle session avant de redémarrer. Pour sélectionner le mode hérité avec couple désactivé, utilisez `arm.select(id, false, 0)`.

<a id="extension-methods"></a>
### Méthodes d'extension

| Méthode | Résultat ou effet |
| --- | --- |
| `capabilities(id, options)` | `{ major, minor, tickMs }` pour une signature reconnue ; un micrologiciel non pris en charge peut rejeter la demande ou expirer. |
| `configuration(id, options)` | Lisez la configuration RAM actuelle. |
| `configure(id, config, options)` | Écrivez la configuration et vérifiez les octets codés par relecture. |
| `select(id, enabled, session, options)` | Préparez le contrôle v9 ou sélectionnez le mode hérité avec `false, 0`. |
| `setTargets(entries, session, options)` | Envoyez une diffusion contenant un à six moteurs uniques. |
| `updateGravity(id, command, options)` | Envoyez un effort de gravité signé avec son propre numéro de séquence. |
| `feedback(id, options)` | Lisez un échantillon opérationnel cohérent. |
| `tuning(id, options)` | Lisez les commentaires opérationnels ainsi que les mouvements de référence et les termes d’effort individuel. |
| `invalidate(id)` | Effacer les capacités mises en cache après un cycle d'alimentation externe ou une modification du micrologiciel ; omettez ID pour tout effacer. |

Le pilote invalide automatiquement les capacités lors de la découverte, des modifications ID, des modifications de connexion et des réinitialisations émises via son protocole API.

<a id="configuration-and-units"></a>
### Configuration et unités

Chaque champ de configuration est explicite. Cet objet illustre le format, et non un profil de réglage recommandé :

```js
const config = {
  kpQ8: 256, kdQ8: 0, kiQ8: 0,
  integralLimit: 0, effortLimit: 100,
  velocityLimit: 100, accelerationLimit: 500,
  velocityFilterQ8: 64, rampTimeMs: 30,
  velocityFeedforward: {
    positiveGainQ8: 0, negativeGainQ8: 0, effortLimit: 0,
  },
  gravitySlewEffortPerS: 1000,
};
```

| Champs | Unités et limites |
| --- | --- |
| `kpQ8`, `kdQ8`, `kiQ8` | Gains multipliés par 256 ; entiers 0–65535. |
| `effortLimit`, `integralLimit` | PWM unités d'effort ; limite globale 1–1000, limite intégrale 0–limite globale. |
| `velocityLimit`, cible `speedLimit` | Encodeur counts/s ; 1–65535. |
| `accelerationLimit` | Counts/s² ; 1–30000, partagé par l'accélération et le freinage. |
| `rampTimeMs` | S-curve temps de rampe d'accélération ; 1–255 mme. |
| `velocityFilterQ8` | Coefficient de filtre multiplié par 256 ; 1–255. |
| Gains de vitesse | Direction-specific gains multipliés par 256 ; 0–65535. Son plafond d’effort ne peut excéder le plafond global. Réglez les gains et le plafond à zéro pour le désactiver. |
| `gravitySlewEffortPerS` | Changement d’effort gravitationnel par seconde ; 1–10000. |
| Cible `positionQ8` | Position de l'encodeur multipliée par 256 ; −32767×256 à 32767×256. |
| `gravityEffort` | Signé PWM effort ; −1000 à 1000. Le micrologiciel applique ses limites d'effort. |

Les limites de déplacement proviennent des limites de position héritées enregistrées. Le micrologiciel limite les cibles aux limites actives. La configuration est l'état RAM, et non un profil de réglage persistant. L'anticipation de vitesse locale suit la référence de mouvement du micrologiciel ; l'application fournit une compensation de gravité séparément.

Les ID de cible d'extension sont 1–253. Une séance vaut 1–65535. Chaque moteur suit les séquences de cible et de gravité séparément. Incrémentez la séquence correspondante pour chaque nouvelle commande, en enroulant 65535 à 0 ; les écarts vers l'avant jusqu'à 32767 sont acceptés. Commencez une nouvelle session avec la séquence 1. L'achèvement de la diffusion signifie que le paquet a été envoyé, et non que tous les moteurs l'ont accepté. Vérifiez `acceptedSequence`, `gravitySequence` et `session` dans les commentaires ultérieurs.

<a id="feedback-and-errors"></a>
### Commentaires et erreurs

`feedback()` inclut position/velocity mesuré en unités Q8, l'effort appliqué, le delta de courant ADC, la tension brute, la température validée, les défauts, la session et les séquences acceptées. Utilisez `fresh`, `ageMs`, `sampleSequence`, `armed`, `driveEnabled` et `outputReady` pour juger si un échantillon est utilisable. La température n'est utilisable que lorsque `temperatureValid` est vrai. `running: false` signifie que le planificateur ne bouge plus ; cela ne garantit pas l’erreur de position zéro.

`tuning()` ajoute la référence position/velocity, l'effort demandé, les termes P/D/I, l'effort de gravité, la anticipation de vitesse et le nombre de dépassements.

Les options de lecture et d'écriture incluent `timeoutMs` et `rejectOnAlarm`. Les alarmes héritées ne rejettent pas par défaut les réponses autrement valides ; passez `rejectOnAlarm: true` lorsqu'une alarme doit interrompre une opération. Les erreurs typées incluent `RequestTimeoutError`, `MissingResponseError`, `ServoStatusError`, `SettingsVerificationError` et `InvalidPacketError`. Un contexte supplémentaire est dans `error.details` ; les rejets d'extension y incluent `extensionStatus`.

Le planificateur sérialise les demandes et prend en charge les priorités et les transactions exclusives. Attendez les commandes et utilisez des cibles de groupe pour un mouvement coordonné. Le délai d'attente de réponse commence après l'épuisement de l'écriture série ; les opérations de transport ont leurs propres délais. Ces délais d'attente ne modifient pas le comportement du moteur. Les paquets hérités n'ont pas de numéro de séquence, de sorte qu'une réponse inhabituellement tardive ne peut pas toujours être distinguée d'une demande ultérieure ayant la même forme de réponse.

Les exportations Low-level incluent `SerialTransport`, `StsProtocol`, `RequestScheduler`, `PacketEncoder`, `PacketDecoder`, `RegisterCodec`, `RegisterLayout`, `ArmCodec`, les constantes et les erreurs. Ils restent séparés du bus high-level API.

<a id="runnable-examples"></a>
## Exemples exécutables

Depuis ce répertoire, ou en utilisant les fichiers d'exemple inclus dans le package installé :

```sh
node examples/discover.js /dev/cu.usbmodemYOUR_ADAPTER
node examples/v9-feedback.js /dev/cu.usbmodemYOUR_ADAPTER 2
node examples/v9-move.js /dev/cu.usbmodemYOUR_ADAPTER 2 2048 100 /path/to/config.json
```

Les deux premiers exemples ne font que lire. L'exemple de mouvement nécessite une configuration JSON avec les champs ci-dessus et utilise 1 Mbaud. Faites-le fonctionner sur un moteur sécurisé et déchargé avec une course libre. Il désactive le couple après le déplacement, une erreur ou un Ctrl+C gracieux. Il attend jusqu'à 3 secondes pour le démarrage et 30 secondes pour le déplacement. Argument final facultatif : effort de gravité signé, zéro par défaut. Ne l'utilisez pas pour supporter une charge sur les bras.

<a id="tests-and-license"></a>
## Tests et licence

Depuis la racine du référentiel :

```sh
npm run test:driver
npm run test:driver-package
npm test
```

Les tests utilisent de faux transports et n'ouvrent pas de ports série. La vérification du package installe l'archive réelle dans un projet temporaire, en utilisant les dépendances mises en cache de npm à partir de `npm ci`, et vérifie les importations CommonJS/ESM et les exemples de points d'entrée. Il ne publie pas le package. L'installation de production peut nécessiter des outils de construction natifs si une liaison serial-port n'est pas disponible pour le système d'exploitation et CPU.

[MIT](../../../../../host/servo-driver/LICENSE), copyright 2026 STS32XX-Firmware contributeurs. Cette licence couvre ce répertoire de pilotes, y compris des exemples et des tests. Il n'accorde pas de licence au micrologiciel ou au code du fournisseur ailleurs dans le référentiel. Les dépendances conservent leurs propres licences.
<!-- /translated-content -->
