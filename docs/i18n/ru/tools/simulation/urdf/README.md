<!-- translation-navigation -->
[English](../../../../en/tools/simulation/urdf/README.md) · [Русский](README.md) · [Español](../../../../es/tools/simulation/urdf/README.md) · [Français](../../../../fr/tools/simulation/urdf/README.md) · [Deutsch](../../../../de/tools/simulation/urdf/README.md) · [Português (Brasil)](../../../../pt-BR/tools/simulation/urdf/README.md) · [简体中文](../../../../zh-CN/tools/simulation/urdf/README.md) · [日本語](../../../../ja/tools/simulation/urdf/README.md) · [हिन्दी](../../../../hi/tools/simulation/urdf/README.md) · [العربية](../../../../ar/tools/simulation/urdf/README.md)

[Английский оригинал](../../../../../../tools/simulation/urdf/README.md)

> Полный машинный перевод. Проверка носителем языка ещё не проведена. Изображения и видео общие для всех языков; текст внутри медиа остаётся на исходном языке.
<!-- /translation-navigation -->

<!-- translated-content -->
<a id="so-arm-102-model"></a>
# SO-ARM 102 модель

URDF и восемь STL сеток из [Robonine's SO-ARM-102](https://github.com/roboninecom/SO-ARM-102/tree/0f0dd95526638042a3213598ee0ae7f167c40efe/simulation/urdf), зафиксируйте `0f0dd95526638042a3213598ee0ae7f167c40efe`. Файлы копируются без изменений. `source.json` записывает их контрольные суммы. Для загрузки автономного пакета URDF не требуется поддержка пакетов Xacro и ROS.

Авторские права (c) 2026 Робонин. Атрибуция: Робонин, SO-ARM 102, https://github.com/roboninecom/SO-ARM-102, CC BY 4.0. См. [LICENSE.txt](../../../../../../tools/simulation/urdf/LICENSE.txt) и исходную [карту лицензий](https://github.com/roboninecom/SO-ARM-102/blob/0f0dd95526638042a3213598ee0ae7f167c40efe/LICENSING.md).

<a id="model-assumptions"></a>
## Допущения модели

Оценка массы вверх по течению составляет **0.889 кг**. Предполагается PLA печать и 70 г на сервопривод. См. исходные [настройки экспорта](https://github.com/roboninecom/SO-ARM-102/blob/0f0dd95526638042a3213598ee0ae7f167c40efe/simulation/urdf/export_settings.json) и [массовые свойства](https://github.com/roboninecom/SO-ARM-102/blob/0f0dd95526638042a3213598ee0ae7f167c40efe/simulation/urdf/mass_properties.json). Это оценки; измеренная аппаратная гравитационная модель остается отдельной.

URDF ноль — это экспортированная поза CAD. [Карта кодировщика ](../../../../../../tools/simulation/encoder-angle-map.json) устанавливает углы M1–M4 со счетами от 2048 до 0°, −3°, 1° и 1° соответственно. M5 и калибровка захвата остаются непроверенными. В дисплее с фиксированной челюстью используются +0.016 м и −0.016 м, что соответствует муфте URDF opposite-sign.

Источник сохраняет свои поля столкновений. При подготовке модели они исключаются из созданного предварительного просмотра, поскольку эти инструменты отключают симуляцию контакта. Он сохраняет визуальные эффекты, инерцию и суставную связь. Результаты моделирования не калибруют реальную динамику двигателя и не определяют коэффициент усиления аппаратной настройки.
<!-- /translated-content -->
