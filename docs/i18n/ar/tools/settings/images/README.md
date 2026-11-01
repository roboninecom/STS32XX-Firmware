<!-- translation-navigation -->
[English](../../../../en/tools/settings/images/README.md) · [Русский](../../../../ru/tools/settings/images/README.md) · [Español](../../../../es/tools/settings/images/README.md) · [Français](../../../../fr/tools/settings/images/README.md) · [Deutsch](../../../../de/tools/settings/images/README.md) · [Português (Brasil)](../../../../pt-BR/tools/settings/images/README.md) · [简体中文](../../../../zh-CN/tools/settings/images/README.md) · [日本語](../../../../ja/tools/settings/images/README.md) · [हिन्दी](../../../../hi/tools/settings/images/README.md) · [العربية](README.md)

[الأصل الإنجليزي](../../../../../../tools/settings/images/README.md)

> ترجمة آلية كاملة لم يراجعها متحدث أصلي بعد. الصور ومقاطع الفيديو مشتركة بين اللغات، وتبقى النصوص داخلها بلغتها الأصلية.
<!-- /translation-navigation -->

<!-- translated-content -->
<a id="calibration-illustrations"></a>
# الرسوم التوضيحية المعايرة

يتم عرض العروض الجانبية والعلوية من نماذج الروبوت المجمعة، مع إضافة تسميات مشتركة وتعليمات تحديد الموضع. هذه أدلة إرشادية **للمعايرة اليدوية الجديدة**، وليست صورًا فوتوغرافية أو قياسات للأذرع المضبوطة.

- `so101-reference-pose.png`: هندسة Robot Studio SO-101، موزعة تحت Apache-2.0. [المصدر والترخيص المثبت](../../simulation/urdf/so101/README.md).
- `so102-reference-pose.png`: هندسة روبونين SO-ARM-102، CC BY 4.0. [المصدر والترخيص المثبت](../../simulation/urdf/README.md). هذا الرسم التوضيحي عبارة عن تعديل للوضعية والكاميرا والخلفية والملصقات المحددة لهذا الدليل؛ وهو متوفر أيضًا تحت CC BY 4.0.

<a id="poses-used-in-the-images"></a>
## الأوضاع المستخدمة في الصور

M1–M4 استخدم تعيينات العارض المجمعة عند العد 2048. يتم ضبط مواضع لف المعصم والمقبض بشكل منفصل على نقاط المنتصف لحدود السفر الخاصة بالنموذج. تحدد نقاط التوقف الفعلية في الآلية الفعلية نقاط المنتصف تلك أثناء الوضع اليدوي.

| نموذج | M1–M4 زوايا مشتركة | لفة المعصم | القابض |
| --- | --- | --- | --- |
| SO-101 | 0°, 0°, 0°, 0° | 2.789° | الفك المتحرك 45° |
| SO-102 | 0°, −3°, 1°, 1° | −1° | أوضاع الفك المنزلقة +0.02075 م و −0.02075 م |

الزوايا مرتبطة بكل إطار مفصل URDF، وليست زوايا تقاس مقابل الطاولة. تختلف مواضع wrist/gripper هذه عن خرائط العارض الافتراضية؛ ولم يتم تغيير الخرائط ولا نماذج الجاذبية المنشورة لهذه الصور. لمطابقة معايرة جديدة، قم بتحديث الزوايا المرجعية للعارض وربط المعايرة كما هو موضح في [دليل العارض](../../simulation/README.md#match-the-calibration-reference).
<!-- /translated-content -->
