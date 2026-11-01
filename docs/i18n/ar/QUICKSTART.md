<!-- translation-navigation -->
[English](../en/QUICKSTART.md) · [Русский](../ru/QUICKSTART.md) · [Español](../es/QUICKSTART.md) · [Français](../fr/QUICKSTART.md) · [Deutsch](../de/QUICKSTART.md) · [Português (Brasil)](../pt-BR/QUICKSTART.md) · [简体中文](../zh-CN/QUICKSTART.md) · [日本語](../ja/QUICKSTART.md) · [हिन्दी](../hi/QUICKSTART.md) · [العربية](QUICKSTART.md)

[الأصل الإنجليزي](../../../QUICKSTART.md)

> ترجمة آلية كاملة لم يراجعها متحدث أصلي بعد. الصور ومقاطع الفيديو مشتركة بين اللغات، وتبقى النصوص داخلها بلغتها الأصلية.
<!-- /translation-navigation -->

<!-- translated-content -->
<a id="quick-start"></a>
# بداية سريعة

ل GD32F130-based STS TTL الماكينات. تستخدم الأوامر أدناه بناء جملة macOS/Linux ويتم تشغيلها من جذر المستودع. تتطلب أدوات الحركة الملحقة برنامجًا ثابتًا v9؛ تدعم ميزة إعادة التشغيل القديمة أيضًا البرامج الثابتة للمصنع.

<a id="1-install"></a>
## 1. تثبيت

تثبيت Node.js 20+ وPython 3.10+؛ يحتاج عارض المحاكاة الاختياري إلى Python 3.12.

```sh
npm ci
python3 -m venv tools/flash/.venv
tools/flash/.venv/bin/python -m pip install -r tools/flash/requirements.txt
export SERVO_PORT=/dev/cu.usbmodemYOUR_ADAPTER
```

استبدل المنفذ بالمنفذ الخاص بك، مثل `/dev/ttyUSB0` على Linux. تستخدم الأمثلة المحرك ID **1** والباود **1000000**؛ ضبط هذه لتتناسب مع المؤازرة الخاصة بك.

<a id="2-back-up-and-flash"></a>
## 2. النسخ الاحتياطي والفلاش

**قد تؤدي كتابة البرمجيات الثابتة إلى إتلاف السيرفو أو محو المعايرة.** ثبّت الآلية واستخدم تغذية كهربائية مستقرة وعطّل العزم وأغلق البرامج الأخرى التي تستخدم المنفذ التسلسلي. يجب قفل الإعدادات ومسح الإنذارات قبل الكتابة. أثناء الكتابة العادية للبرمجيات الثابتة المخصصة، يمكن إبقاء المحركات ذات المعرّفات الفريدة متصلة: اكتب إلى ID واحد في كل مرة، ولا تنفّذ power-cycle لناقل الاتصال. عند الاستعادة، يجب توصيل السيرفو المطلوب استعادته فقط.

```sh
npm run settings -- discover --port "$SERVO_PORT"
npm run settings -- backup --port "$SERVO_PORT" --id 1
```

قم بتنزيل **البرامج الثابتة المخصصة ZIP** من [v0.1-إصدار المعاينة](https://github.com/roboninecom/STS32XX-Firmware/releases/tag/v0.1-preview) ضمن **الأصول**. قم باستخراج صورة البرنامج الثابت و`release.json` معًا إلى `tools/flash/releases/custom/`. لا تستخدم أرشيفات **كود المصدر** الخاصة بـ GitHub للتفليش.

```sh
tools/flash/.venv/bin/python tools/flash/flash.py inspect \
  --manifest tools/flash/releases/custom/release.json
tools/flash/.venv/bin/python tools/flash/flash.py flash \
  --manifest tools/flash/releases/custom/release.json --port "$SERVO_PORT" --id 1
```

اكتب `FLASH` عندما يُطلب منك ذلك واستمر في توصيل الطاقة حتى انتهاء عملية التحقق. كرر أمر الفلاش لكل محرك ID، في انتظار التحقق في كل مرة. راجع [التفليش والاسترداد](tools/flash/README.md) في حالة فشل التحقق.

**البرامج الثابتة للمصنع ZIP** مخصصة للعودة إلى البرامج الثابتة للمصنع، وليس لأدوات الحركة أدناه. استخرجه في مجلد منفصل واتبع [استعادة إعدادات المصنع](tools/flash/README.md#restore-factory-settings) بعد التفليش. احتفظ بكل صورة من صور البرامج الثابتة `release.json` الخاصة بها.

<a id="3-calibrate-joint-offsets-and-limits"></a>
## 3. معايرة الإزاحات والحدود المشتركة

بالنسبة لآلية ذات سفر مشترك محدد، حدد معرفات المحرك لمعايرتها:

```sh
npm run settings -- calibrate --port "$SERVO_PORT" --ids 1,2,3 \
  --file tools/settings/calibrations/arm.json
```

استبدل معرفات الأمثلة بمعرفاتك؛ حذف `--ids` لاستخدام جميع المحركات المكتشفة (حتى ستة). بالنسبة إلى SO-101 وSO-102، راجع [صور الوضع المرجعي المسمى](tools/settings/README.md#reference-pose-images). يحتوي الأمر على خطوتين:

1. ضع كل مفصل محدد، بما في ذلك لفافة المعصم والمقبض، في الوضع المرجعي للآلية. للحصول على إعداد جديد بدون واحد، اختر وضعية قابلة للتكرار بالقرب من منتصف حركة كل مفصل. استمر في الضغط على **Enter** لحفظ الإزاحات حتى يقرأوا 2048 في تلك الوضعية.
2. قم بتحريك كل طرف مشترك محدد إلى طرف، مع التوقف لفترة وجيزة عند الأطراف. راجع الجدول المباشر واضغط على **Enter** لحفظ الحدود.

دعم الآلية طوال الوقت؛ لا تجبر التوقف. يبقى عزم الدوران خارج. يتم تحديث الملف تلقائيًا ويتم الاحتفاظ بالنسخ الاحتياطية للمحركات. إذا فشلت الخطوة الثانية، تظل إزاحات الخطوة الأولى محفوظة: قم بإنهاء المعايرة قبل تمكين الحركة. لا تحل نقطة المنتصف المقاسة محل المرجع الذي تم التقاطه. 2048 هو مجرد مرجع تشفير؛ ولا يشكل زاوية فيزيائية للمحاكاة أو الجاذبية. انظر [اختيار الوضعية المرجعية](tools/settings/README.md#choose-the-reference-pose). افعل ذلك قبل تسجيل الوضعيات أو تركيب تعويض الجاذبية. لا تحتاج الأذرع الموجودة ذات المعايرة التي تم التحقق منها إلى إعادة المعايرة بعد تفليش settings-preserving.

<a id="4-check-communication"></a>
## 4. التحقق من الاتصالات

حافظ على عزم الدوران بعيدًا. اضبط `--ids` على المحركات المتصلة.

```sh
npm test
npm run bus-benchmark -- --port "$SERVO_PORT" --ids 1 --repetitions 100
npm run telemetry -- --port "$SERVO_PORT" --ids 1 --samples 1000 --interval-ms 20 \
  --output tools/diagnostics/results/first-check
```

`npm test` غير متواجد حالياً. تقوم الأوامر الأخرى بقراءة مسارات الأجهزة وطباعة التقارير. استخدم دليل إخراج القياس عن بعد الجديد في كل مرة؛ اضبط `--voltage-min` و`--voltage-max` إذا كان العرض الخاص بك خارج النطاق الافتراضي 8–16 V. فحص الفشل والقراءات التي تم وضع علامة عليها قبل الحركة. لإجراء مقارنات factory/custom، اتبع [دليل اختبار الأجهزة](tools/hw-diff-tests/README.md): تعمل مجموعته الكاملة على تحريك المحركات واستبدال الإعدادات المحفوظة وإعادة تعيين القوالب.

<a id="5-record-and-replay-poses"></a>
## 5. تسجيل وإعادة يطرح

دعم الآلية قبل إطلاق عزم الدوران. حركه يدويًا، وأدخل اسمًا لحفظ كل وضعية، ثم اكتب `done`. استخدم جميع معرفات المحركات المطلوبة للذراع.

```sh
npm run record-poses -- --port "$SERVO_PORT" --ids 1
cp tools/poses/replay.example.json tools/poses/controller.local.json
```

تعديل `tools/poses/controller.local.json`: اضبط `followerPort` ووفر مدخل `profiles` لكل محرك واختر المكاسب المناسبة وحدود الجهد والسرعة والتسارع. قيم الأمثلة توضيحية. يشير المثال إلى ملف تعريف مشترك؛ انسخ ملف التعريف هذا لتحقيق مكاسبك الخاصة وقم بتحديث مساره، أو قم بوضع الإعدادات في السطر. المسارات مرتبطة بملف وحدة التحكم. تحقق من المعايرة المحفوظة وحدود الموضع أولاً. يجب أن تحتوي ناقل الاتصال التابعة على المحركات التي تم تكوينها بالضبط. تتعامل إعادة التشغيل مع المحركات التي تعمل بالطاقة وغير المزودة بالطاقة وتطبق الإعدادات المتغيرة تلقائيًا.

استبدل `POSES.json` بالمسار المحفوظ للمسجل:

```sh
npm run replay -- tools/poses/controller.local.json POSES.json
npm run replay -- tools/poses/controller.local.json POSES.json --run
```

معاينات الأمر الأول؛ `--run` تمكن من الحركة. **الإكمال الطبيعي يترك المحركات تعمل، مما يحافظ على الهدف النهائي. Ctrl+C ليس توقفًا طارئًا.** راجع [إعدادات إعادة التشغيل](tools/poses/README.md#replay-poses).

للمقارنة باستخدام الإعدادات القديمة المحفوظة للمحركات PID، بدون تعويض:

```sh
npm run replay-legacy -- POSES.json --port "$SERVO_PORT" --run
```

ليست هناك حاجة إلى ملف وحدة تحكم. حذف `--run` للمعاينة read-only. راجع [إعادة التشغيل القديمة](tools/poses/README.md#legacy-replay) للتعرف على إعدادات السرعة والتسارع.

<a id="6-enable-gravity-compensation"></a>
## 6. تمكين تعويض الجاذبية

بالنسبة إلى `tools/poses/controller.local.json`، أضف هذا الحقل top-level:

```json
"gravityModel": "../../host/arm-control/models/arm-upright-empty.json"
```

النموذج المتضمن مخصص للمعايرة المستقيمة **SO-ARM-102 ذات القابض الفارغ**. تشمل المحركات 1–6 وجميع الملفات الشخصية الستة. المحركات 2–4 تحصل على تعويض؛ الآخرون يحصلون على صفر. يجب أن تتطابق معايرة التشفير؛ يحتاج التركيب أو الهندسة أو الحمولة المتغيرة إلى نموذج تم التحقق من صحته. لا تقم بتغيير المعايرة لمجرد تجاوز عدم التطابق. بالنسبة لآلية أو معايرة مختلفة، قم بملاءمة النموذج المطابق والتحقق من صحته.

[SO-101 وSO-102 ملفات تعريف وحدة التحكم](host/arm-control/profiles/README.md) تتضمن PID وسرعة التغذية الأمامية ونماذج الجاذبية المطابقة. اقرأ حدودها قبل الاستخدام؛ يتم ربطها بمعايرة الأذرع المجهزة.

تستخدم إعادة التشغيل والتشغيل عن بعد والضبط نفس المجال. تتبع الجاذبية المواضع المقاسة أثناء تشغيل الأداة؛ بعد الخروج، يتم الاحتفاظ فقط بالجهد النهائي. راجع [دليل الجاذبية](host/arm-control/README.md) لمعرفة متطلبات النموذج.

<a id="7-tune-and-view-motion"></a>
## 7. ضبط وعرض الحركة

انسخ وحرر [خطة الضبط](../../../tools/tuning/example.json) و[مثال وحدة التحكم](../../../tools/tuning/controller.example.json)؛ قم بتعيين مسار الخطة `config` إلى ملف وحدة التحكم الخاصة بك. في الجولة الأولى، استخدم حركات آمنة صغيرة، `"stage": "baseline"` و`"candidates": []`.

```sh
npm run tune -- inspect PLAN.json
npm run tune -- preflight PLAN.json
npm run tune -- run PLAN.json
```

فقط `run` يحرك الأجهزة. اتبع [ترتيب الضبط](tools/tuning/README.md#tuning-order): خط الأساس → الجاذبية → سرعة التغذية للأمام → P/D والتصفية → التكامل إذا لزم الأمر → acceleration/ramp الوقت → الحركة المشتركة → التحقق من الصحة.

للتصور، قم بتثبيت [عارض المحاكاة](tools/simulation/README.md)، ثم استخدم المسار event-log المطبوع عن طريق إعادة التشغيل أو الضبط:

```sh
tools/simulation/.venv/bin/python tools/simulation/viewer.py live EVENTS.ndjson --model so101
tools/simulation/.venv/bin/python tools/simulation/viewer.py play EVENTS.ndjson --model so101
```

استخدم `--model so102` لنموذج الذراع المجمع الآخر. تحقق من اتفاقية reference-pose في دليل المشاهد. يتعامل الأمر مع مشغل نافذة macOS تلقائيًا. يعرض العارض الحركة المقاسة. ولا يتنبأ بنتائج الضبط. للحصول على التحكم hand-operated باستخدام محولات منفصلة للقائد والتابع، راجع [التشغيل عن بعد](tools/teleoperation/README.md).
<!-- /translated-content -->
