<!-- translation-navigation -->
[English](../../en/firmware/README.md) · [Русский](README.md) · [Español](../../es/firmware/README.md) · [Français](../../fr/firmware/README.md) · [Deutsch](../../de/firmware/README.md) · [Português (Brasil)](../../pt-BR/firmware/README.md) · [简体中文](../../zh-CN/firmware/README.md) · [日本語](../../ja/firmware/README.md) · [हिन्दी](../../hi/firmware/README.md) · [العربية](../../ar/firmware/README.md)

[Английский оригинал](../../../../firmware/README.md)

> Полный машинный перевод. Проверка носителем языка ещё не проведена. Изображения и видео общие для всех языков; текст внутри медиа остаётся на исходном языке.
<!-- /translation-navigation -->

<!-- translated-content -->
<a id="firmware-sources"></a>
# Исходники прошивки

GD32F130 встроенное ПО, включая переносимый управляющий код, драйверы оборудования и тесты. Протокол расширения описан в [подробной документации](../DETAILED_DOCUMENTATION.md#extension-protocol).

| Каталог | Содержание |
| --- | --- |
| `app/` | Основной цикл и координация между компонентами |
| `core/` | Управление, считывание, протокол, регистры и хранение |
| `include/` | Общие объявления C и типы данных |
| `platform/gd32f130/` | Драйверы оборудования, код запуска, сценарий компоновщика и заголовки поставщиков. |
| [`tests/`](tests/README.md) | Регрессионные тесты C, проверки Python и необходимые исправления |

<a id="build-and-verify"></a>
## Создайте и проверьте

Из корня репозитория:

```sh
make
make verify
```

Установите `arm-none-eabi-gcc`, хост-компилятор C с address/undefined-behavior дезинфицирующими средствами, Python 3 и Make. Для цепочки инструментов за пределами PATH:

```sh
make verify ARM_PREFIX=/path/to/toolchain/bin/arm-none-eabi-
```

Корневой Makefile делегирует полномочия этому каталогу. `make -C firmware` и `make -C firmware verify` также работают. Оба записывают образы прошивки в `build/motor-release/`, а собственные тестовые исполняемые файлы в `build/host/` в корне репозитория. `make clean` удаляет созданный каталог `build/`.

Эти команды не перепрошивают оборудование. Используйте [flashtool](../tools/flash/README.md) с версией publisher-supplied. Хост-библиотеки и инструменты command-line остаются в каталогах [`host/`](../host/servo-driver/README.md) и [`tools/`](../tools/README.md).
<!-- /translated-content -->
