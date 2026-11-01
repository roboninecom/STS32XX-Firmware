<!-- translation-navigation -->
[English](../en/README.md) · [Русский](README.md) · [Español](../es/README.md) · [Français](../fr/README.md) · [Deutsch](../de/README.md) · [Português (Brasil)](../pt-BR/README.md) · [简体中文](../zh-CN/README.md) · [日本語](../ja/README.md) · [हिन्दी](../hi/README.md) · [العربية](../ar/README.md)

[Английский оригинал](../../../README.md)

> Полный машинный перевод. Проверка носителем языка ещё не проведена. Изображения и видео общие для всех языков; текст внутри медиа остаётся на исходном языке.
<!-- /translation-navigation -->

<!-- translated-content -->
<a id="sts32xx-firmware"></a>
# STS32XX Прошивка

Прошивка для GD32F130-based STS3215 сервоприводов. Стандартные команды STS доступны в Legacy режиме; Режим расширения добавляет локально планируемое плавное движение, настраиваемое управление положением, упреждение по скорости и компенсацию гравитации host-calculated.

Начните с **[Краткого руководства](QUICKSTART.md)**] или прочитайте [подробную документацию](DETAILED_DOCUMENTATION.md) для получения подробной информации о конфигурации и протоколе.

[![Обзор: записаны SO-101 и SO-102 before-and-after тесты](../../../assets/readme/posters/overview.jpg)](https://youtu.be/AsxFs24vXQs)

[Смотреть на YouTube](https://youtu.be/AsxFs24vXQs) | [MP4](../../../assets/readme/videos/overview.mp4)

Приблизительные значения описывают записанные демонстрации, но не гарантируют точность во всем рабочем пространстве.

Выберите видеоизображение или ссылку YouTube под ним, чтобы посмотреть немой клип. Все видеоролики с документацией доступны по ссылке (не в списке); Также предоставляются MP4 копии.

- [Зачем мы это построили](#why-we-built-it)
- [Какие изменения в управлении](#what-changes-in-control)
- [Результаты по SO-101 / SO-102](#results-on-so-101--so-102)
- [Роботы и ссылки](#robots-and-links)
- [Быстрый старт](#quick-start)
- [Подробная документация](#detailed-documentation)

<a id="why-we-built-it"></a>
## Почему мы это построили

Роботизированная рука может последовательно возвращаться в одну и ту же точку и при этом не попасть в заданную цель. **Повторяемость** описывает эту последовательность; **абсолютная точность позиционирования** описывает, насколько близко рука приближается к цели.

**Повторяющаяся доходность, измеренная с помощью индикатора**

[![Повторяющаяся доходность, измеряемая индикатором](../../../assets/readme/posters/repeatability.jpg)](https://youtu.be/_VN10zWybBU)

[Смотреть на YouTube](https://youtu.be/_VN10zWybBU) | [MP4](../../../assets/readme/videos/repeatability.mp4)

**Повторяемость и абсолютная точность позиционирования**

[![Концептуальное объяснение повторяемости и абсолютной точности позиционирования](../../../assets/readme/posters/repeatability-vs-accuracy.jpg)](https://youtu.be/L5FINW5FATI)

[Смотреть на YouTube](https://youtu.be/L5FINW5FATI) | [MP4](../../../assets/readme/videos/repeatability-vs-accuracy.mp4)

Мы попытались уменьшить ошибку позиционирования, настроив PID в стандартной прошивке. В некоторых сценариях тестирования настройки, которые уменьшали ошибку, также вызывали колебания. Мы разработали специальную прошивку, которая дает нам больше контроля над планированием движения и контролем положения.

[![Стоковая прошивка: колебание при настройке PID](../../../assets/readme/posters/stock-pid-oscillation.jpg)](https://youtu.be/wIBd3jnOwRk)

[Смотреть на YouTube](https://youtu.be/wIBd3jnOwRk) | [MP4](../../../assets/readme/videos/stock-pid-oscillation.mp4)

<a id="what-changes-in-control"></a>
## Что меняется в контроле

Хост отправляет цели и настройки; каждый сервопланирует и контролирует свое движение.

1. Хост отправляет цели и настройки и вычисляет компенсацию гравитации при настройке.
2. Каждый сервопривод планирует собственное движение S-curve.
3. Местное управление PID и упреждающее управление регулируют мощность двигателя, используя измеренное положение и расчетную скорость.

[Посмотрите записанный обзор на YouTube](https://youtu.be/AsxFs24vXQs) | [MP4](../../../assets/readme/videos/overview.mp4)

<a id="s-curve-motion"></a>
### S-curve движение

Делает ускорение и торможение более плавными. Кривая иллюстрирует ускорение с течением времени.

[![Концептуальная иллюстрация движения s-curve](../../../assets/readme/illustrations/s-curve.png)](https://youtu.be/92mDt4rbobY)

[Смотреть на YouTube](https://youtu.be/92mDt4rbobY) | [MP4](../../../assets/readme/videos/s-curve.mp4)

[Конфигурация и ограничения](DETAILED_DOCUMENTATION.md#s-curve-motion).

<a id="pid-control"></a>
### PID контроль

Регулирует, как сервопривод исправляет ошибку положения. Серая кривая иллюстрирует колебания; белая кривая иллюстрирует более затухающий отклик. Пунктирная линия — это цель.

[![Концептуальная иллюстрация пид-регулирования](../../../assets/readme/illustrations/pid-tuning.png)](https://youtu.be/TEpvaAMlfrg)

[Смотреть на YouTube](https://youtu.be/TEpvaAMlfrg) | [MP4](../../../assets/readme/videos/pid-tuning.mp4)

[Конфигурация и ограничения](DETAILED_DOCUMENTATION.md#pid-controller).

<a id="velocity-feedforward"></a>
### Прямая связь по скорости

Добавляет мощность двигателя на основе запланированной скорости, рассчитанной внутри сервопривода. Обе кривые со временем продвигаются слева направо.

[![Концептуальная иллюстрация прямой связи по скорости](../../../assets/readme/illustrations/velocity-feedforward.png)](https://youtu.be/osGGs-nhk9I)

[Смотреть на YouTube](https://youtu.be/osGGs-nhk9I) | [MP4](../../../assets/readme/videos/velocity-feedforward.mp4)

[Конфигурация и ограничения](DETAILED_DOCUMENTATION.md#velocity-feedforward).

<a id="gravity-compensation"></a>
### Компенсация гравитации

Хост рассчитывает вклад, и сервопривод применяет его. Стрелка вниз обозначает вес; стрелка вверх представляет поддержку.

[![Концептуальная иллюстрация компенсации гравитации](../../../assets/readme/illustrations/gravity-compensation.png)](https://youtu.be/25sc41PTDIA)

[Смотреть на YouTube](https://youtu.be/25sc41PTDIA) | [MP4](../../../assets/readme/videos/gravity-compensation.mp4)

[Конфигурация и ограничения](DETAILED_DOCUMENTATION.md#gravity-compensation).

Эти пояснительные графики и анимации являются концептуальными, а не измеренными аппаратными средствами. См. [подробную документацию](DETAILED_DOCUMENTATION.md) для получения информации о настройках, деталях протокола и ограничениях. Клиенты расширения должны поддерживать **протокол v9.0**; настройки расширения являются временными и должны быть отправлены снова после сброса или выключения и включения питания.

<a id="results-on-so-101--so-102"></a>
## Результаты на SO-101 / SO-102

В видеороликах ниже показаны записанные тесты before-and-after на SO-101 и SO-102. Каждое сравнение сначала показывает исходное поведение, а затем настройку custom-firmware.

**SO-101: до, потом после**

[![SO-101 записано before-and-after сравнение](../../../assets/readme/posters/so101-before-after.jpg)](https://youtu.be/ZdLlv8q73gE)

[Смотреть на YouTube](https://youtu.be/ZdLlv8q73gE) | [MP4](../../../assets/readme/videos/so101-before-after.mp4)

**SO-102: до, потом после**

[![SO-102 записано before-and-after сравнение](../../../assets/readme/posters/so102-before-after.jpg)](https://youtu.be/0rmO15pFqJ4)

[Смотреть на YouTube](https://youtu.be/0rmO15pFqJ4) | [MP4](../../../assets/readme/videos/so102-before-after.mp4)

Приведенные приблизительные значения описывают эти демонстрации, но не гарантируют точность во всем рабочем пространстве руки. Повторяемость, абсолютная точность позиционирования и механическое отклонение — это разные измерения.

<a id="complete-coordinated-movement"></a>
### Полное скоординированное движение

[![Полная запись движения SO-101](../../../assets/readme/posters/coordinated-motion.jpg)](https://youtu.be/dCtcS5aAko0)

[Смотреть на YouTube](https://youtu.be/dCtcS5aAko0) | [MP4](../../../assets/readme/videos/coordinated-motion.mp4)

В этом клипе сохраняется полное записанное движение. Каждый сервопривод планирует локально; совместная отправка целей сама по себе не гарантирует одновременного прибытия.

<a id="mechanical-limitations"></a>
### Механические ограничения

[![Люфт коробки передач и прогиб рамы](../../../assets/readme/posters/mechanical-limits.jpg)](https://youtu.be/53l7at5aE6k)

[Смотреть на YouTube](https://youtu.be/53l7at5aE6k) | [MP4](../../../assets/readme/videos/mechanical-limits.mp4)

Люфт коробки передач и изгиб рамы по-прежнему влияют на конечное положение рычага. Настройка контроллера не устраняет эти механические ограничения. Проверьте настройки фактического механизма и нагрузки; см. [текущие ограничения](DETAILED_DOCUMENTATION.md#current-limits).

<a id="robots-and-links"></a>
## Роботы и ссылки

Заинтересованы в создании аналогичной установки? Изучите комплекты SO-ARM101 и SO-ARM102 от Robonine. Содержимое комплекта описано на страницах продукта.

| SO-ARM101 | SO-ARM102 |
| --- | --- |
| ![SO-ARM101 комплект робота](../../../assets/readme/illustrations/hardware-so101.jpg) | ![SO-ARM102 комплект робота](../../../assets/readme/illustrations/hardware-so102.jpg) |
| [Купите комплект SO-ARM101 у Робонина](https://robonine.com/ru/shop/so-arm101-black-white-robotic-arm-kit/) | [Купите комплект SO-ARM102 у Робонина](https://robonine.com/ru/shop/so-arm102-robotic-arm-kit/) |

[Изучите оборудование SO-ARM102, CAD и BOM](https://github.com/roboninecom/SO-ARM102).

<a id="quick-start"></a>
## Быстрый старт

Следуйте **[существующему краткому руководству](QUICKSTART.md)**] для получения предварительных условий, команд, проверок и мер предосторожности при перепрошивке. Последовательность его настройки следующая:

1. Установите необходимые инструменты и выберите сервопорт.
2. Создайте резервную копию настроек двигателя и прошейте опубликованную специальную прошивку.
3. Откалибруйте смещения шарниров и пределы перемещения, необходимые для настройки.
4. Проверьте связь с выключенным крутящим моментом.
5. Запишите позы, просмотрите повтор и выполните первый тест движения.
6. Включите компенсацию гравитации, используя модель, соответствующую руке и ее калибровке.
7. Настраивайте и просматривайте движение.

**Прошивка может привести к повреждению сервопривода или стиранию калибровки.** Прежде чем продолжить, следуйте инструкциям по питанию, крутящему моменту и восстановлению, указанным в руководстве.

Для новой калибровки SO-101 или SO-102 используйте существующие изображения reference-pose и следуйте [руководству по калибровке ](tools/settings/README.md#reference-pose-images). Сохраняйте существующую проверенную калибровку при повторном использовании ее записей и гравитационной модели.

**SO-101 эталонная поза**

[![SO-101 эталонная поза с шестью помеченными суставами](../../../tools/settings/images/so101-reference-pose.png)](../../../tools/settings/images/so101-reference-pose.png)

**SO-102 эталонная поза**

[![SO-102 эталонная поза с шестью помеченными суставами](../../../tools/settings/images/so102-reference-pose.png)](../../../tools/settings/images/so102-reference-pose.png)

<a id="detailed-documentation"></a>
## Подробная документация

**[подробная документация](DETAILED_DOCUMENTATION.md)** охватывает конфигурацию, протоколы, регистры, сборку и проверку. Технические схемы и соответствующие видеодемонстрации появляются рядом с соответствующими разделами.

- [Legacy режим](DETAILED_DOCUMENTATION.md#legacy-mode)
- [Как работает режим расширения](DETAILED_DOCUMENTATION.md#how-extension-mode-works)
- [S-curve движение](DETAILED_DOCUMENTATION.md#s-curve-motion)
- [Опорные положения калибровки](DETAILED_DOCUMENTATION.md#calibration-reference-poses)
- [PID контроллер](DETAILED_DOCUMENTATION.md#pid-controller)
- [Упреждение по скорости](DETAILED_DOCUMENTATION.md#velocity-feedforward)
- [Компенсация гравитации](DETAILED_DOCUMENTATION.md#gravity-compensation)
- [Запуск и остановка режима расширения](DETAILED_DOCUMENTATION.md#starting-and-stopping-extension-mode)
- [Протокол расширения](DETAILED_DOCUMENTATION.md#extension-protocol)
- [Регистры расширения](DETAILED_DOCUMENTATION.md#extension-registers)
- [Сборка и проверка](DETAILED_DOCUMENTATION.md#build-and-verification)
- [Макет репозитория](DETAILED_DOCUMENTATION.md#repository-layout)
- [Текущие пределы](DETAILED_DOCUMENTATION.md#current-limits)


См. [tools](tools/README.md) для отдельных руководств по командам и [firmware](firmware/README.md)] для набора инструментов сборки.
<!-- /translated-content -->
