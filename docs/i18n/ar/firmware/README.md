<!-- translation-navigation -->
[English](../../en/firmware/README.md) · [Русский](../../ru/firmware/README.md) · [Español](../../es/firmware/README.md) · [Français](../../fr/firmware/README.md) · [Deutsch](../../de/firmware/README.md) · [Português (Brasil)](../../pt-BR/firmware/README.md) · [简体中文](../../zh-CN/firmware/README.md) · [日本語](../../ja/firmware/README.md) · [हिन्दी](../../hi/firmware/README.md) · [العربية](README.md)

[الأصل الإنجليزي](../../../../firmware/README.md)

> ترجمة آلية كاملة لم يراجعها متحدث أصلي بعد. الصور ومقاطع الفيديو مشتركة بين اللغات، وتبقى النصوص داخلها بلغتها الأصلية.
<!-- /translation-navigation -->

<!-- translated-content -->
<a id="firmware-sources"></a>
# مصادر البرامج الثابتة

GD32F130 البرامج الثابتة، بما في ذلك رمز التحكم المحمول وبرامج تشغيل الأجهزة والاختبارات. تم توثيق بروتوكول التمديد في [الوثائق التفصيلية](../DETAILED_DOCUMENTATION.md#extension-protocol).

| الدليل | المحتويات |
| --- | --- |
| `app/` | الحلقة الرئيسية والتنسيق بين المكونات |
| `core/` | التحكم والاستشعار والبروتوكول والسجلات والتخزين |
| `include/` | إعلانات C المشتركة وأنواع البيانات |
| `platform/gd32f130/` | برامج تشغيل الأجهزة، ورمز بدء التشغيل، والبرنامج النصي للرابط، ورؤوس البائعين |
| [`tests/`](tests/README.md) | اختبارات الانحدار C، وفحوصات بايثون والتركيبات المطلوبة |

<a id="build-and-verify"></a>
## بناء والتحقق

من جذر المستودع:

```sh
make
make verify
```

قم بتثبيت `arm-none-eabi-gcc`، مترجم C المضيف مع مطهرات address/undefined-behavior، Python 3 وMake. للحصول على سلسلة أدوات بالخارج PATH:

```sh
make verify ARM_PREFIX=/path/to/toolchain/bin/arm-none-eabi-
```

يقوم Makefile الجذر بتفويض هذا الدليل. `make -C firmware` و `make -C firmware verify` يعملان أيضًا. يقوم كلاهما بكتابة صور البرامج الثابتة إلى `build/motor-release/` والملفات التنفيذية للاختبار الأصلي إلى `build/host/` في جذر المستودع. `make clean` يزيل الدليل `build/` الذي تم إنشاؤه.

هذه الأوامر لا تومض الأجهزة. استخدم [أداة الفلاش](../tools/flash/README.md) مع إصدار publisher-supplied. تبقى المكتبات المضيفة وأدوات command-line ضمن [`host/`](../host/servo-driver/README.md) و[`tools/`](../tools/README.md).
<!-- /translated-content -->
