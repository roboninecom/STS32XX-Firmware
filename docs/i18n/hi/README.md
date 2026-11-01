<!-- translation-navigation -->
[English](../en/README.md) · [Русский](../ru/README.md) · [Español](../es/README.md) · [Français](../fr/README.md) · [Deutsch](../de/README.md) · [Português (Brasil)](../pt-BR/README.md) · [简体中文](../zh-CN/README.md) · [日本語](../ja/README.md) · [हिन्दी](README.md) · [العربية](../ar/README.md)

[अंग्रेज़ी मूल](../../../README.md)

> यह पूर्ण मशीन अनुवाद है; मातृभाषी द्वारा समीक्षा अभी नहीं हुई है। चित्र और वीडियो सभी भाषाओं में साझा हैं; उनमें लिखा पाठ मूल भाषा में है।
<!-- /translation-navigation -->

<!-- translated-content -->
<a id="sts32xx-firmware"></a>
# STS32XX फर्मवेयर

GD32F130-based STS3215 सर्वो के लिए फर्मवेयर। मानक STS कमांड लीगेसी मोड में उपलब्ध हैं; एक्सटेंशन मोड स्थानीय रूप से नियोजित सुचारू गति, विन्यास योग्य स्थिति नियंत्रण, वेग फीडफॉरवर्ड और host-calculated गुरुत्वाकर्षण मुआवजा जोड़ता है।

**[त्वरित प्रारंभ](QUICKSTART.md)** मार्गदर्शिका से प्रारंभ करें, या कॉन्फ़िगरेशन और प्रोटोकॉल विवरण के लिए [विस्तृत दस्तावेज़](DETAILED_DOCUMENTATION.md) पढ़ें।

[![अवलोकन: रिकॉर्ड किए गए SO-101 और SO-102 before-and-after परीक्षण](../../../assets/readme/posters/overview.jpg)](https://youtu.be/AsxFs24vXQs)

[यूट्यूब पर देखें](https://youtu.be/AsxFs24vXQs) | [MP4](../../../assets/readme/videos/overview.mp4)

अनुमानित मान रिकॉर्ड किए गए प्रदर्शनों का वर्णन करते हैं, कार्यक्षेत्र में सटीकता की गारंटी नहीं देते हैं।

मूक क्लिप देखने के लिए एक वीडियो छवि या उसके नीचे YouTube लिंक का चयन करें। सभी दस्तावेज़ीकरण वीडियो लिंक (असूचीबद्ध) द्वारा उपलब्ध हैं; MP4 प्रतियां भी प्रदान की जाती हैं।

- [हमने इसे क्यों बनाया](#why-we-built-it)
- [नियंत्रण में क्या परिवर्तन होता है](#what-changes-in-control)
- [परिणाम SO-101 / SO-102](#results-on-so-101--so-102) पर
- [रोबोट और लिंक](#robots-and-links)
- [त्वरित शुरुआत](#quick-start)
- [विस्तृत दस्तावेज़](#detailed-documentation)

<a id="why-we-built-it"></a>
## हमने इसे क्यों बनाया

एक रोबोट भुजा लगातार एक ही बिंदु पर लौट सकती है और फिर भी निर्देशित लक्ष्य से चूक सकती है। **दोहराव** उस निरंतरता का वर्णन करता है; **पूर्ण स्थिति निर्धारण सटीकता** बताती है कि हाथ लक्ष्य के कितना करीब पहुंचता है।

**एक संकेतक से मापा गया बार-बार रिटर्न**

[![एक संकेतक के साथ मापा गया बार-बार रिटर्न](../../../assets/readme/posters/repeatability.jpg)](https://youtu.be/_VN10zWybBU)

[यूट्यूब पर देखें](https://youtu.be/_VN10zWybBU) | [MP4](../../../assets/readme/videos/repeatability.mp4)

**दोहराव योग्यता बनाम पूर्ण स्थिति निर्धारण सटीकता**

[![दोहराव और पूर्ण स्थिति सटीकता की वैचारिक व्याख्या](../../../assets/readme/posters/repeatability-vs-accuracy.jpg)](https://youtu.be/L5FINW5FATI)

[यूट्यूब पर देखें](https://youtu.be/L5FINW5FATI) | [MP4](../../../assets/readme/videos/repeatability-vs-accuracy.mp4)

हमने स्टॉक फर्मवेयर पर PID ट्यूनिंग करके पोजिशनिंग त्रुटि को कम करने का प्रयास किया। कुछ परीक्षण परिदृश्यों में, त्रुटि को कम करने वाली सेटिंग्स के कारण भी दोलन हुआ। हमने गति योजना और स्थिति नियंत्रण पर अधिक नियंत्रण देने के लिए कस्टम फ़र्मवेयर विकसित किया है।

[![स्टॉक फ़र्मवेयर: PID ट्यूनिंग](../../../assets/readme/posters/stock-pid-oscillation.jpg)](https://youtu.be/wIBd3jnOwRk) के दौरान दोलन

[यूट्यूब पर देखें](https://youtu.be/wIBd3jnOwRk) | [MP4](../../../assets/readme/videos/stock-pid-oscillation.mp4)

<a id="what-changes-in-control"></a>
## नियंत्रण में क्या परिवर्तन होता है

होस्ट लक्ष्य और सेटिंग्स भेजता है; प्रत्येक सर्वो अपनी स्वयं की गति की योजना बनाता है और उसे नियंत्रित करता है।

1. होस्ट लक्ष्य और सेटिंग्स भेजता है और कॉन्फ़िगर होने पर गुरुत्वाकर्षण मुआवजे की गणना करता है।
2. प्रत्येक सर्वो अपनी स्वयं की S-curve गति की योजना बनाता है।
3. स्थानीय PID और फीडफॉरवर्ड नियंत्रण मापी गई स्थिति और अनुमानित गति का उपयोग करके मोटर आउटपुट को समायोजित करते हैं।

[यूट्यूब](https://youtu.be/AsxFs24vXQs) पर रिकॉर्ड किया गया अवलोकन देखें | [MP4](../../../assets/readme/videos/overview.mp4)

<a id="s-curve-motion"></a>
### S-curve गति

त्वरण और ब्रेकिंग को अधिक क्रमिक बनाता है। वक्र समय के साथ त्वरण को दर्शाता है।

[![s-curve गति](../../../assets/readme/illustrations/s-curve.png)](https://youtu.be/92mDt4rbobY) का वैचारिक चित्रण

[यूट्यूब पर देखें](https://youtu.be/92mDt4rbobY) | [MP4](../../../assets/readme/videos/s-curve.mp4)

[विन्यास और सीमाएँ](DETAILED_DOCUMENTATION.md#s-curve-motion).

<a id="pid-control"></a>
### PID नियंत्रण

यह समायोजित करता है कि सर्वो स्थिति त्रुटि को कैसे ठीक करता है। ग्रे वक्र दोलन को दर्शाता है; सफ़ेद वक्र अधिक नम प्रतिक्रिया को दर्शाता है। धराशायी रेखा लक्ष्य है.

[![पिड नियंत्रण का वैचारिक चित्रण](../../../assets/readme/illustrations/pid-tuning.png)](https://youtu.be/TEpvaAMlfrg)

[यूट्यूब पर देखें](https://youtu.be/TEpvaAMlfrg) | [MP4](../../../assets/readme/videos/pid-tuning.mp4)

[विन्यास और सीमाएँ](DETAILED_DOCUMENTATION.md#pid-controller).

<a id="velocity-feedforward"></a>
### वेग फ़ीडफ़ॉरवर्ड

सर्वो के अंदर गणना की गई नियोजित गति के आधार पर मोटर आउटपुट जोड़ता है। दोनों वक्र समय के साथ बाएं से दाएं की ओर बढ़ते हैं।

[![वेग फीडफॉरवर्ड का वैचारिक चित्रण](../../../assets/readme/illustrations/velocity-feedforward.png)](https://youtu.be/osGGs-nhk9I)

[यूट्यूब पर देखें](https://youtu.be/osGGs-nhk9I) | [MP4](../../../assets/readme/videos/velocity-feedforward.mp4)

[विन्यास और सीमाएँ](DETAILED_DOCUMENTATION.md#velocity-feedforward).

<a id="gravity-compensation"></a>
### गुरुत्वाकर्षण मुआवजा

मेजबान योगदान की गणना करता है और सर्वो इसे लागू करता है। नीचे की ओर तीर वजन का प्रतिनिधित्व करता है; ऊपर की ओर वाला तीर समर्थन का प्रतिनिधित्व करता है।

[![गुरुत्वाकर्षण मुआवजे का वैचारिक चित्रण](../../../assets/readme/illustrations/gravity-compensation.png)](https://youtu.be/25sc41PTDIA)

[यूट्यूब पर देखें](https://youtu.be/25sc41PTDIA) | [MP4](../../../assets/readme/videos/gravity-compensation.mp4)

[विन्यास और सीमाएँ](DETAILED_DOCUMENTATION.md#gravity-compensation).

ये व्याख्यात्मक ग्राफिक्स और एनिमेशन वैचारिक हैं, मापा हार्डवेयर प्लॉट नहीं। सेटिंग्स, प्रोटोकॉल विवरण और सीमाओं के लिए [विस्तृत दस्तावेज़](DETAILED_DOCUMENTATION.md) देखें। एक्सटेंशन क्लाइंट को **प्रोटोकॉल v9.0** का समर्थन करना चाहिए; एक्सटेंशन सेटिंग्स अस्थायी हैं और इन्हें रीसेट या पावर चक्र के बाद फिर से भेजा जाना चाहिए।

<a id="results-on-so-101--so-102"></a>
## SO-101 / SO-102 पर परिणाम

नीचे दिए गए क्लिप में SO-101 और SO-102 पर रिकॉर्ड किए गए before-and-after परीक्षण दिखाए गए हैं। प्रत्येक तुलना पहले मूल व्यवहार दिखाती है, उसके बाद custom-firmware सेटअप दिखाती है।

**SO-101: पहले, फिर बाद**

[![SO-101 रिकॉर्ड किया गया before-and-after तुलना](../../../assets/readme/posters/so101-before-after.jpg)](https://youtu.be/ZdLlv8q73gE)

[यूट्यूब पर देखें](https://youtu.be/ZdLlv8q73gE) | [MP4](../../../assets/readme/videos/so101-before-after.mp4)

**SO-102: पहले, फिर बाद**

[![SO-102 रिकॉर्ड किया गया before-and-after तुलना](../../../assets/readme/posters/so102-before-after.jpg)](https://youtu.be/0rmO15pFqJ4)

[यूट्यूब पर देखें](https://youtu.be/0rmO15pFqJ4) | [MP4](../../../assets/readme/videos/so102-before-after.mp4)

दिखाए गए अनुमानित मान इन प्रदर्शनों का वर्णन करते हैं, हाथ के कार्यक्षेत्र में सटीकता की गारंटी नहीं देते हैं। पुनरावृत्ति, पूर्ण स्थिति सटीकता और यांत्रिक विक्षेपण अलग-अलग माप हैं।

<a id="complete-coordinated-movement"></a>
### पूर्ण समन्वित आंदोलन

[![पूरा रिकॉर्ड किया गया SO-101 आंदोलन](../../../assets/readme/posters/coordinated-motion.jpg)](https://youtu.be/dCtcS5aAko0)

[यूट्यूब पर देखें](https://youtu.be/dCtcS5aAko0) | [MP4](../../../assets/readme/videos/coordinated-motion.mp4)

यह क्लिप पूरी रिकार्ड की गई गतिविधि को सुरक्षित रखती है। प्रत्येक सर्वो स्थानीय स्तर पर योजना बनाता है; लक्ष्य को एक साथ भेजना अपने आप में एक साथ आगमन की गारंटी नहीं देता है।

<a id="mechanical-limitations"></a>
### यांत्रिक सीमाएँ

[![गियरबॉक्स बैकलैश और फ्रेम फ्लेक्स](../../../assets/readme/posters/mechanical-limits.jpg)](https://youtu.be/53l7at5aE6k)

[यूट्यूब पर देखें](https://youtu.be/53l7at5aE6k) | [MP4](../../../assets/readme/videos/mechanical-limits.mp4)

गियरबॉक्स बैकलैश और फ्रेम फ्लेक्स अभी भी बांह की समापन बिंदु स्थिति को प्रभावित करते हैं। नियंत्रक ट्यूनिंग इन यांत्रिक सीमाओं को दूर नहीं करती है। वास्तविक तंत्र और लोड पर सेटिंग्स मान्य करें; [वर्तमान सीमा](DETAILED_DOCUMENTATION.md#current-limits) देखें।

<a id="robots-and-links"></a>
## रोबोट और लिंक

समान सेटअप बनाने में रुचि है? रोबोनिन से SO-ARM101 और SO-ARM102 किट का अन्वेषण करें। किट सामग्री उत्पाद पृष्ठों पर प्रलेखित है।

| SO-ARM101 | SO-ARM102 |
| --- | --- |
| ![SO-ARM101 रोबोट किट](../../../assets/readme/illustrations/hardware-so101.jpg) | ![SO-ARM102 रोबोट किट](../../../assets/readme/illustrations/hardware-so102.jpg) |
| [रोबोनीन](https://robonine.com/ru/shop/so-arm101-black-white-robotic-arm-kit/) से SO-ARM101 किट खरीदें | [रोबोनीन](https://robonine.com/ru/shop/so-arm102-robotic-arm-kit/) से SO-ARM102 किट खरीदें |

[SO-ARM102 हार्डवेयर, CAD और BOM](https://github.com/roboninecom/SO-ARM102) का अन्वेषण करें।

<a id="quick-start"></a>
## त्वरित शुरुआत

पूर्वापेक्षाओं, आदेशों, जांचों और फ्लैशिंग सावधानियों के लिए **[मौजूदा त्वरित प्रारंभ मार्गदर्शिका](QUICKSTART.md)** का पालन करें। इसका सेटअप क्रम है:

1. आवश्यक उपकरण स्थापित करें और सर्वो पोर्ट का चयन करें।
2. मोटर सेटिंग्स का बैकअप लें और प्रकाशित कस्टम फर्मवेयर को फ्लैश करें।
3. सेटअप के लिए आवश्यकतानुसार संयुक्त ऑफसेट और यात्रा सीमा को कैलिब्रेट करें।
4. टॉर्क बंद करके संचार की जाँच करें।
5. पोज़ रिकॉर्ड करें, रीप्ले का पूर्वावलोकन करें और पहला मोशन टेस्ट करें।
6. भुजा और उसके अंशांकन से मेल खाने वाले मॉडल के साथ गुरुत्वाकर्षण क्षतिपूर्ति सक्षम करें।
7. गति को ट्यून करें और देखें.

**फ्लैशिंग सर्वो को नुकसान पहुंचा सकती है या कैलिब्रेशन मिटा सकती है।** आगे बढ़ने से पहले गाइड की पावर, टॉर्क और रिकवरी सावधानियों का पालन करें।

नए SO-101 या SO-102 अंशांकन के लिए, मौजूदा reference-pose छवियों का उपयोग करें और [अंशांकन गाइड](tools/settings/README.md#reference-pose-images) का पालन करें। इसकी रिकॉर्डिंग और गुरुत्वाकर्षण मॉडल का पुन: उपयोग करते समय मौजूदा सत्यापित अंशांकन रखें।

**SO-101 संदर्भ मुद्रा**

[![SO-101 छह लेबल वाले जोड़ों के साथ संदर्भ मुद्रा](../../../tools/settings/images/so101-reference-pose.png)](../../../tools/settings/images/so101-reference-pose.png)

**SO-102 संदर्भ मुद्रा**

[![SO-102 छह लेबल वाले जोड़ों के साथ संदर्भ मुद्रा](../../../tools/settings/images/so102-reference-pose.png)](../../../tools/settings/images/so102-reference-pose.png)

<a id="detailed-documentation"></a>
## विस्तृत दस्तावेज़ीकरण

**[विस्तृत दस्तावेज़](DETAILED_DOCUMENTATION.md)** में कॉन्फ़िगरेशन, प्रोटोकॉल, रजिस्टर, भवन और सत्यापन शामिल हैं। तकनीकी आरेख और प्रासंगिक वीडियो प्रदर्शन संबंधित अनुभागों के साथ दिखाई देते हैं।

- [विरासत मोड](DETAILED_DOCUMENTATION.md#legacy-mode)
- [एक्सटेंशन मोड कैसे काम करता है](DETAILED_DOCUMENTATION.md#how-extension-mode-works)
- [S-curve गति](DETAILED_DOCUMENTATION.md#s-curve-motion)
- [अंशांकन संदर्भ पोज़](DETAILED_DOCUMENTATION.md#calibration-reference-poses)
- [PID नियंत्रक](DETAILED_DOCUMENTATION.md#pid-controller)
- [वेग फ़ीडफ़ॉरवर्ड](DETAILED_DOCUMENTATION.md#velocity-feedforward)
- [गुरुत्वाकर्षण मुआवजा](DETAILED_DOCUMENTATION.md#gravity-compensation)
- [एक्सटेंशन मोड शुरू करना और रोकना](DETAILED_DOCUMENTATION.md#starting-and-stopping-extension-mode)
- [एक्सटेंशन प्रोटोकॉल](DETAILED_DOCUMENTATION.md#extension-protocol)
- [एक्सटेंशन रजिस्टर](DETAILED_DOCUMENTATION.md#extension-registers)
- [निर्माण और सत्यापन](DETAILED_DOCUMENTATION.md#build-and-verification)
- [रिपोजिटरी लेआउट](DETAILED_DOCUMENTATION.md#repository-layout)
- [वर्तमान सीमा](DETAILED_DOCUMENTATION.md#current-limits)


व्यक्तिगत कमांड गाइड के लिए [टूल्स](tools/README.md) और बिल्ड टूलचेन के लिए [फर्मवेयर](firmware/README.md)] देखें।
<!-- /translated-content -->
