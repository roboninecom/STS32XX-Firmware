<!-- translation-navigation -->
[English](../../en/firmware/README.md) · [Русский](../../ru/firmware/README.md) · [Español](../../es/firmware/README.md) · [Français](../../fr/firmware/README.md) · [Deutsch](../../de/firmware/README.md) · [Português (Brasil)](../../pt-BR/firmware/README.md) · [简体中文](../../zh-CN/firmware/README.md) · [日本語](../../ja/firmware/README.md) · [हिन्दी](README.md) · [العربية](../../ar/firmware/README.md)

[अंग्रेज़ी मूल](../../../../firmware/README.md)

> यह पूर्ण मशीन अनुवाद है; मातृभाषी द्वारा समीक्षा अभी नहीं हुई है। चित्र और वीडियो सभी भाषाओं में साझा हैं; उनमें लिखा पाठ मूल भाषा में है।
<!-- /translation-navigation -->

<!-- translated-content -->
<a id="firmware-sources"></a>
# फ़र्मवेयर स्रोत

GD32F130 फर्मवेयर, जिसमें पोर्टेबल नियंत्रण कोड, हार्डवेयर ड्राइवर और परीक्षण शामिल हैं। एक्सटेंशन प्रोटोकॉल को [विस्तृत दस्तावेज़](../DETAILED_DOCUMENTATION.md#extension-protocol)] में प्रलेखित किया गया है।

| निर्देशिका | सामग्री |
| --- | --- |
| `app/` | मुख्य लूप और घटकों के बीच समन्वय |
| `core/` | नियंत्रण, संवेदन, प्रोटोकॉल, रजिस्टर और भंडारण |
| `include/` | साझा सी घोषणाएँ और डेटा प्रकार |
| `platform/gd32f130/` | हार्डवेयर ड्राइवर, स्टार्टअप कोड, लिंकर स्क्रिप्ट और विक्रेता हेडर |
| [`tests/`](tests/README.md) | सी रिग्रेशन परीक्षण, पायथन जांच और आवश्यक फिक्स्चर |

<a id="build-and-verify"></a>
## बनाएं और सत्यापित करें

रिपॉजिटरी रूट से:

```sh
make
make verify
```

address/undefined-behavior सैनिटाइज़र, पायथन 3 और मेक के साथ एक होस्ट सी कंपाइलर `arm-none-eabi-gcc` स्थापित करें। PATH के बाहर टूलचेन के लिए:

```sh
make verify ARM_PREFIX=/path/to/toolchain/bin/arm-none-eabi-
```

रूट मेकफ़ाइल इस निर्देशिका को सौंपता है। `make -C firmware` और `make -C firmware verify` भी काम करते हैं। दोनों फर्मवेयर छवियों को `build/motor-release/` पर लिखते हैं और मूल परीक्षण निष्पादनयोग्य को रिपॉजिटरी रूट पर `build/host/` पर लिखते हैं। `make clean` उस उत्पन्न `build/` निर्देशिका को हटा देता है।

ये आदेश हार्डवेयर को फ़्लैश नहीं करते हैं. publisher-supplied रिलीज़ के साथ [फ़्लैश टूल](../tools/flash/README.md) का उपयोग करें। होस्ट लाइब्रेरी और command-line उपकरण [`host/`](../host/servo-driver/README.md) और [`tools/`](../tools/README.md)] के अंतर्गत रहते हैं।
<!-- /translated-content -->
