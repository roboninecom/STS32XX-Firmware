<!-- translation-navigation -->
[English](../../../../en/tools/simulation/urdf/README.md) · [Русский](../../../../ru/tools/simulation/urdf/README.md) · [Español](../../../../es/tools/simulation/urdf/README.md) · [Français](../../../../fr/tools/simulation/urdf/README.md) · [Deutsch](../../../../de/tools/simulation/urdf/README.md) · [Português (Brasil)](../../../../pt-BR/tools/simulation/urdf/README.md) · [简体中文](../../../../zh-CN/tools/simulation/urdf/README.md) · [日本語](../../../../ja/tools/simulation/urdf/README.md) · [हिन्दी](README.md) · [العربية](../../../../ar/tools/simulation/urdf/README.md)

[अंग्रेज़ी मूल](../../../../../../tools/simulation/urdf/README.md)

> यह पूर्ण मशीन अनुवाद है; मातृभाषी द्वारा समीक्षा अभी नहीं हुई है। चित्र और वीडियो सभी भाषाओं में साझा हैं; उनमें लिखा पाठ मूल भाषा में है।
<!-- /translation-navigation -->

<!-- translated-content -->
<a id="so-arm-102-model"></a>
# SO-ARM 102 मॉडल

URDF और आठ STL जाल [रोबोनिन के SO-ARM-102](https://github.com/roboninecom/SO-ARM-102/tree/0f0dd95526638042a3213598ee0ae7f167c40efe/simulation/urdf) से, कमिट `0f0dd95526638042a3213598ee0ae7f167c40efe`। फ़ाइलें अपरिवर्तित कॉपी की जाती हैं. `source.json` उनके चेकसम को रिकॉर्ड करता है। स्टैंडअलोन URDF को लोड करने के लिए Xacro और ROS पैकेज मचान की आवश्यकता नहीं है।

कॉपीराइट (सी) 2026 रोबोनिन। विशेषता: रोबोनिन, SO-ARM 102, https://github.com/roboninecom/SO-ARM-102, CC BY 4.0। [LICENSE.txt](../../../../../../tools/simulation/urdf/LICENSE.txt) और अपस्ट्रीम [लाइसेंस मानचित्र](https://github.com/roboninecom/SO-ARM-102/blob/0f0dd95526638042a3213598ee0ae7f167c40efe/LICENSING.md)] देखें।

<a id="model-assumptions"></a>
## मॉडल धारणाएँ

अपस्ट्रीम द्रव्यमान का अनुमान **0.889 किग्रा** है। यह PLA मुद्रण और 70 ग्राम प्रति सर्वो मानता है। अपस्ट्रीम [निर्यात सेटिंग्स](https://github.com/roboninecom/SO-ARM-102/blob/0f0dd95526638042a3213598ee0ae7f167c40efe/simulation/urdf/export_settings.json) और [मास प्रॉपर्टी](https://github.com/roboninecom/SO-ARM-102/blob/0f0dd95526638042a3213598ee0ae7f167c40efe/simulation/urdf/mass_properties.json)] देखें। ये अनुमान हैं; मापा गया हार्डवेयर गुरुत्वाकर्षण मॉडल अलग रहता है।

URDF शून्य निर्यातित CAD मुद्रा है। [एनकोडर मैप](../../../../../../tools/simulation/encoder-angle-map.json) क्रमशः 2048 से 0°, −3°, 1° और 1° की गिनती पर M1–M4 कोण सेट करता है। M5 और ग्रिपर अंशांकन असत्यापित रहता है। फिक्स्ड जॉ डिस्प्ले +0.016 m और −0.016 m का उपयोग करता है, जो URDF के opposite-sign कपलिंग से मेल खाता है।

स्रोत अपने टकराव बक्सों को बरकरार रखता है। मॉडल की तैयारी उन्हें जेनरेट किए गए पूर्वावलोकन से हटा देती है क्योंकि ये उपकरण संपर्क सिमुलेशन को अक्षम कर देते हैं। यह दृश्य, जड़त्व और संयुक्त युग्मन को सुरक्षित रखता है। सिमुलेशन परिणाम वास्तविक मोटर गतिशीलता को कैलिब्रेट नहीं करते हैं या हार्डवेयर ट्यूनिंग लाभ स्थापित नहीं करते हैं।
<!-- /translated-content -->
