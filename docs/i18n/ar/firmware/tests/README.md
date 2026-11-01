<!-- translation-navigation -->
[English](../../../en/firmware/tests/README.md) · [Русский](../../../ru/firmware/tests/README.md) · [Español](../../../es/firmware/tests/README.md) · [Français](../../../fr/firmware/tests/README.md) · [Deutsch](../../../de/firmware/tests/README.md) · [Português (Brasil)](../../../pt-BR/firmware/tests/README.md) · [简体中文](../../../zh-CN/firmware/tests/README.md) · [日本語](../../../ja/firmware/tests/README.md) · [हिन्दी](../../../hi/firmware/tests/README.md) · [العربية](README.md)

[الأصل الإنجليزي](../../../../../firmware/tests/README.md)

> ترجمة آلية كاملة لم يراجعها متحدث أصلي بعد. الصور ومقاطع الفيديو مشتركة بين اللغات، وتبقى النصوص داخلها بلغتها الأصلية.
<!-- /translation-navigation -->

<!-- translated-content -->
<a id="firmware-tests"></a>
# اختبارات البرامج الثابتة

قم بتشغيل `make verify` من جذر المستودع بعد تثبيت [سلسلة أدوات البرنامج الثابت](../README.md#build-and-verify). فهو يبني البرنامج الثابت ويجري اختبارات C المعقمة، وفحوصات العقد register/storage، وفحوصات حدود الوحدة، والتحقق من تخطيط الصورة. لا يتصل بالأجهزة.

`fixtures/` يحتوي على مدخلات الانحدار المطلوبة. احتفظ بها مع الاختبارات. `support/` توفر واجهات الأجهزة وتركيبات التخزين المحاكاة.

راجع [فحوصات المشروع](../../tools/README.md#offline-checks) لاختبارات المضيف والتفليش والعارض، و[مجموعة مقارنة الأجهزة](../../tools/hw-diff-tests/README.md) لفحوصات السلوك factory/custom على مقعد مخصص.
<!-- /translated-content -->
