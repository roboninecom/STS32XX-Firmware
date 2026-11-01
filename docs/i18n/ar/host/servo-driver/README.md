<!-- translation-navigation -->
[English](../../../en/host/servo-driver/README.md) · [Русский](../../../ru/host/servo-driver/README.md) · [Español](../../../es/host/servo-driver/README.md) · [Français](../../../fr/host/servo-driver/README.md) · [Deutsch](../../../de/host/servo-driver/README.md) · [Português (Brasil)](../../../pt-BR/host/servo-driver/README.md) · [简体中文](../../../zh-CN/host/servo-driver/README.md) · [日本語](../../../ja/host/servo-driver/README.md) · [हिन्दी](../../../hi/host/servo-driver/README.md) · [العربية](README.md)

[الأصل الإنجليزي](../../../../../host/servo-driver/README.md)

> ترجمة آلية كاملة لم يراجعها متحدث أصلي بعد. الصور ومقاطع الفيديو مشتركة بين اللغات، وتبقى النصوص داخلها بلغتها الأصلية.
<!-- /translation-navigation -->

<!-- translated-content -->
<a id="sts32xx-servo-driver"></a>
# STS32XX سائق سيرفو

برنامج تشغيل Node.js لـ STS الماكينات التسلسلية والبرامج الثابتة STS32XX **امتداد الحركة v9**. يوفر الاكتشاف والوصول إلى التسجيل وعمليات الإعدادات وأوامر الحركة S-curve وتعويض الجاذبية والتعليقات من خلال اتصال تسلسلي واحد. يتطلب **Node.js 20 أو أحدث** ومحول تسلسلي متوافق.

تستخدم العمليات القديمة جدول التحكم STS المتضمن في هذه الحزمة. تتطلب عمليات الامتداد برامج ثابتة مخصصة الإصدار 9؛ البرامج الثابتة المصنع لا توفر لهم. الحزمة مخصصة لـ Node.js، وليس لتسلسل الويب للمتصفح.

<a id="install"></a>
## تثبيت

من هذا المستودع:

```sh
npm ci
npm run test:driver
npm pack --workspace sts32xx-servo-driver --pack-destination /tmp
```

في مشروع Node.js آخر، قم بتثبيت الأرشيف الذي تم إنتاجه بواسطة الأمر الأخير:

```sh
npm install /tmp/sts32xx-servo-driver-0.1.0.tgz
```

يعمل هذا دون النشر إلى سجل npm. يحتوي الأرشيف على المكتبة والأمثلة وREADME والترخيص. يتم تثبيت التبعيات التسلسلية من خلال npm؛ لا يتم تضمين البرامج الثابتة والسجلات ونتائج الاختبار.

كومونجس:

```js
const { StsServo } = require('sts32xx-servo-driver');
```

ES وحدات:

```js
import driver from 'sts32xx-servo-driver';
const { StsServo } = driver;
```

يمكن لأدوات المستودع الحالية الاستمرار في استيراد `host/servo-driver` مباشرةً. استخدم التصدير الرئيسي للحزمة؛ مسارات الملفات الداخلية ليست جزءًا من عامة API.

<a id="connect-and-read"></a>
## الاتصال والقراءة

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

استخدم `/dev/ttyUSB0` أو `COM3` أو المنفذ الفعلي للمحول الخاص بك حسب الاقتضاء. يعثر الاكتشاف على معرفات الاستجابة عند البث بالباود المحدد؛ لا يغير إعدادات المحرك أو يفحص معدلات الباود الأخرى. يجب أن تكون المعرفات فريدة. ينتظر الحساب لأعلى مستوى ممكن ID والباود المحدد. `connect()` يفتح المنفذ ويكتشف المحركات؛ `open()` يفتح البورت فقط . تتطلب طرق الناقل والإرشاد معرفات مكتشفة.

تستخدم قيم التسجيل الوحدات الأولية. على سبيل المثال، `presentVoltage: 120` تعني 12 V. `ControlTable` يصف العناوين والترميزات والنطاقات ومقاييس العرض. تستخدم الحقول Multi-byte ترميز little-endian؛ تستخدم القيم القديمة الموقعة بتات الإشارة.

<a id="main-api"></a>
## الرئيسية API

جميع العمليات التي تتواصل مع وعود إرجاع الأجهزة.

| API | الغرض |
| --- | --- |
| `servo.connect()` / `servo.close()` | Open/discover أو إغلاق الاتصال التسلسلي. |
| `servo.bus.discover()` | قم بتحديث قائمة المعرفات المعروفة. |
| `servo.bus.scan()` | اكتشف دون استبدال القائمة known-ID. |
| `servo.bus.verify(ids)` | بينغ المحركات المعروفة بشكل فردي. |
| `servo.bus.read(id, keys, options)` | قراءة السجلات المسماة. إرجاع كائن مرتبط باسم التسجيل. |
| `servo.bus.write(id, values, options)` | اكتب كائنًا من السجلات المسماة. |
| `servo.bus.readMany(ids, keys, options)` | قراءة العديد من المحركات باستخدام طلبات المجموعة. |
| `servo.bus.syncWrite(entries, options)` | اكتب إدخالات على شكل `{ id, values }` في مجموعة. |
| `servo.bus.device(id)` | احصل على كائن مناسب باستخدام الطرق `read` و`write` وreset/calibration. |
| `servo.settings.read(id)` | قراءة الإعدادات القديمة المستمرة. |
| `servo.settings.save(id, values)` | فتح الإعدادات العادية وحفظها والتحقق منها وإعادة قفلها. |
| `servo.arm` | قم بالوصول إلى طرق الإصدار 9 أدناه. |

تستخدم عمليات حفظ الإعدادات مهلة طلب قدرها 250 مللي ثانية. بعد إقرار فقدان الكتابة، ينتظر برنامج التشغيل الثبات ويقرأ السجل مرة أخرى قبل إعادة المحاولة. Already-applied الكتابة لا تتكرر. قد يصل عدد محاولات فشل الاتصال المؤقتة إلى ثلاث محاولات؛ لا تزال حالات الفشل المستمرة تشير إلى وجود خطأ وتحاول إعادة قفل المحرك. قم بتمرير `{ timeoutMs }` إلى `settings.save` لتجاوز المهلة.

مثال قديم، لمحرك مؤمن في وضع الموضع المخصص للتحرك:

```js
await servo.bus.write(id, { targetPosition: 2048 },
  { timeoutMs: 100, rejectOnAlarm: true });
```

يمكن لكتابة الهدف القديم تمكين عزم الدوران تلقائيًا، اعتمادًا على الإعدادات المحفوظة. يمكن أن تؤدي عمليات الكتابة المستمرة إلى تغيير المعايرة أو الحدود أو المكاسب. قم بتعطيل عزم الدوران قبل تغيير الإعدادات. الإعدادات API الحراس ID، الباود و response-level التغييرات؛ استخدم [الإعدادات CLI](../../tools/settings/README.md) في المستودع للكامل backup/restore. إعادة ضبط المصنع، reset-template وأوامر المعايرة مكشوفة من خلال `servo.protocol`؛ اتصل بهم فقط عندما تكون هذه التغييرات مقصودة.

<a id="v9-control-lifecycle"></a>
## دورة حياة التحكم v9

1. ابدأ بإيقاف عزم الدوران. قراءة القدرات والتكوين.
2. قم بتطبيق تكوين تم التحقق منه باستخدام `arm.configure()` أثناء إيقاف تشغيل عزم الدوران.
3. حدد وضع الامتداد بجلسة جديدة غير صفرية ID.
4. قم بتمكين عزم الدوران باستخدام السجل القديم 40، ثم اقرأ التعليقات حتى تصبح الجلسة مسلحة وحديثة وdrive-enabled وoutput-ready.
5. إرسال الأهداف وتحديثات الجاذبية. تحقق من أرقام التسلسل المقبولة في التعليقات الجديدة.
6. اكتب `torqueEnable: 0` عندما ينوي التطبيق تحرير المحرك.

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

يعرض هذا المقتطف المكالمات؛ يتضمن [مثال الحركة الكامل](../../../../../host/servo-driver/examples/v9-move.js) التحقق من الصحة واستطلاع الاستعداد وفحوصات القبول والتنظيف torque-off. إذا تم تعطيل إقرارات الكتابة، فستحتاج عمليات الكتابة القديمة إلى `expectResponse: false` والتحقق من إعادة القراءة. يعالج المثال الكامل هذا تلقائيًا.

يحتفظ البرنامج الثابت بالهدف الأخير ويحتفظ بأحدث جهد الجاذبية حتى يتم استبداله أو تعطيل عزم الدوران. لا يوجد نبضات قلب، أو مهلة الأمر، أو انتهاء الجاذبية. **لا يؤدي إغلاق الاتصال التسلسلي إلى إيقاف المحرك أو تحريره.** اختر تنظيف التطبيق ليناسب الآلية؛ إن إطلاق الذراع المحملة قد يؤدي إلى سقوطها. تظل حماية المستشعر والمحرك نشطة في البرامج الثابتة.

تمكين عزم الدوران يلتقط الموقف المقاس. لا تقم بتكوين جلسة تمديد مع كتابة الأهداف القديمة. توقف عزم الدوران أو حدث خطأ يؤدي إلى إنهاء الجلسة؛ تحضير جلسة جديدة قبل إعادة التشغيل. لتحديد الوضع القديم مع إيقاف عزم الدوران، استخدم `arm.select(id, false, 0)`.

<a id="extension-methods"></a>
### طرق التمديد

| الطريقة | النتيجة أو التأثير |
| --- | --- |
| `capabilities(id, options)` | `{ major, minor, tickMs }` للتوقيع المعترف به؛ قد ترفض البرامج الثابتة غير المدعومة الطلب أو تنتهي المهلة. |
| `configuration(id, options)` | اقرأ التكوين RAM الحالي. |
| `configure(id, config, options)` | كتابة التكوين والتحقق من البايتات المشفرة عن طريق القراءة. |
| `select(id, enabled, session, options)` | قم بإعداد التحكم v9، أو حدد الوضع القديم باستخدام `false, 0`. |
| `setTargets(entries, session, options)` | أرسل بثًا واحدًا يحتوي على واحد إلى ستة محركات فريدة. |
| `updateGravity(id, command, options)` | إرسال جهد الجاذبية الموقع مع الرقم التسلسلي الخاص به. |
| `feedback(id, options)` | اقرأ عينة تشغيلية واحدة متماسكة. |
| `tuning(id, options)` | اقرأ التعليقات التشغيلية بالإضافة إلى الحركة المرجعية وشروط الجهد الفردي. |
| `invalidate(id)` | مسح القدرات المخزنة مؤقتًا بعد دورة طاقة خارجية أو تغيير البرامج الثابتة؛ حذف ID لمسح الكل. |

يقوم برنامج التشغيل تلقائيًا بإبطال الإمكانيات عند الاكتشاف وتغييرات ID وتغييرات الاتصال وإعادة التعيين الصادرة من خلال البروتوكول الخاص به API.

<a id="configuration-and-units"></a>
### التكوين والوحدات

كل حقل تكوين واضح. يوضح هذا الكائن التنسيق، وليس ملف تعريف الضبط الموصى به:

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

| الحقول | الوحدات والحدود |
| --- | --- |
| `kpQ8`, `kdQ8`, `kiQ8` | المكاسب مضروبة في 256؛ الأعداد الصحيحة 0–65535. |
| `effortLimit`, `integralLimit` | PWM وحدات الجهد؛ الحد الإجمالي 1–1000، الحد المتكامل 0 – الحد الإجمالي. |
| `velocityLimit`، الهدف `speedLimit` | التشفير counts/s; 1–65535. |
| `accelerationLimit` | Counts/ث²؛ 1–30000، يتقاسمها التسارع والكبح. |
| `rampTimeMs` | S-curve وقت منحدر التسارع؛ 1–255 مللي ثانية. |
| `velocityFilterQ8` | معامل التصفية مضروبًا في 256؛ 1–255. |
| سرعة المكاسب المغذية | Direction-specific المكاسب مضروبة في 256؛ 0–65535. لا يمكن أن يتجاوز الحد الأقصى للجهد الحد الأقصى الإجمالي. قم بتعيين كل من المكاسب والحد الأقصى على الصفر لتعطيله. |
| `gravitySlewEffortPerS` | تغير جهد الجاذبية في الثانية الواحدة؛ 1–10000. |
| الهدف `positionQ8` | موضع التشفير مضروبًا بـ 256؛ −32767×256 إلى 32767×256. |
| `gravityEffort` | توقيع PWM جهد؛ −1000 إلى 1000. تطبق البرامج الثابتة حدود جهدها. |

تأتي حدود السفر من حدود الموضع القديم المحفوظة. تحدد البرامج الثابتة الأهداف إلى الحدود النشطة. التكوين هو حالة RAM، وليس ملف تعريف ضبط مستمر. تتبع السرعة المحلية المغذية مرجع حركة البرنامج الثابت؛ يوفر التطبيق تعويض الجاذبية بشكل منفصل.

معرفات أهداف الامتداد هي 1–253. الجلسة هي 1–65535. يتتبع كل محرك تسلسل الهدف والجاذبية بشكل منفصل. قم بزيادة التسلسل المقابل لكل أمر جديد، مع التفاف 65535 إلى 0؛ يتم قبول الفجوات الأمامية التي تصل إلى 32767. ابدأ جلسة جديدة بالتسلسل 1. اكتمال البث يعني أن الحزمة قد تم إرسالها، وليس أن كل محرك قد قبلها. حدد `acceptedSequence` و`gravitySequence` و`session` في التعليقات اللاحقة.

<a id="feedback-and-errors"></a>
### ردود الفعل والأخطاء

`feedback()` يشمل قياس position/velocity في Q8 وحدات، والجهد المطبق، والتيار ADC دلتا، والجهد الخام، ودرجة الحرارة المعتمدة، والأخطاء، والجلسة والتسلسلات المقبولة. استخدم `fresh`، `ageMs`، `sampleSequence`، `armed`، `driveEnabled` و`outputReady` للحكم على ما إذا كانت العينة قابلة للاستخدام. درجة الحرارة صالحة للاستخدام فقط عندما تكون `temperatureValid` صحيحة. `running: false` يعني أن المخطط لم يعد يتحرك؛ لا يضمن وجود خطأ في الموضع صفر.

`tuning()` يضيف المرجع position/velocity، الجهد المطلوب، P/D/I المصطلحات، جهد الجاذبية، سرعة التغذية للأمام وعدد التجاوز.

تتضمن خيارات القراءة والكتابة `timeoutMs` و`rejectOnAlarm`. لا ترفض الإنذارات القديمة الردود الصالحة بشكل افتراضي؛ قم بتمرير `rejectOnAlarm: true` عندما يجب أن يلغي الإنذار العملية. تتضمن الأخطاء المكتوبة `RequestTimeoutError` و`MissingResponseError` و`ServoStatusError` و`SettingsVerificationError` و`InvalidPacketError`. سياق إضافي موجود في `error.details`؛ يشمل رفض التمديد `extensionStatus` هناك.

يقوم المجدول بتسلسل الطلبات ويدعم الأولويات والمعاملات الحصرية. انتظر الأوامر واستخدم أهداف المجموعة للحركة المنسقة. تبدأ مهلة الرد بعد استنزاف الكتابة التسلسلية؛ عمليات النقل لها مواعيد نهائية خاصة بها. هذه المهلات لا تغير السلوك الحركي. لا تحتوي الحزم القديمة على رقم تسلسلي، لذلك لا يمكن دائمًا تمييز الرد المتأخر بشكل غير معتاد عن طلب لاحق بنفس شكل الاستجابة.

Low-level الصادرات تشمل `SerialTransport`، `StsProtocol`، `RequestScheduler`، `PacketEncoder`، `PacketDecoder`، `RegisterCodec`، `RegisterLayout`، `ArmCodec`، الثوابت والأخطاء. تظل منفصلة عن ناقل الاتصال high-level API.

<a id="runnable-examples"></a>
## أمثلة قابلة للتشغيل

من هذا الدليل، أو باستخدام ملفات الأمثلة المضمنة في الحزمة المثبتة:

```sh
node examples/discover.js /dev/cu.usbmodemYOUR_ADAPTER
node examples/v9-feedback.js /dev/cu.usbmodemYOUR_ADAPTER 2
node examples/v9-move.js /dev/cu.usbmodemYOUR_ADAPTER 2 2048 100 /path/to/config.json
```

المثالين الأولين للقراءة فقط. يتطلب المثال المتحرك تكوين JSON مع الحقول أعلاه ويستخدم 1 Mbaud. قم بتشغيله على محرك آمن ومفرغ مع حرية السفر. يقوم بتعطيل عزم الدوران بعد النقلة خطأ أو رشيقة Ctrl+C. ينتظر ما يصل إلى 3 ثانية لبدء التشغيل و30 ثانية للحركة. الحجة النهائية الاختيارية: جهد الجاذبية الموقع، الصفر الافتراضي. لا تستخدمه لدعم حمل الذراع.

<a id="tests-and-license"></a>
## الاختبارات والترخيص

من جذر المستودع:

```sh
npm run test:driver
npm run test:driver-package
npm test
```

تستخدم الاختبارات وسائل نقل وهمية ولا تفتح المنافذ التسلسلية. يقوم فحص الحزمة بتثبيت الأرشيف الفعلي في مشروع مؤقت، باستخدام تبعيات npm المخزنة مؤقتًا من `npm ci`، والتحقق من واردات CommonJS/ESM ونقاط الإدخال النموذجية. ولا ينشر الحزمة. قد يتطلب تثبيت الإنتاج أدوات بناء أصلية إذا كان الرابط serial-port غير متوفر لنظام التشغيل وCPU.

[MIT](../../../../../host/servo-driver/LICENSE)، حقوق النشر 2026 STS32XX-Firmware المساهمين. يغطي هذا الترخيص دليل برنامج التشغيل هذا، بما في ذلك الأمثلة والاختبارات. ولا يقوم بإعادة ترخيص البرامج الثابتة أو كود البائع في أي مكان آخر في المستودع. تحتفظ التبعيات بالتراخيص الخاصة بها.
<!-- /translated-content -->
