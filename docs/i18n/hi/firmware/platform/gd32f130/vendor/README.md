<!-- translation-navigation -->
[English](../../../../../en/firmware/platform/gd32f130/vendor/README.md) · [Русский](../../../../../ru/firmware/platform/gd32f130/vendor/README.md) · [Español](../../../../../es/firmware/platform/gd32f130/vendor/README.md) · [Français](../../../../../fr/firmware/platform/gd32f130/vendor/README.md) · [Deutsch](../../../../../de/firmware/platform/gd32f130/vendor/README.md) · [Português (Brasil)](../../../../../pt-BR/firmware/platform/gd32f130/vendor/README.md) · [简体中文](../../../../../zh-CN/firmware/platform/gd32f130/vendor/README.md) · [日本語](../../../../../ja/firmware/platform/gd32f130/vendor/README.md) · [हिन्दी](README.md) · [العربية](../../../../../ar/firmware/platform/gd32f130/vendor/README.md)

[अंग्रेज़ी मूल](../../../../../../../firmware/platform/gd32f130/vendor/README.md)

> यह पूर्ण मशीन अनुवाद है; मातृभाषी द्वारा समीक्षा अभी नहीं हुई है। चित्र और वीडियो सभी भाषाओं में साझा हैं; उनमें लिखा पाठ मूल भाषा में है।
<!-- /translation-navigation -->

<!-- translated-content -->
<a id="pinned-gd32f1x0-declarations"></a>
# पिन की गई GD32F1x0 घोषणाएँ

स्रोत: समुदाय `sts3215-firmware/firmware/lib` भंडार संशोधन `24ba15ba80bfe8213684c6bb4523a7d7ee079998` पर। GD32 device/SPL हेडर GigaDevice V3.3.0 (2020-09-21) की पहचान करते हैं। CMSIS कोर हेडर ARM V3.30 की पहचान करता है। `SHA256SUMS` प्रत्येक कॉपी किए गए हेडर के सटीक बाइट्स को रिकॉर्ड करता है। कोई विक्रेता सी कार्यान्वयन या सिस्टम स्टार्टअप स्रोत शामिल नहीं है।

निर्भरता क्लोजर में 18 हेडर शामिल हैं: 5 CMSIS और 13 SPL। डिवाइस हेडर में `gd32f1x0_libopt.h` शामिल है; वह स्थानीय एग्रीगेटर प्रत्येक परिधीय शीर्षलेख को संदर्भित करता है। एग्रीगेटर को छोड़कर सभी चयनित vendor/CMSIS हेडर में अपने स्वयं के अपस्ट्रीम कॉपीराइट, पुनर्वितरण की शर्तें और अस्वीकरण शामिल हैं। एग्रीगेटर के पास कोई अंतर्निहित सूचना नहीं है; स्रोत भंडार का MIT लाइसेंस `COMMUNITY_LICENSE` के रूप में शामिल है। अपस्ट्रीम नोटिस प्रत्येक फ़ाइल में अपरिवर्तित रहते हैं और स्रोत और बाइनरी वितरण के साथ होने चाहिए। बाइनरी शिपिंग करते समय इस निर्देशिका को शामिल करें या वितरण सामग्री में उन नोटिसों को पुन: प्रस्तुत करें।

केवल लक्ष्य बिल्ड में ही पथ शामिल होते हैं। `mcu.h` `GD32F130_150` का चयन करता है। किसी भी एप्लिकेशन, कोर या सार्वजनिक इंटरफ़ेस में यह डिवाइस हेडर शामिल नहीं होना चाहिए। declaration-only माइग्रेशन के भाग के रूप में प्रोजेक्ट के क्लॉक स्टार्टअप, वेक्टर लेआउट या लिंकर अनुबंध को विक्रेता कार्यान्वयन कोड से प्रतिस्थापित न करें।
<!-- /translated-content -->
