<!-- translation-navigation -->
[English](../../../en/firmware/tests/README.md) · [Русский](../../../ru/firmware/tests/README.md) · [Español](../../../es/firmware/tests/README.md) · [Français](../../../fr/firmware/tests/README.md) · [Deutsch](../../../de/firmware/tests/README.md) · [Português (Brasil)](../../../pt-BR/firmware/tests/README.md) · [简体中文](../../../zh-CN/firmware/tests/README.md) · [日本語](../../../ja/firmware/tests/README.md) · [हिन्दी](README.md) · [العربية](../../../ar/firmware/tests/README.md)

[अंग्रेज़ी मूल](../../../../../firmware/tests/README.md)

> यह पूर्ण मशीन अनुवाद है; मातृभाषी द्वारा समीक्षा अभी नहीं हुई है। चित्र और वीडियो सभी भाषाओं में साझा हैं; उनमें लिखा पाठ मूल भाषा में है।
<!-- /translation-navigation -->

<!-- translated-content -->
<a id="firmware-tests"></a>
# फ़र्मवेयर परीक्षण

[फर्मवेयर टूलचेन](../README.md#build-and-verify) इंस्टॉल करने के बाद रिपॉजिटरी रूट से `make verify` चलाएँ। यह फ़र्मवेयर बनाता है और सैनिटाइज्ड सी परीक्षण, register/storage अनुबंध जांच, मॉड्यूल सीमा जांच और छवि लेआउट सत्यापन चलाता है। यह हार्डवेयर से कनेक्ट नहीं होता है.

`fixtures/` में आवश्यक प्रतिगमन इनपुट शामिल हैं। इन्हें परीक्षणों के साथ रखें. `support/` सिम्युलेटेड हार्डवेयर इंटरफेस और स्टोरेज फिक्स्चर की आपूर्ति करता है।

होस्ट, फ्लैशिंग और व्यूअर परीक्षणों के लिए [प्रोजेक्ट चेक](../../tools/README.md#offline-checks), और एक समर्पित बेंच पर factory/custom व्यवहार जांच के लिए [हार्डवेयर तुलना सूट](../../tools/hw-diff-tests/README.md)] देखें।
<!-- /translated-content -->
