<!-- translation-navigation -->
[English](../../../../en/host/arm-control/profiles/README.md) · [Русский](../../../../ru/host/arm-control/profiles/README.md) · [Español](../../../../es/host/arm-control/profiles/README.md) · [Français](../../../../fr/host/arm-control/profiles/README.md) · [Deutsch](../../../../de/host/arm-control/profiles/README.md) · [Português (Brasil)](../../../../pt-BR/host/arm-control/profiles/README.md) · [简体中文](../../../../zh-CN/host/arm-control/profiles/README.md) · [日本語](../../../../ja/host/arm-control/profiles/README.md) · [हिन्दी](../../../../hi/host/arm-control/profiles/README.md) · [العربية](README.md)

[الأصل الإنجليزي](../../../../../../host/arm-control/profiles/README.md)

> ترجمة آلية كاملة لم يراجعها متحدث أصلي بعد. الصور ومقاطع الفيديو مشتركة بين اللغات، وتبقى النصوص داخلها بلغتها الأصلية.
<!-- /translation-navigation -->

<!-- translated-content -->
<a id="arm-profiles"></a>
# ملامح الذراع

الإعدادات المرجعية من الأذرع المستقيمة empty-gripper. يحتوي كل دليل على ملف وحدة تحكم وملف تعريف واحد لكل محرك، بما في ذلك PID وسرعة الاتجاه المغذية للأمام. تستخدم كلا وحدتي التحكم نماذج الجاذبية للمحركات 2–4؛ تتلقى المحركات 1 و5 و6 جهد انعدام الجاذبية.

| الملف الشخصي | سرعة إعادة التشغيل | التسارع | النطاق |
| --- | ---: | ---: | --- |
| [SO-101](../../../../../../host/arm-control/profiles/so101/controller.json) | 1,000 counts/s; السقف الشخصي 1,500 | 10,000 counts/s² | تم الاحتفاظ بإعدادات الضبط. M1 تذبذب الحركة ورحلات أبطأ M2 تظل دون حل. |
| [SO-102](../../../../../../host/arm-control/profiles/so102/controller.json) | 2,000 counts/s | 15,000 counts/s² | إعدادات المقارنة fixed-profile الحالية. لا يزال هذا التكوين السريع بحاجة إلى التحقق من صحة الأجهزة. |

هذه هي نقاط البداية، وليست الإعدادات الافتراضية العامة أو ادعاء الضبط المكتمل. يستخدم ملف التعريف SO-102 ثابت M1 D=0.0625 وM6 P=4 ومنحدر 100 مللي ثانية. تم استخدام إعادة التشغيل الأقدم M1 D=0.75 أثناء التحرك، M6 P=16 ومنحدر 180 مللي ثانية، لذلك لا يقوم هذا الملف بإعادة إنتاج هذا التشغيل الأقدم.

<a id="use"></a>
## استخدم

اضبط `followerPort` في ملف وحدة التحكم المختار. حافظ على الملف الشخصي النسبي ومسارات الجاذبية سليمة. من جذر المستودع:

```sh
npm run replay -- host/arm-control/profiles/so102/controller.json POSES.json
npm run replay -- host/arm-control/profiles/so102/controller.json POSES.json --run
```

استخدم `so101` للملف الشخصي الآخر. معاينات الأمر الأول؛ والثاني يحرك الذراع ويتركها متمسكة بالوضعية النهائية. تطبق إعادة التشغيل ملفات التعريف على RAM. للتشغيل عن بعد، قم أيضًا بتعيين `leaderPort` وإضافة `leaderId` و`mapping` وأي تجاوزات direction/center لكل مفصل؛ راجع [دليل رسم الخرائط](../../../tools/teleoperation/README.md#mapping-and-control).

تتضمن نماذج الجاذبية معايرة التشفير المستخدمة أثناء التركيب. يتطلب الاختبار المبدئي أن يتطابق مع الذراع المتصلة. **لا تقم بنسخ إزاحات جهاز تشفير ذراع آخر للوفاء بهذا الفحص.** قم بمعايرة ذراعك، وتناسب نموذجه أو تكييفه، والتحقق من صحة النتيجة بسرعة متواضعة قبل الاستخدام full-speed. تتطلب التغييرات في التركيب أو هندسة الارتباط أو الحمولة التحقق من الصحة أيضًا. راجع [تنسيق نموذج الجاذبية](../models/README.md) و[إجراء الضبط](../../../tools/tuning/README.md).

لا تحدد هذه الملفات وضعية المعايرة الفيزيائية العالمية. اتبع [reference-pose الدليل](../../../tools/settings/README.md#choose-the-reference-pose) قبل إنشاء معايرة جديدة. يؤدي ضبط جميع المحركات على 2048 إلى إعادة إنتاج الوضعية التي تم التقاطها على ذلك الذراع، مع مراعاة حدودها المحفوظة وخطأ التتبع؛ لا يقوم تلقائيًا بإعادة إنتاج الوضع الصفري لأي من النموذجين المجمعين.
<!-- /translated-content -->
