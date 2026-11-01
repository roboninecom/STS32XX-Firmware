<!-- translation-navigation -->
[English](../../../../en/tools/simulation/urdf/README.md) · [Русский](../../../../ru/tools/simulation/urdf/README.md) · [Español](../../../../es/tools/simulation/urdf/README.md) · [Français](../../../../fr/tools/simulation/urdf/README.md) · [Deutsch](../../../../de/tools/simulation/urdf/README.md) · [Português (Brasil)](../../../../pt-BR/tools/simulation/urdf/README.md) · [简体中文](../../../../zh-CN/tools/simulation/urdf/README.md) · [日本語](../../../../ja/tools/simulation/urdf/README.md) · [हिन्दी](../../../../hi/tools/simulation/urdf/README.md) · [العربية](README.md)

[الأصل الإنجليزي](../../../../../../tools/simulation/urdf/README.md)

> ترجمة آلية كاملة لم يراجعها متحدث أصلي بعد. الصور ومقاطع الفيديو مشتركة بين اللغات، وتبقى النصوص داخلها بلغتها الأصلية.
<!-- /translation-navigation -->

<!-- translated-content -->
<a id="so-arm-102-model"></a>
# SO-ARM 102 موديل

URDF وثمانية STL شبكات من [روبونين SO-ARM-102](https://github.com/roboninecom/SO-ARM-102/tree/0f0dd95526638042a3213598ee0ae7f167c40efe/simulation/urdf)، الالتزام `0f0dd95526638042a3213598ee0ae7f167c40efe`. يتم نسخ الملفات دون تغيير. `source.json` يسجل المجموع الاختباري الخاص بهم. ليست هناك حاجة إلى سقالات Xacro وROS لتحميل السقالات المستقلة URDF.

حقوق النشر (ج) 2026 Robonine. الإسناد: روبونين، SO-ARM 102، https://github.com/roboninecom/SO-ARM-102, CC BY 4.0. راجع [LICENSE.txt](../../../../../../tools/simulation/urdf/LICENSE.txt) والمنبع [خريطة الترخيص](https://github.com/roboninecom/SO-ARM-102/blob/0f0dd95526638042a3213598ee0ae7f167c40efe/LICENSING.md).

<a id="model-assumptions"></a>
## الافتراضات النموذجية

تقدير الكتلة الأولية هو **0.889 كجم**. يفترض طباعة PLA و70 جم لكل جهاز. راجع المنبع [إعدادات التصدير](https://github.com/roboninecom/SO-ARM-102/blob/0f0dd95526638042a3213598ee0ae7f167c40efe/simulation/urdf/export_settings.json) و[خصائص الكتلة](https://github.com/roboninecom/SO-ARM-102/blob/0f0dd95526638042a3213598ee0ae7f167c40efe/simulation/urdf/mass_properties.json). هذه تقديرات. يظل نموذج جاذبية الأجهزة المُقاس منفصلاً.

URDF صفر هي الوضعية المصدرة CAD. تحدد [خريطة التشفير](../../../../../../tools/simulation/encoder-angle-map.json) الزوايا M1–M4 عند العد 2048 إلى 0°، −3°، 1° و1°، على التوالي. M5 ومعايرة القابض لم يتم التحقق منها. تستخدم شاشة الفك الثابتة +0.016 م و−0.016 م، مما يتوافق مع وصلة URDF opposite-sign.

يحتفظ المصدر بصناديق الاصطدام الخاصة به. يؤدي إعداد النموذج إلى حذفها من المعاينة التي تم إنشاؤها لأن هذه الأدوات تعمل على تعطيل محاكاة جهات الاتصال. إنه يحافظ على الصور والقصور الذاتي والاقتران المشترك. لا تقوم نتائج المحاكاة بمعايرة ديناميكيات المحرك الحقيقية أو تحقيق مكاسب في ضبط الأجهزة.
<!-- /translated-content -->
