<!-- translation-navigation -->
[English](../../../en/firmware/tests/README.md) · [Русский](README.md) · [Español](../../../es/firmware/tests/README.md) · [Français](../../../fr/firmware/tests/README.md) · [Deutsch](../../../de/firmware/tests/README.md) · [Português (Brasil)](../../../pt-BR/firmware/tests/README.md) · [简体中文](../../../zh-CN/firmware/tests/README.md) · [日本語](../../../ja/firmware/tests/README.md) · [हिन्दी](../../../hi/firmware/tests/README.md) · [العربية](../../../ar/firmware/tests/README.md)

[Английский оригинал](../../../../../firmware/tests/README.md)

> Полный машинный перевод. Проверка носителем языка ещё не проведена. Изображения и видео общие для всех языков; текст внутри медиа остаётся на исходном языке.
<!-- /translation-navigation -->

<!-- translated-content -->
<a id="firmware-tests"></a>
# Тесты прошивки

Запустите `make verify` из корня репозитория после установки [firmwaretoolchain](../README.md#build-and-verify). Он собирает прошивку и запускает очищенные тесты C, проверки контрактов register/storage, проверку границ модуля и проверку макета изображения. Он не подключается к оборудованию.

`fixtures/` содержит необходимые входные данные регрессии. Держите их вместе с тестами. `support/` поставляет моделируемые аппаратные интерфейсы и устройства хранения данных.

См. [проверки проекта](../../tools/README.md#offline-checks) для тестов хоста, прошивки и просмотра, а также [пакет сравнения оборудования](../../tools/hw-diff-tests/README.md) для factory/custom проверок поведения на специальном стенде.
<!-- /translated-content -->
