<!-- translation-navigation -->
[English](../en/README.md) · [Русский](../ru/README.md) · [Español](../es/README.md) · [Français](../fr/README.md) · [Deutsch](../de/README.md) · [Português (Brasil)](../pt-BR/README.md) · [简体中文](../zh-CN/README.md) · [日本語](../ja/README.md) · [हिन्दी](../hi/README.md) · [العربية](README.md)

[الأصل الإنجليزي](../../../README.md)

> ترجمة آلية كاملة لم يراجعها متحدث أصلي بعد. الصور ومقاطع الفيديو مشتركة بين اللغات، وتبقى النصوص داخلها بلغتها الأصلية.
<!-- /translation-navigation -->

<!-- translated-content -->
<a id="sts32xx-firmware"></a>
# STS32XX البرامج الثابتة

البرامج الثابتة لـ GD32F130-based STS3215 الماكينات. تتوفر أوامر STS القياسية في الوضع القديم؛ يضيف وضع التمديد حركة سلسة مخططة محليًا، والتحكم في الموضع القابل للتكوين، وسرعة التغذية للأمام، وتعويض الجاذبية host-calculated.

ابدأ بدليل **[البدء السريع](QUICKSTART.md)**، أو اقرأ [الوثائق التفصيلية](DETAILED_DOCUMENTATION.md) للحصول على تفاصيل التكوين والبروتوكول.

[![نظرة عامة: تم تسجيل اختبارات SO-101 وSO-102 before-and-after](../../../assets/readme/posters/overview.jpg)](https://youtu.be/AsxFs24vXQs)

[شاهد على اليوتيوب](https://youtu.be/AsxFs24vXQs) | [MP4](../../../assets/readme/videos/overview.mp4)

تصف القيم التقريبية العروض التوضيحية المسجلة، وليست دقة مضمونة عبر مساحة العمل.

اختر صورة الفيديو أو رابط اليوتيوب الموجود أسفلها لمشاهدة المقطع الصامت. جميع مقاطع الفيديو التوثيقية متاحة عن طريق الرابط (غير مدرج)؛ MP4 يتم توفير نسخ أيضًا.

- [لماذا بنيناه](#why-we-built-it)
- [ما يتغير في السيطرة](#what-changes-in-control)
- [النتائج على SO-101 / SO-102](#results-on-so-101--so-102)
- [الروبوتات والروابط](#robots-and-links)
- [بداية سريعة](#quick-start)
- [التوثيق التفصيلي](#detailed-documentation)

<a id="why-we-built-it"></a>
## لماذا بنيناها

يمكن أن تعود ذراع الروبوت باستمرار إلى نفس النقطة ولا تزال تفوت الهدف الموجه. **قابلية التكرار** تصف هذا الاتساق؛ **الدقة المطلقة لتحديد الموقع** تصف مدى قرب الذراع من الهدف.

**العائدات المتكررة تقاس بمؤشر**

[![العائدات المتكررة تقاس بالمؤشر](../../../assets/readme/posters/repeatability.jpg)](https://youtu.be/_VN10zWybBU)

[شاهد على اليوتيوب](https://youtu.be/_VN10zWybBU) | [MP4](../../../assets/readme/videos/repeatability.mp4)

**التكرار مقابل دقة تحديد المواقع المطلقة**

[![شرح مفاهيمي للتكرار والدقة المطلقة لتحديد المواقع](../../../assets/readme/posters/repeatability-vs-accuracy.jpg)](https://youtu.be/L5FINW5FATI)

[شاهد على اليوتيوب](https://youtu.be/L5FINW5FATI) | [MP4](../../../assets/readme/videos/repeatability-vs-accuracy.mp4)

لقد حاولنا تقليل خطأ تحديد الموقع عن طريق ضبط PID على البرنامج الثابت للمخزون. في بعض سيناريوهات الاختبار، تسببت الإعدادات التي أدت إلى تقليل الخطأ أيضًا في حدوث تذبذب. لقد قمنا بتطوير برامج ثابتة مخصصة لمنحنا مزيدًا من التحكم في تخطيط الحركة والتحكم في الموضع.

[![البرامج الثابتة للمخزون: التذبذب أثناء ضبط PID](../../../assets/readme/posters/stock-pid-oscillation.jpg)](https://youtu.be/wIBd3jnOwRk)

[شاهد على اليوتيوب](https://youtu.be/wIBd3jnOwRk) | [MP4](../../../assets/readme/videos/stock-pid-oscillation.mp4)

<a id="what-changes-in-control"></a>
## ما يتغير في السيطرة

يرسل المضيف الأهداف والإعدادات؛ كل مؤازرة تخطط وتتحكم في حركتها الخاصة.

1. يرسل المضيف الأهداف والإعدادات ويحسب تعويض الجاذبية عند تكوينه.
2. تخطط كل مؤازرة لحركة S-curve الخاصة بها.
3. يقوم التحكم المحلي PID والتغذية الأمامية بضبط إخراج المحرك باستخدام الموضع المُقاس والسرعة المقدرة.

[شاهد النبذة المسجلة على اليوتيوب](https://youtu.be/AsxFs24vXQs) | [MP4](../../../assets/readme/videos/overview.mp4)

<a id="s-curve-motion"></a>
### S-curve الحركة

يجعل التسارع والكبح أكثر تدرجًا. يوضح المنحنى التسارع مع مرور الوقت.

[![توضيح مفاهيمي لحركة s-curve](../../../assets/readme/illustrations/s-curve.png)](https://youtu.be/92mDt4rbobY)

[شاهد على اليوتيوب](https://youtu.be/92mDt4rbobY) | [MP4](../../../assets/readme/videos/s-curve.mp4)

[التكوين والقيود](DETAILED_DOCUMENTATION.md#s-curve-motion).

<a id="pid-control"></a>
### PID التحكم

يضبط كيفية قيام المؤازرة بتصحيح خطأ الموضع. يوضح المنحنى الرمادي التذبذب. يوضح المنحنى الأبيض استجابة أكثر تثبيطًا. الخط المتقطع هو الهدف.

[![توضيح مفاهيمي للتحكم في pid](../../../assets/readme/illustrations/pid-tuning.png)](https://youtu.be/TEpvaAMlfrg)

[شاهد على اليوتيوب](https://youtu.be/TEpvaAMlfrg) | [MP4](../../../assets/readme/videos/pid-tuning.mp4)

[التكوين والقيود](DETAILED_DOCUMENTATION.md#pid-controller).

<a id="velocity-feedforward"></a>
### سرعة التغذية إلى الأمام

يضيف خرج المحرك بناءً على السرعة المخططة، المحسوبة داخل المؤازرة. يتقدم كلا المنحنيين من اليسار إلى اليمين بمرور الوقت.

[![توضيح مفاهيمي لسرعة التغذية للأمام](../../../assets/readme/illustrations/velocity-feedforward.png)](https://youtu.be/osGGs-nhk9I)

[شاهد على اليوتيوب](https://youtu.be/osGGs-nhk9I) | [MP4](../../../assets/readme/videos/velocity-feedforward.mp4)

[التكوين والقيود](DETAILED_DOCUMENTATION.md#velocity-feedforward).

<a id="gravity-compensation"></a>
### تعويض الجاذبية

يقوم المضيف بحساب المساهمة ويقوم المؤازرة بتطبيقها. يمثل السهم المتجه للأسفل الوزن؛ يمثل السهم التصاعدي الدعم.

[![توضيح مفاهيمي لتعويض الجاذبية](../../../assets/readme/illustrations/gravity-compensation.png)](https://youtu.be/25sc41PTDIA)

[شاهد على اليوتيوب](https://youtu.be/25sc41PTDIA) | [MP4](../../../assets/readme/videos/gravity-compensation.mp4)

[التكوين والقيود](DETAILED_DOCUMENTATION.md#gravity-compensation).

هذه الرسومات التوضيحية والرسوم المتحركة عبارة عن مخططات مفاهيمية وليست مُقاسة للأجهزة. راجع [الوثائق التفصيلية](DETAILED_DOCUMENTATION.md) للتعرف على الإعدادات وتفاصيل البروتوكول والقيود. يجب أن يدعم عملاء الامتداد **البروتوكول v9.0**; إعدادات الامتداد مؤقتة ويجب إرسالها مرة أخرى بعد إعادة التعيين أو دورة الطاقة.

<a id="results-on-so-101--so-102"></a>
## النتائج على SO-101 / SO-102

تظهر المقاطع أدناه اختبارات before-and-after مسجلة على SO-101 وSO-102. تُظهر كل مقارنة السلوك الأصلي أولاً، يليه الإعداد custom-firmware.

**SO-101: قبل ثم بعد**

[![SO-101 تم تسجيل before-and-after مقارنة](../../../assets/readme/posters/so101-before-after.jpg)](https://youtu.be/ZdLlv8q73gE)

[شاهد على اليوتيوب](https://youtu.be/ZdLlv8q73gE) | [MP4](../../../assets/readme/videos/so101-before-after.mp4)

**SO-102: قبل ثم بعد**

[![SO-102 تم تسجيل before-and-after مقارنة](../../../assets/readme/posters/so102-before-after.jpg)](https://youtu.be/0rmO15pFqJ4)

[شاهد على اليوتيوب](https://youtu.be/0rmO15pFqJ4) | [MP4](../../../assets/readme/videos/so102-before-after.mp4)

تصف القيم التقريبية الموضحة هذه العروض التوضيحية، ولا تضمن الدقة عبر مساحة عمل الذراع. التكرار ودقة تحديد المواقع المطلقة والانحراف الميكانيكي هي قياسات مختلفة.

<a id="complete-coordinated-movement"></a>
### حركة منسقة كاملة

[![أكمل حركة SO-101 المسجلة](../../../assets/readme/posters/coordinated-motion.jpg)](https://youtu.be/dCtcS5aAko0)

[شاهد على اليوتيوب](https://youtu.be/dCtcS5aAko0) | [MP4](../../../assets/readme/videos/coordinated-motion.mp4)

يحافظ هذا المقطع على الحركة المسجلة كاملة. كل أجهزة تخطط محليا؛ إن إرسال الأهداف معًا لا يضمن في حد ذاته الوصول المتزامن.

<a id="mechanical-limitations"></a>
### القيود الميكانيكية

[![رد الفعل العكسي لعلبة التروس والإطار المرن](../../../assets/readme/posters/mechanical-limits.jpg)](https://youtu.be/53l7at5aE6k)

[شاهد على اليوتيوب](https://youtu.be/53l7at5aE6k) | [MP4](../../../assets/readme/videos/mechanical-limits.mp4)

لا يزال رد الفعل العكسي لعلبة التروس ومرونة الإطار يؤثران على موضع نقطة نهاية الذراع. ضبط وحدة التحكم لا يزيل هذه القيود الميكانيكية. التحقق من صحة الإعدادات على الآلية الفعلية والتحميل؛ انظر [الحدود الحالية](DETAILED_DOCUMENTATION.md#current-limits).

<a id="robots-and-links"></a>
## الروبوتات والروابط

هل أنت مهتم ببناء إعداد مماثل؟ اكتشف مجموعتي SO-ARM101 وSO-ARM102 من Robonine. يتم توثيق محتويات المجموعة على صفحات المنتج.

| SO-ARM101 | SO-ARM102 |
| --- | --- |
| ![SO-ARM101 طقم الروبوت](../../../assets/readme/illustrations/hardware-so101.jpg) | ![SO-ARM102 طقم الروبوت](../../../assets/readme/illustrations/hardware-so102.jpg) |
| [اشتري المجموعة SO-ARM101 من Robonine](https://robonine.com/ru/shop/so-arm101-black-white-robotic-arm-kit/) | [اشتري المجموعة SO-ARM102 من Robonine](https://robonine.com/ru/shop/so-arm102-robotic-arm-kit/) |

[استكشف SO-ARM102 الأجهزة، CAD وBOM](https://github.com/roboninecom/SO-ARM102).

<a id="quick-start"></a>
## بداية سريعة

اتبع **[دليل البدء السريع الموجود](QUICKSTART.md)** للتعرف على المتطلبات الأساسية والأوامر والفحوصات والاحتياطات الوامضة. تسلسل الإعداد الخاص به هو:

1. قم بتثبيت الأدوات المطلوبة وحدد منفذ المؤازرة.
2. قم بعمل نسخة احتياطية لإعدادات المحرك وفلاش البرامج الثابتة المخصصة المنشورة.
3. معايرة الإزاحات المشتركة وحدود السفر كما هو مطلوب للإعداد.
4. تحقق من الاتصال مع إيقاف عزم الدوران.
5. قم بتسجيل الوضعيات ومعاينة إعادة التشغيل وإجراء اختبار الحركة الأول.
6. تمكين تعويض الجاذبية بنموذج يطابق الذراع ومعايرته.
7. ضبط وعرض الحركة.

**قد يؤدي التفليش إلى إتلاف المؤازرة أو مسح المعايرة.** اتبع احتياطات الدليل الخاصة بالطاقة وعزم الدوران والاسترداد قبل المتابعة.

للحصول على معايرة SO-101 أو SO-102 جديدة، استخدم الصور reference-pose الموجودة واتبع [دليل المعايرة](tools/settings/README.md#reference-pose-images). احتفظ بالمعايرة الحالية التي تم التحقق منها عند إعادة استخدام التسجيلات ونموذج الجاذبية.

**SO-101 الوضعية المرجعية**

[![SO-101 الوضع المرجعي مع ستة مفاصل مصنفة](../../../tools/settings/images/so101-reference-pose.png)](../../../tools/settings/images/so101-reference-pose.png)

**SO-102 الوضعية المرجعية**

[![SO-102 الوضع المرجعي مع ستة مفاصل مصنفة](../../../tools/settings/images/so102-reference-pose.png)](../../../tools/settings/images/so102-reference-pose.png)

<a id="detailed-documentation"></a>
## وثائق مفصلة

يغطي **[الوثائق التفصيلية](DETAILED_DOCUMENTATION.md)** التكوين والبروتوكولات والسجلات والبناء والتحقق. تظهر المخططات الفنية وعروض الفيديو ذات الصلة بجانب الأقسام المقابلة.

- [الوضع القديم](DETAILED_DOCUMENTATION.md#legacy-mode)
- [كيف يعمل وضع الامتداد](DETAILED_DOCUMENTATION.md#how-extension-mode-works)
- [S-curve الحركة](DETAILED_DOCUMENTATION.md#s-curve-motion)
- [يطرح مرجع المعايرة](DETAILED_DOCUMENTATION.md#calibration-reference-poses)
- [PID جهاز التحكم](DETAILED_DOCUMENTATION.md#pid-controller)
- [سرعة التغذية للأمام](DETAILED_DOCUMENTATION.md#velocity-feedforward)
- [تعويض الجاذبية](DETAILED_DOCUMENTATION.md#gravity-compensation)
- [بدء وإيقاف وضع التمديد](DETAILED_DOCUMENTATION.md#starting-and-stopping-extension-mode)
- [بروتوكول التمديد](DETAILED_DOCUMENTATION.md#extension-protocol)
- [سجلات التمديد](DETAILED_DOCUMENTATION.md#extension-registers)
- [البناء والتحقق](DETAILED_DOCUMENTATION.md#build-and-verification)
- [تخطيط المستودع](DETAILED_DOCUMENTATION.md#repository-layout)
- [الحدود الحالية](DETAILED_DOCUMENTATION.md#current-limits)


راجع [tools](tools/README.md) للحصول على أدلة الأوامر الفردية و[firmware](firmware/README.md) للحصول على سلسلة أدوات البناء.
<!-- /translated-content -->
